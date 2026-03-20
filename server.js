const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const { randomUUID } = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;
const Groq = require('groq-sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const USDA_KEY = process.env.USDA_API_KEY;

const upload = multer({ dest: '/tmp/uploads/' });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Session store for frames (in-memory, auto-expire 1hr) ──
const sessions = new Map();
function createSession(frames, videoPath) {
  const id = randomUUID();
  sessions.set(id, { frames, videoPath, created: Date.now() });
  setTimeout(() => {
    const s = sessions.get(id);
    if (s) {
      // Clean up video and frames when session expires
      try { if (s.videoPath && fs.existsSync(s.videoPath)) fs.unlinkSync(s.videoPath); } catch {}
      s.frames?.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}; });
      sessions.delete(id);
    }
  }, 60 * 60 * 1000);
  return id;
}

// Serve individual frame
app.get('/api/session/:id/frame/:n', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).send('Session expired');
  const idx = parseInt(req.params.n);
  const framePath = session.frames[idx];
  if (!framePath || !fs.existsSync(framePath)) return res.status(404).send('Frame not found');
  res.set('Content-Type', 'image/jpeg');
  res.sendFile(framePath);
});

// Serve video
app.get('/api/session/:id/video', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session?.videoPath || !fs.existsSync(session.videoPath)) return res.status(404).send('Video not found');
  const stat = fs.statSync(session.videoPath);
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(session.videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(session.videoPath).pipe(res);
  }
});

// List frames in session
app.get('/api/session/:id/frames', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session expired' });
  res.json({ count: session.frames.length, hasVideo: !!(session.videoPath && fs.existsSync(session.videoPath)) });
});

// ── yt-dlp ──
const ytDlpBinaryPath = path.join('/tmp', 'yt-dlp');
let ytDlp;
async function getYtDlp() {
  if (!ytDlp) { await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath); ytDlp = new YTDlpWrap(ytDlpBinaryPath); }
  return ytDlp;
}
async function downloadVideo(url) {
  const videoPath = path.join('/tmp', `video_${Date.now()}.mp4`);
  const yt = await getYtDlp();
  await yt.execPromise([url, '-f', 'mp4/best', '--merge-output-format', 'mp4', '-o', videoPath]);
  return videoPath;
}

// ── Frame extraction ──
async function extractFrames(videoPath) {
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });
  const duration = await new Promise((resolve) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" 2>&1`, (err, stdout, stderr) => {
      const match = (stdout + stderr).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(match ? parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]) : 30);
    });
  });
  const fps = Math.max(0.5, Math.min(4, 20 / duration)).toFixed(2);
  return new Promise((resolve, reject) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" -vf "fps=${fps},scale=640:-1" "${frameDir}/frame_%03d.jpg"`, (err) => {
      if (err) { reject(new Error('Failed to extract frames')); return; }
      const frames = fs.readdirSync(frameDir).filter(f => f.endsWith('.jpg')).sort().slice(0, 20).map(f => path.join(frameDir, f));
      resolve(frames);
    });
  });
}

function cleanup(videoPath) {
  try { if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
}

// ── USDA nutrient IDs ──
const NUTRIENT_IDS = {
  calories: 1008, protein: 1003, fat: 1004, carbohydrates: 1005,
  fiber: 1079, sugar: 2000, sodium: 1093, saturatedFat: 1258,
  vitaminA: 1106, vitaminB1: 1165, vitaminB2: 1166, vitaminB3: 1167,
  vitaminB5: 1170, vitaminB6: 1175, vitaminB7: 1176, vitaminB9: 1177,
  vitaminB12: 1178, vitaminC: 1162, vitaminD: 1114, vitaminE: 1109,
  vitaminK: 1185, calcium: 1087, iron: 1089, magnesium: 1090,
  phosphorus: 1091, potassium: 1092, zinc: 1095, copper: 1098,
  manganese: 1101, selenium: 1103, iodine: 1100, chromium: 1096,
  molybdenum: 1102, fluoride: 1099
};

const STANDARD_RDI = {
  calories: 2000, protein: 50, fat: 78, carbohydrates: 275, fiber: 28,
  sugar: 50, sodium: 2300, saturatedFat: 20,
  vitaminA: 900, vitaminB1: 1.2, vitaminB2: 1.3, vitaminB3: 16,
  vitaminB5: 5, vitaminB6: 1.7, vitaminB7: 30, vitaminB9: 400,
  vitaminB12: 2.4, vitaminC: 90, vitaminD: 15, vitaminE: 15,
  vitaminK: 120, calcium: 1000, iron: 18, magnesium: 400,
  phosphorus: 700, potassium: 4700, zinc: 11, copper: 0.9,
  manganese: 2.3, selenium: 55, iodine: 150, chromium: 35,
  molybdenum: 45, fluoride: 4
};

function getPersonalizedRDI(profile) {
  if (!profile) return STANDARD_RDI;
  const age = parseInt(profile.age) || 25;
  const weight = parseFloat(profile.weight) || 70;
  const height = parseFloat(profile.height) || 175;
  const isMale = profile.sex === 'male';
  const bmr = isMale ? 10 * weight + 6.25 * height - 5 * age + 5 : 10 * weight + 6.25 * height - 5 * age - 161;
  const mults = { 'sedentary': 1.2, 'lightly active': 1.375, 'moderately active': 1.55, 'very active': 1.725, 'extremely active': 1.9 };
  const tdee = bmr * (mults[profile.activity] || 1.55);
  const proteinMult = ['weightlifting', 'calisthenics', 'mixed'].includes(profile.training) ? 2.0 : 1.6;
  return {
    ...STANDARD_RDI,
    calories: Math.round(tdee),
    protein: Math.round(weight * proteinMult),
    fat: Math.round(tdee * 0.25 / 9),
    carbohydrates: Math.round(tdee * 0.45 / 4),
    vitaminA: isMale ? 900 : 700,
    vitaminC: isMale ? 90 : 75,
    iron: isMale ? 8 : (age < 51 ? 18 : 8),
    magnesium: isMale ? (age < 31 ? 400 : 420) : (age < 31 ? 310 : 320),
    zinc: isMale ? 11 : 8,
  };
}

// Ingredients that should never be parsed at cup quantities — hard cap to tsp amounts
const LEAVENER_CONDIMENTS = [
  'baking soda', 'baking powder', 'bicarbonate', 'salt', 'pepper',
  'garlic powder', 'onion powder', 'paprika', 'oregano', 'cayenne',
  'chili powder', 'cumin', 'turmeric', 'cinnamon', 'thyme', 'rosemary',
  'basil', 'bay leaf', 'black pepper', 'white pepper', 'red pepper',
  'cornstarch', 'potato starch', 'corn starch'
];

function parseIngredientGrams(ingredientStr) {
  const s = ingredientStr.toLowerCase().trim();

  // Leaveners/spices/starches: max 30g regardless of stated amount
  const isLeavener = LEAVENER_CONDIMENTS.some(l => s.includes(l));

  function parseNum(str) {
    if (str.includes('/')) {
      const parts = str.split('/');
      return parseFloat(parts[0]) / parseFloat(parts[1]);
    }
    return parseFloat(str);
  }

  const patterns = [
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*kg\b/, mult: 1000, max: 5000 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*g(?:rams?)?\s*(?:$|[^a-z])/, mult: 1, max: 2000 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*lbs?\b/, mult: 454, max: 3000 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*oz\b/, mult: 28, max: 1500 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*cups?\b/, mult: 240, max: isLeavener ? 30 : 600 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*(?:tbsp|tablespoons?)\b/, mult: 15, max: isLeavener ? 15 : 200 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*(?:tsp|teaspoons?)\b/, mult: 5, max: isLeavener ? 10 : 50 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*(?:liters?|l)\b/, mult: 1000, max: 3000 },
    { re: /(\d+(?:\/\d+)?(?:\.\d+)?)\s*ml\b/, mult: 1, max: 2000 },
  ];

  for (const { re, mult, max } of patterns) {
    const m = s.match(re);
    if (m) return Math.min(parseNum(m[1]) * mult, max);
  }

  // Count-based fallback
  const countMatch = s.match(/(\d+(?:\/\d+)?(?:\.\d+)?)/);
  if (countMatch) {
    const qty = parseNum(countMatch[1]);
    if (isLeavener) return Math.min(qty * 5, 30);
    if (s.includes('clove')) return Math.min(qty * 5, 50);
    if (s.includes('slice')) return Math.min(qty * 30, 200);
    if (s.includes('egg')) return Math.min(qty * 55, 330);
    return Math.min(qty * 80, 400);
  }
  return isLeavener ? 10 : 100;
}

// Ingredients to skip in nutrition calc — not meaningfully consumed
const SKIP_INGREDIENTS = [
  'baking soda', 'baking powder', 'bicarbonate', 'cornstarch coating', 'potato starch coating',
  'salt', 'pepper', 'salt & pepper', 'salt and pepper',
  'garlic powder', 'onion powder', 'paprika', 'oregano', 'cayenne', 'chili powder',
  'cumin', 'turmeric', 'cinnamon', 'thyme', 'rosemary', 'basil', 'bay leaf',
  'black pepper', 'white pepper', 'red pepper flakes'
];

function shouldSkipIngredient(ing) {
  const lower = ing.toLowerCase();
  // Skip pure spices/leaveners — these are seasoning amounts, not meaningful calories
  return SKIP_INGREDIENTS.some(skip => lower.includes(skip));
}

// ── USDA lookup ──
async function lookupUSDA(ingredientStr) {
  if (!USDA_KEY) return null;
  try {
    const searchQuery = ingredientStr
      .replace(/(\d+(?:\.\d+)?(?:\/\d+)?)\s*(kg|g|lb|oz|cup|tbsp|tsp|ml|l|grams?|pounds?|ounces?|tablespoons?|teaspoons?|liters?|milliliters?)\b/gi, '')
      .replace(/[\d\/\.]+/g, '').replace(/\(.*?\)/g, '')
      .replace(/\b(approx|about|roughly|fresh|dried|chopped|sliced|diced|minced|cooked|raw)\b/gi, '')
      .trim();
    if (!searchQuery || searchQuery.length < 2) return null;

    const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
      params: { query: searchQuery, api_key: USDA_KEY, dataType: 'SR Legacy,Foundation', pageSize: 3 },
      timeout: 5000
    });

    // Pick the best match — prefer whole foods over processed
    const foods = res.data.foods || [];
    const food = foods.find(f => !f.description?.toLowerCase().includes('dry mix') && !f.description?.toLowerCase().includes('powder')) || foods[0];
    if (!food) return null;

    const nutrients = {};
    for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
      const n = food.foodNutrients?.find(n => n.nutrientId === id);
      nutrients[key] = n?.value || 0;
    }
    return nutrients;
  } catch { return null; }
}

async function calculateNutritionFromUSDA(ingredients, servings, profile, groceryList = []) {
  const rdi = getPersonalizedRDI(profile);
  const totals = Object.fromEntries(Object.keys(NUTRIENT_IDS).map(k => [k, 0]));

  await Promise.all(ingredients.map(async (ing) => {
    if (shouldSkipIngredient(ing)) return;
    const grams = parseIngredientGrams(ing);
    if (grams <= 0) return;

    // Check if ingredient matches a grocery item — use its logged nutrition
    const ingLower = ing.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const groceryMatch = groceryList.find(g => {
      const gName = (g.name || '').toLowerCase();
      return ingLower.includes(gName) || gName.split(' ').some(w => w.length > 3 && ingLower.includes(w));
    });

    if (groceryMatch?.nutrition) {
      const scale = grams / (groceryMatch.weight || 100);
      for (const key of Object.keys(NUTRIENT_IDS)) {
        totals[key] += (groceryMatch.nutrition[key] || 0) * scale;
      }
      return;
    }

    const nutrients = await lookupUSDA(ing);
    if (!nutrients) return;
    for (const key of Object.keys(NUTRIENT_IDS)) {
      totals[key] += (nutrients[key] || 0) * (grams / 100);
    }
  }));

  const s = Math.max(1, servings);
  const caloriesPerServing = totals.calories / s;

  // Sanity check: a single serving shouldn't exceed 1500 kcal for most meals
  // If it does, something was double-counted — scale everything down proportionally
  const maxReasonableCalories = 1500;
  const scaleFactor = caloriesPerServing > maxReasonableCalories ? maxReasonableCalories / caloriesPerServing : 1;

  const fmt = (key, unit) => {
    const amount = Math.round((totals[key] / s) * scaleFactor * 10) / 10;
    return { amount, unit, rdi: Math.min(Math.round((amount / (rdi[key] || 1)) * 100), 999) };
  };

  return {
    perServing: {
      macros: {
        calories: fmt('calories', 'kcal'), protein: fmt('protein', 'g'),
        carbohydrates: fmt('carbohydrates', 'g'), fat: fmt('fat', 'g'),
        saturatedFat: fmt('saturatedFat', 'g'), fiber: fmt('fiber', 'g'),
        sugar: fmt('sugar', 'g'), sodium: fmt('sodium', 'mg'),
      },
      vitamins: {
        vitaminA: fmt('vitaminA', 'µg'), vitaminB1: fmt('vitaminB1', 'mg'),
        vitaminB2: fmt('vitaminB2', 'mg'), vitaminB3: fmt('vitaminB3', 'mg'),
        vitaminB5: fmt('vitaminB5', 'mg'), vitaminB6: fmt('vitaminB6', 'mg'),
        vitaminB7: fmt('vitaminB7', 'µg'), vitaminB9: fmt('vitaminB9', 'µg'),
        vitaminB12: fmt('vitaminB12', 'µg'), vitaminC: fmt('vitaminC', 'mg'),
        vitaminD: fmt('vitaminD', 'µg'), vitaminE: fmt('vitaminE', 'mg'),
        vitaminK: fmt('vitaminK', 'µg'),
      },
      minerals: {
        calcium: fmt('calcium', 'mg'), iron: fmt('iron', 'mg'),
        magnesium: fmt('magnesium', 'mg'), phosphorus: fmt('phosphorus', 'mg'),
        potassium: fmt('potassium', 'mg'), zinc: fmt('zinc', 'mg'),
        copper: fmt('copper', 'mg'), manganese: fmt('manganese', 'mg'),
        selenium: fmt('selenium', 'µg'), iodine: fmt('iodine', 'µg'),
        chromium: fmt('chromium', 'µg'), molybdenum: fmt('molybdenum', 'µg'),
        fluoride: fmt('fluoride', 'mg'),
      }
    }
  };
}

// ── Extract audio and transcribe with Groq Whisper ──
async function transcribeVideo(videoPath) {
  try {
    const audioPath = videoPath.replace('.mp4', '_audio.mp3');
    // Extract audio with ffmpeg
    await new Promise((resolve, reject) => {
      exec(`"${ffmpegPath}" -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}" -y`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    if (!fs.existsSync(audioPath)) return null;

    // Transcribe with Groq Whisper
    const audioData = fs.readFileSync(audioPath);
    const formData = new (require('form-data'))();
    formData.append('file', audioData, { filename: 'audio.mp3', contentType: 'audio/mp3' });
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'text');

    const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
      headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      timeout: 60000
    });

    try { fs.unlinkSync(audioPath); } catch {}
    return response.data || null;
  } catch (err) {
    console.error('Transcription failed:', err.message);
    return null;
  }
}
async function analyzeFramesMultiPass(frames, transcript = null) {
  const batches = [];
  for (let i = 0; i < frames.length; i += 5) batches.push(frames.slice(i, i + 5));

  const results = await Promise.all(batches.map(async (batch, idx) => {
    const imageMessages = batch.map(f => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` }
    }));
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [
        ...imageMessages,
        { type: 'text', text: `Frames ${idx * 5 + 1}-${idx * 5 + batch.length} of a cooking video.
List EVERY ingredient visible including briefly shown ones, on-screen text, and text overlays showing measurements.
Include exact quantities shown (e.g. "900g potatoes", "60g Sriracha", "1 large egg", "60g cornflour").
Note cooking steps and temperatures/times shown on screen.
Return ONLY JSON: {"ingredients":["qty ingredient"],"steps":["action with temp/time if shown"],"notes":"any text overlays or numbers visible"}` }
      ]}],
      max_tokens: 800, temperature: 0.2
    });
    try { return JSON.parse(response.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]); }
    catch { return { ingredients: [], steps: [], notes: '' }; }
  }));

  // Smart dedup: keep ingredient version with a quantity
  const seen = new Map();
  for (const ing of results.flatMap(r => r?.ingredients || [])) {
    const key = ing.toLowerCase().replace(/[\d\/\.\s,()]+/g, '').replace(/\b(g|kg|oz|lb|cup|tbsp|tsp|ml|l|grams?|pounds?)\b/g, '').trim();
    const existing = seen.get(key);
    const hasQty = /\d/.test(ing);
    const existingHasQty = existing && /\d/.test(existing);
    if (!existing || (hasQty && !existingHasQty) || (hasQty && existingHasQty && ing.length > existing.length)) {
      seen.set(key, ing);
    }
  }
  const allIngredients = [...seen.values()];
  const allSteps = results.flatMap(r => r?.steps || []);
  const allNotes = results.map(r => r?.notes || '').filter(Boolean).join(' ');

  const transcriptSection = transcript
    ? `FULL VIDEO TRANSCRIPT — this is the most accurate source, the creator speaks every ingredient and amount:
"${transcript}"

`
    : '';

  const finalResponse = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `You are a professional chef. Extract the complete recipe from this cooking video data.

${transcriptSection}VISUAL FRAME ANALYSIS:
Ingredients spotted: ${allIngredients.join(', ')}
Steps seen: ${allSteps.join(' | ')}
Notes: ${allNotes}

Rules:
- The transcript is the HIGHEST PRIORITY source. Extract exact ingredients and amounts mentioned in it.
- Supplement with visually spotted ingredients not mentioned in transcript.
- Merge duplicates — prefer the version with a specific quantity.
- ALL ingredient quantities must be TOTAL for the whole recipe (not per serving).
- Include cooking temperatures and times in steps where mentioned.
- Estimate servings from total quantities.
- servingWeight = total estimated cooked weight (g) / servings.

Return ONLY valid JSON (no markdown):
{"title":"","description":"","ingredients":["900g potatoes","800g chicken breast","60g Sriracha","60g honey","1 large egg","60g cornflour"],"steps":["Step with temp/time"],"cookTime":35,"servings":4,"servingWeight":320,"difficulty":"easy","cost":8.50}` }],
    max_tokens: 2000, temperature: 0.1
  });

  try { return JSON.parse(finalResponse.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]) || {}; }
  catch { return {}; }
}

// ── Pick best frame ──
async function pickBestFrame(frames) {
  try {
    const step = Math.max(1, Math.floor(frames.length / 5));
    const candidates = [0, 1, 2, 3, 4].map(i => frames[Math.min(i * step, frames.length - 1)]);
    const msgs = candidates.map((f, i) => ([
      { type: 'text', text: `Frame ${i + 1}:` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` } }
    ])).flat();
    const res = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [...msgs, { type: 'text', text: 'Which frame shows the most appetizing finished plated dish? Reply ONLY: {"frame":3}' }] }],
      max_tokens: 20, temperature: 0
    });
    const m = res.choices[0].message.content.match(/"frame"\s*:\s*(\d+)/);
    const idx = Math.max(0, Math.min((m ? parseInt(m[1]) : 5) - 1, 4));
    // Return the index into the original frames array
    return idx * step;
  } catch { return frames.length - 1; }
}

// ── Shared analyze handler ──
async function analyzeVideo(videoPath, profile, res) {
  let frames = [];
  try {
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');

    // Run transcription + frame picking in parallel with multi-pass analysis
    const [transcript, bestFrameIdx] = await Promise.all([
      transcribeVideo(videoPath),
      pickBestFrame(frames)
    ]);

    if (transcript) console.log('✅ Transcript:', transcript.slice(0, 100) + '...');

    const recipe = await analyzeFramesMultiPass(frames, transcript);

    // Store frames AND video in session for frontend playback
    const sessionId = createSession(frames, videoPath);
    recipe.sessionId = sessionId;
    recipe.frameCount = frames.length;
    recipe.bestFrame = bestFrameIdx;
    recipe.hasVideo = true;
    recipe.image = null; // frontend uses session endpoint

    // USDA nutrition
    if (USDA_KEY && recipe.ingredients?.length) {
      try {
        recipe.nutrition = await calculateNutritionFromUSDA(recipe.ingredients, recipe.servings || 4, profile, req.body.groceries || []);
        recipe.nutritionSource = 'usda';
      } catch (err) {
        console.error('USDA failed:', err.message);
        recipe.nutritionSource = 'estimated';
      }
    } else {
      recipe.nutritionSource = 'estimated';
    }

    // Video kept alive in session for playback — session auto-cleans after 1hr
    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath); // cleanup on error only
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/analyze-upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let profile = null;
  try { profile = req.body.profile ? JSON.parse(req.body.profile) : null; } catch {}
  await analyzeVideo(req.file.path, profile, res);
});

app.post('/api/analyze-video', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Valid URL required' });
  let profile = null;
  try { profile = req.body.profile ? JSON.parse(req.body.profile) : null; } catch {}
  try {
    const videoPath = await downloadVideo(url);
    await analyzeVideo(videoPath, profile, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-recipes', async (req, res) => {
  const { ingredients, primaryIngredients, count, profile } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingredients required' });
  const profileInfo = profile ? `User: ${profile.age}y, ${profile.sex}, ${profile.weight}kg, ${profile.activity}, ${profile.training}.` : '';
  const n = Math.min(count || 2, 10);
  const primaryNote = primaryIngredients?.length
    ? `IMPORTANT: Generate recipes where the PRIMARY ingredients are: ${primaryIngredients.join(', ')}. These must be the main focus of each recipe.`
    : '';
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `You are a creative chef. ${profileInfo}
Available ingredients: ${ingredients.join(', ')}
${primaryNote}
Generate ${n} recipe ideas using these ingredients. Return ONLY a valid JSON array (no markdown):
[{"title":"","description":"","ingredients":["qty ingredient"],"cookTime":25,"difficulty":"easy","cost":8.50}]` }],
      max_tokens: n > 2 ? 4000 : 1000, temperature: 0.7
    });
    let recipes = [];
    try { recipes = JSON.parse(response.choices[0].message.content.match(/\[[\s\S]*\]/)?.[0]); } catch {}
    const images = [
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
      'https://images.unsplash.com/photo-1504674900769-7f88ad4a5c20?w=400&h=300&fit=crop',
    ];
    res.json({ recipes: recipes.map((r, i) => ({ ...r, image: images[i % images.length] })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Estimate nutrition + price for a grocery item ──
app.post('/api/estimate-grocery', async (req, res) => {
  const { name, weight } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const w = weight || 100;

  let usdaNutrition = null;
  if (USDA_KEY) {
    try {
      const usdaRes = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
        params: { query: name, api_key: USDA_KEY, dataType: 'SR Legacy,Foundation', pageSize: 1 },
        timeout: 5000
      });
      const food = usdaRes.data.foods?.[0];
      if (food) {
        const get = (id) => food.foodNutrients?.find(n => n.nutrientId === id)?.value || 0;
        usdaNutrition = {
          calories: get(1008), protein: get(1003), fat: get(1004), carbohydrates: get(1005),
          fiber: get(1079), sugar: get(1063), sodium: get(1093), saturatedFat: get(1258),
          vitaminA: get(1106), vitaminB1: get(1165), vitaminB2: get(1166), vitaminB3: get(1167),
          vitaminB5: get(1170), vitaminB6: get(1175), vitaminB7: get(1176), vitaminB9: get(1177),
          vitaminB12: get(1178), vitaminC: get(1162), vitaminD: get(1114), vitaminE: get(1109),
          vitaminK: get(1185), calcium: get(1087), iron: get(1089), magnesium: get(1090),
          phosphorus: get(1091), potassium: get(1092), zinc: get(1095), copper: get(1098),
          manganese: get(1101), selenium: get(1103), iodine: get(1100), chromium: get(1096),
          molybdenum: get(1102), fluoride: get(1099)
        };
      }
    } catch {}
  }

  // Estimate price with Groq
  let estimatedPrice = 0;
  try {
    const priceRes = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `What is the typical retail price in EUR for ${w}g of "${name}" at a European supermarket? Reply ONLY with a JSON object: {"price": 1.50}` }],
      max_tokens: 50, temperature: 0.1
    });
    const m = priceRes.choices[0].message.content.match(/"price"\s*:\s*([\d.]+)/);
    if (m) estimatedPrice = parseFloat(m[1]);
  } catch {}

  // If no USDA, estimate with Groq
  if (!usdaNutrition) {
    try {
      const nutRes = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `Estimate nutrition values per ${w}g of "${name}". Return ONLY JSON (no markdown):
{"calories":0,"protein":0,"fat":0,"carbohydrates":0,"fiber":0,"sugar":0,"sodium":0,"saturatedFat":0,"vitaminA":0,"vitaminB1":0,"vitaminB2":0,"vitaminB3":0,"vitaminB5":0,"vitaminB6":0,"vitaminB7":0,"vitaminB9":0,"vitaminB12":0,"vitaminC":0,"vitaminD":0,"vitaminE":0,"vitaminK":0,"calcium":0,"iron":0,"magnesium":0,"phosphorus":0,"potassium":0,"zinc":0,"copper":0,"manganese":0,"selenium":0,"iodine":0,"chromium":0,"molybdenum":0,"fluoride":0}` }],
        max_tokens: 500, temperature: 0.1
      });
      usdaNutrition = JSON.parse(nutRes.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]) || {};
    } catch {}
  }

  res.json({
    nutrition: usdaNutrition || {},
    price: estimatedPrice,
    source: USDA_KEY && usdaNutrition ? 'usda' : 'estimated'
  });
});

// ── Recalculate nutrition + cost from edited ingredients ──
app.post('/api/recalculate', async (req, res) => {
  // ingredients can be [{text, price}] or plain strings — normalize both
  const rawIngredients = req.body.ingredients || [];
  if (!rawIngredients.length) return res.status(400).json({ error: 'Ingredients required' });

  const ingredients = rawIngredients.map(i => typeof i === 'string' ? { text: i, price: 0 } : i);
  const ingTexts = ingredients.map(i => i.text).filter(Boolean);
  const { servings, profile, groceries = [] } = req.body;
  const s = Math.max(1, servings || 4);

  try {
    // USDA nutrition
    let nutrition = null;
    let nutritionSource = 'estimated';
    if (USDA_KEY) {
      try {
        nutrition = await calculateNutritionFromUSDA(ingTexts, s, profile || null, groceries);
        nutritionSource = 'usda';
      } catch {}
    }

    // If no USDA key, ask Groq to estimate nutrition for just the new ingredients
    if (!nutrition) {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `Estimate nutrition per serving for a recipe with these total ingredients divided by ${s} servings:
${ingTexts.join('\n')}
Return ONLY JSON with the same nutrition structure as before (macros, vitamins, minerals with amount/unit/rdi fields).` }],
        max_tokens: 2000, temperature: 0.2
      });
      try {
        const parsed = JSON.parse(response.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]);
        nutrition = parsed.nutrition || parsed;
        nutritionSource = 'estimated';
      } catch {}
    }

    // Cost: sum user-provided prices, estimate missing ones with Groq
    const withPrices = ingredients.filter(i => i.price > 0);
    const withoutPrices = ingredients.filter(i => !i.price || i.price <= 0);

    let estimatedPrices = {};
    if (withoutPrices.length > 0) {
      try {
        const priceRes = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: `Estimate the cost in EUR for each of these ingredients at a typical European supermarket.
${withoutPrices.map((i, idx) => `${idx}: ${i.text}`).join('\n')}
Return ONLY a JSON object mapping index to price: {"0": 1.20, "1": 0.50}` }],
          max_tokens: 200, temperature: 0.2
        });
        estimatedPrices = JSON.parse(priceRes.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]) || {};
      } catch {}
    }

    const totalCost = withPrices.reduce((sum, i) => sum + (i.price || 0), 0)
      + withoutPrices.reduce((sum, i, idx) => sum + (parseFloat(estimatedPrices[idx]) || 0), 0);

    const costPerServing = Math.round((totalCost / s) * 100) / 100;

    res.json({
      nutrition,
      nutritionSource,
      cost: Math.round(totalCost * 100) / 100,
      costPerServing,
      estimatedPrices: withoutPrices.map((i, idx) => ({
        text: i.text,
        price: parseFloat(estimatedPrices[idx]) || 0
      }))
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Match ingredient text to grocery list + scale price by weight ──
app.post('/api/match-ingredient', async (req, res) => {
  const { text, groceries = [] } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const grams = parseIngredientGrams(text);
  const textLower = text.toLowerCase().replace(/[^a-z\s]/g, '').trim();

  // Try to match against grocery list first
  const match = groceries.find(g => {
    const name = (g.name || '').toLowerCase();
    return textLower.includes(name) || name.split(' ').some(w => w.length > 3 && textLower.includes(w));
  });

  if (match) {
    // Scale price from grocery's stored weight to ingredient weight
    const groceryWeight = match.weight || 100;
    const scaledPrice = match.price ? Math.round((match.price * grams / groceryWeight) * 100) / 100 : 0;
    return res.json({ matched: true, groceryName: match.name, grams, price: scaledPrice, source: 'grocery' });
  }

  // No grocery match — estimate price with Groq
  try {
    const priceRes = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `Estimate the cost in EUR for "${text}" (approximately ${Math.round(grams)}g) at a typical European supermarket. Reply ONLY: {"price": 1.50}` }],
      max_tokens: 30, temperature: 0.1
    });
    const m = priceRes.choices[0].message.content.match(/"price"\s*:\s*([\d.]+)/);
    const price = m ? parseFloat(m[1]) : 0;
    return res.json({ matched: false, grams, price, source: 'estimated' });
  } catch {
    return res.json({ matched: false, grams, price: 0, source: 'none' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', groq: !!process.env.GROQ_API_KEY, usda: !!USDA_KEY }));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
