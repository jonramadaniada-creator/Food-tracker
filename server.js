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
function createSession(frames) {
  const id = randomUUID();
  sessions.set(id, { frames, created: Date.now() });
  // Auto-cleanup after 1 hour
  setTimeout(() => sessions.delete(id), 60 * 60 * 1000);
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
// List frames in session
app.get('/api/session/:id/frames', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session expired' });
  res.json({ count: session.frames.length });
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
  fiber: 1079, sugar: 1063, sodium: 1093, saturatedFat: 1258,
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

// ── FIXED gram parser ──
function parseIngredientGrams(ingredientStr) {
  const s = ingredientStr.toLowerCase().trim();

  // Try each unit pattern — look for NUMBER immediately followed by unit
  const patterns = [
    { re: /(\d+(?:\.\d+)?)\s*kg/, mult: 1000, max: 5000 },
    { re: /(\d+(?:\.\d+)?)\s*g(?:rams?)?(?:\s|$|,|\))/, mult: 1, max: 2000 },
    { re: /(\d+(?:\.\d+)?)\s*lbs?(?:\s|$)/, mult: 454, max: 3000 },
    { re: /(\d+(?:\.\d+)?)\s*oz(?:\s|$)/, mult: 28, max: 1500 },
    { re: /(\d+(?:\.\d+)?)\s*(?:cups?|c\.)/, mult: 240, max: 1500 },
    { re: /(\d+(?:\.\d+)?)\s*(?:tbsp|tablespoons?)/, mult: 15, max: 300 },
    { re: /(\d+(?:\.\d+)?)\s*(?:tsp|teaspoons?)/, mult: 5, max: 100 },
    { re: /(\d+(?:\.\d+)?)\s*(?:liters?|l\b)/, mult: 1000, max: 3000 },
    { re: /(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)/, mult: 1, max: 2000 },
  ];

  for (const { re, mult, max } of patterns) {
    const m = s.match(re);
    if (m) return Math.min(parseFloat(m[1]) * mult, max);
  }

  // Count-based (pieces, items, cloves etc)
  const countMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (countMatch) {
    const qty = parseFloat(countMatch[1]);
    if (s.includes('clove')) return Math.min(qty * 5, 50);
    if (s.includes('slice')) return Math.min(qty * 30, 200);
    if (s.includes('egg')) return Math.min(qty * 55, 330);
    return Math.min(qty * 80, 400); // generic item ~80g each, max 400g
  }
  return 100;
}

// ── USDA lookup ──
async function lookupUSDA(ingredientStr) {
  if (!USDA_KEY) return null;
  try {
    const searchQuery = ingredientStr
      .replace(/(\d+(?:\.\d+)?)\s*(kg|g|lb|oz|cup|tbsp|tsp|ml|l|grams?|pounds?|ounces?|tablespoons?|teaspoons?|liters?|milliliters?)\b/gi, '')
      .replace(/[\d\/\.]+/g, '').replace(/\(.*?\)/g, '').trim();
    if (!searchQuery || searchQuery.length < 2) return null;

    const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
      params: { query: searchQuery, api_key: USDA_KEY, dataType: 'SR Legacy,Foundation', pageSize: 1 },
      timeout: 5000
    });
    const food = res.data.foods?.[0];
    if (!food) return null;
    const nutrients = {};
    for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
      const n = food.foodNutrients?.find(n => n.nutrientId === id);
      nutrients[key] = n?.value || 0;
    }
    return nutrients;
  } catch { return null; }
}

async function calculateNutritionFromUSDA(ingredients, servings, profile) {
  const rdi = getPersonalizedRDI(profile);
  const totals = Object.fromEntries(Object.keys(NUTRIENT_IDS).map(k => [k, 0]));

  await Promise.all(ingredients.map(async (ing) => {
    const grams = parseIngredientGrams(ing);
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

// ── Multi-pass video analysis ──
async function analyzeFramesMultiPass(frames) {
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
List EVERY ingredient visible including briefly shown ones. Include quantities (e.g. "900g potatoes", "2 tbsp olive oil", "400g chicken").
Note cooking steps seen.
Return ONLY JSON: {"ingredients":["qty ingredient"],"steps":["action"],"notes":"observations"}` }
      ]}],
      max_tokens: 800, temperature: 0.2
    });
    try { return JSON.parse(response.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]); }
    catch { return { ingredients: [], steps: [], notes: '' }; }
  }));

  // Smart dedup: for similar ingredients keep the one with a quantity
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

  const finalResponse = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `You are a chef. Compile a recipe from these cooking video observations.

OBSERVED INGREDIENTS:
${allIngredients.join('\n')}

STEPS: ${allSteps.join(' | ')}
NOTES: ${allNotes}

Rules:
- Merge duplicates — if "potatoes" and "900g potatoes" both appear, use "900g potatoes"
- Do NOT multiply quantities — each ingredient appears once in the final list
- Estimate total servings from quantities shown
- servingWeight = total estimated cooked weight (g) / servings

Return ONLY valid JSON (no markdown):
{"title":"","description":"","ingredients":["900g potatoes","400g chicken"],"steps":["Step 1"],"cookTime":25,"servings":4,"servingWeight":320,"difficulty":"easy","cost":8.50}` }],
    max_tokens: 1500, temperature: 0.2
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

    const [recipe, bestFrameIdx] = await Promise.all([
      analyzeFramesMultiPass(frames),
      pickBestFrame(frames)
    ]);

    // Store frames in session for frontend frame picker
    const sessionId = createSession(frames);
    recipe.sessionId = sessionId;
    recipe.frameCount = frames.length;
    recipe.bestFrame = bestFrameIdx;

    // Set image to best frame URL (served from session endpoint)
    recipe.image = null; // frontend will use session endpoint

    // USDA nutrition
    if (USDA_KEY && recipe.ingredients?.length) {
      try {
        recipe.nutrition = await calculateNutritionFromUSDA(recipe.ingredients, recipe.servings || 4, profile);
        recipe.nutritionSource = 'usda';
      } catch (err) {
        console.error('USDA failed:', err.message);
        recipe.nutritionSource = 'estimated';
      }
    } else {
      recipe.nutritionSource = 'estimated';
    }

    cleanup(videoPath);
    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath);
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
  const { ingredients, profile } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingredients required' });
  const profileInfo = profile ? `User: ${profile.age}y, ${profile.sex}, ${profile.weight}kg, ${profile.activity}, ${profile.training}.` : '';
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `You are a creative chef. ${profileInfo}
Based on: ${ingredients.join(', ')}
Generate 2 recipe ideas. Return ONLY a valid JSON array (no markdown):
[{"title":"","description":"","ingredients":["qty ingredient"],"cookTime":25,"difficulty":"easy","cost":8.50}]` }],
      max_tokens: 1000, temperature: 0.7
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', groq: !!process.env.GROQ_API_KEY, usda: !!USDA_KEY }));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
