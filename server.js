const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
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

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

// ── USDA FoodData Central lookup ──

// Nutrient IDs in USDA database
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

// Standard RDI values (adult 2000 kcal)
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

// Calculate personalized RDI based on profile
function getPersonalizedRDI(profile) {
  if (!profile) return STANDARD_RDI;
  const age = parseInt(profile.age) || 25;
  const weight = parseFloat(profile.weight) || 70;
  const height = parseFloat(profile.height) || 175;
  const isMale = profile.sex === 'male';

  // Mifflin-St Jeor BMR
  const bmr = isMale
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;

  const activityMultipliers = {
    'sedentary': 1.2, 'lightly active': 1.375,
    'moderately active': 1.55, 'very active': 1.725, 'extremely active': 1.9
  };
  const tdee = bmr * (activityMultipliers[profile.activity] || 1.55);

  // Adjust protein for training
  const proteinMultiplier = ['weightlifting', 'calisthenics', 'mixed'].includes(profile.training) ? 2.0 : 1.6;
  const protein = Math.round(weight * proteinMultiplier);

  return {
    ...STANDARD_RDI,
    calories: Math.round(tdee),
    protein,
    fat: Math.round(tdee * 0.25 / 9),
    carbohydrates: Math.round(tdee * 0.45 / 4),
    // Scale vitamins/minerals by caloric needs vs 2000 baseline
    vitaminA: isMale ? 900 : 700,
    vitaminC: isMale ? 90 : 75,
    iron: isMale ? 8 : (age < 51 ? 18 : 8),
    magnesium: isMale ? (age < 31 ? 400 : 420) : (age < 31 ? 310 : 320),
    zinc: isMale ? 11 : 8,
  };
}

// Convert ingredient quantity string to grams
function parseIngredientGrams(ingredientStr) {
  const s = ingredientStr.toLowerCase();

  // Extract number (including fractions like 1/2)
  const numMatch = s.match(/(\d+(?:\.\d+)?(?:\/\d+)?)/);
  if (!numMatch) return { name: ingredientStr, grams: 100 };

  let qty = numMatch[1].includes('/') ? eval(numMatch[1]) : parseFloat(numMatch[1]);

  // Unit conversions to grams
  if (s.match(/\bkg\b/)) return { name: ingredientStr, grams: qty * 1000 };
  if (s.match(/\bg\b|\bgrams?\b/)) return { name: ingredientStr, grams: qty };
  if (s.match(/\blb\b|\bpound/)) return { name: ingredientStr, grams: qty * 454 };
  if (s.match(/\boz\b|\bounce/)) return { name: ingredientStr, grams: qty * 28 };
  if (s.match(/\bcup/)) return { name: ingredientStr, grams: qty * 240 };
  if (s.match(/\btbsp\b|\btablespoon/)) return { name: ingredientStr, grams: qty * 15 };
  if (s.match(/\btsp\b|\bteaspoon/)) return { name: ingredientStr, grams: qty * 5 };
  if (s.match(/\bml\b|\bmilliliter/)) return { name: ingredientStr, grams: qty };
  if (s.match(/\bl\b|\bliter/)) return { name: ingredientStr, grams: qty * 1000 };
  if (s.match(/\bslice/)) return { name: ingredientStr, grams: qty * 30 };
  if (s.match(/\bclove/)) return { name: ingredientStr, grams: qty * 5 };
  if (s.match(/\bpiece|\beach|\bwhole/)) return { name: ingredientStr, grams: qty * 100 };

  // No unit — assume it's a count, use 100g per item as fallback
  return { name: ingredientStr, grams: qty * 100 };
}

// Search USDA for a food and get nutrients per 100g
async function lookupUSDA(ingredientStr) {
  if (!USDA_KEY) return null;
  try {
    // Clean up ingredient string for search (remove quantities)
    const searchQuery = ingredientStr
      .replace(/[\d\/\.]+\s*(kg|g|lb|oz|cup|tbsp|tsp|ml|l|slice|clove|piece|each|whole|grams?|pounds?|ounces?|tablespoons?|teaspoons?|liters?|milliliters?)\b/gi, '')
      .replace(/[\d\/\.]+/g, '')
      .trim();

    if (!searchQuery || searchQuery.length < 2) return null;

    const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
      params: {
        query: searchQuery,
        api_key: USDA_KEY,
        dataType: 'SR Legacy,Foundation',
        pageSize: 1
      },
      timeout: 5000
    });

    const food = res.data.foods?.[0];
    if (!food) return null;

    // Extract nutrients per 100g
    const nutrients = {};
    for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
      const nutrient = food.foodNutrients?.find(n => n.nutrientId === id);
      nutrients[key] = nutrient?.value || 0;
    }
    return nutrients;
  } catch (err) {
    console.error(`USDA lookup failed for "${ingredientStr}":`, err.message);
    return null;
  }
}

// Calculate full nutrition from ingredients using USDA data
async function calculateNutritionFromUSDA(ingredients, servings, profile) {
  const rdi = getPersonalizedRDI(profile);
  const totals = Object.fromEntries(Object.keys(NUTRIENT_IDS).map(k => [k, 0]));

  await Promise.all(ingredients.map(async (ing) => {
    const { grams } = parseIngredientGrams(ing);
    const nutrients = await lookupUSDA(ing);
    if (!nutrients) return;
    for (const key of Object.keys(NUTRIENT_IDS)) {
      totals[key] += (nutrients[key] || 0) * (grams / 100);
    }
  }));

  // Per serving
  const perServing = {};
  for (const key of Object.keys(NUTRIENT_IDS)) {
    perServing[key] = Math.round((totals[key] / servings) * 10) / 10;
  }

  // Format into the nutrition structure
  const fmt = (key, unit) => ({
    amount: perServing[key],
    unit,
    rdi: Math.round((perServing[key] / rdi[key]) * 100)
  });

  return {
    perServing: {
      macros: {
        calories: fmt('calories', 'kcal'),
        protein: fmt('protein', 'g'),
        carbohydrates: fmt('carbohydrates', 'g'),
        fat: fmt('fat', 'g'),
        saturatedFat: fmt('saturatedFat', 'g'),
        fiber: fmt('fiber', 'g'),
        sugar: fmt('sugar', 'g'),
        sodium: fmt('sodium', 'mg'),
      },
      vitamins: {
        vitaminA: fmt('vitaminA', 'µg'),
        vitaminB1: fmt('vitaminB1', 'mg'),
        vitaminB2: fmt('vitaminB2', 'mg'),
        vitaminB3: fmt('vitaminB3', 'mg'),
        vitaminB5: fmt('vitaminB5', 'mg'),
        vitaminB6: fmt('vitaminB6', 'mg'),
        vitaminB7: fmt('vitaminB7', 'µg'),
        vitaminB9: fmt('vitaminB9', 'µg'),
        vitaminB12: fmt('vitaminB12', 'µg'),
        vitaminC: fmt('vitaminC', 'mg'),
        vitaminD: fmt('vitaminD', 'µg'),
        vitaminE: fmt('vitaminE', 'mg'),
        vitaminK: fmt('vitaminK', 'µg'),
      },
      minerals: {
        calcium: fmt('calcium', 'mg'),
        iron: fmt('iron', 'mg'),
        magnesium: fmt('magnesium', 'mg'),
        phosphorus: fmt('phosphorus', 'mg'),
        potassium: fmt('potassium', 'mg'),
        zinc: fmt('zinc', 'mg'),
        copper: fmt('copper', 'mg'),
        manganese: fmt('manganese', 'mg'),
        selenium: fmt('selenium', 'µg'),
        iodine: fmt('iodine', 'µg'),
        chromium: fmt('chromium', 'µg'),
        molybdenum: fmt('molybdenum', 'µg'),
        fluoride: fmt('fluoride', 'mg'),
      }
    }
  };
}

// ── Multi-pass video analysis (ingredients + steps only, no nutrition) ──
async function analyzeFramesMultiPass(frames) {
  const batches = [];
  for (let i = 0; i < frames.length; i += 5) batches.push(frames.slice(i, i + 5));

  const ingredientLists = await Promise.all(batches.map(async (batch, idx) => {
    const imageMessages = batch.map(f => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` }
    }));
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [
        ...imageMessages,
        { type: 'text', text: `Frames ${idx * 5 + 1}-${idx * 5 + batch.length} of a cooking video.
List EVERY ingredient visible, including anything shown briefly. Include quantities if visible (e.g. "900g potatoes", "2 tbsp olive oil").
Note any cooking steps you see.
Return ONLY JSON:
{"ingredients": ["quantity ingredient", "..."], "steps": ["action seen", "..."], "notes": "other observations"}` }
      ]}],
      max_tokens: 800,
      temperature: 0.2
    });
    try { return JSON.parse(response.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0]); }
    catch { return { ingredients: [], steps: [], notes: '' }; }
  }));

  const allIngredients = [...new Set(ingredientLists.flatMap(r => r?.ingredients || []))];
  const allSteps = ingredientLists.flatMap(r => r?.steps || []);
  const allNotes = ingredientLists.map(r => r?.notes || '').filter(Boolean).join(' ');

  // Final Groq call: compile recipe metadata only (no nutrition — USDA handles that)
  const finalResponse = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `You are a chef. Based on observations from a cooking video, compile the recipe.

OBSERVED INGREDIENTS:
${allIngredients.join('\n')}

OBSERVED STEPS:
${allSteps.join('\n')}

NOTES: ${allNotes}

Rules:
- Merge duplicates (prefer the version with a quantity)
- Estimate servings from total quantities
- servingWeight = total estimated cooked weight in grams / servings

Return ONLY valid JSON (no markdown):
{
  "title": "Recipe Name",
  "description": "One sentence description",
  "ingredients": ["900g potatoes", "400g chicken breast", "3 tbsp olive oil"],
  "steps": ["Step 1", "Step 2"],
  "cookTime": 25,
  "servings": 4,
  "servingWeight": 320,
  "difficulty": "easy",
  "cost": 8.50
}` }],
    max_tokens: 1500,
    temperature: 0.2
  });

  const text = finalResponse.choices[0].message.content;
  let recipe = {};
  try { recipe = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]); } catch {}
  return recipe;
}

// ── Pick best frame ──
async function pickBestFrame(frames) {
  try {
    const step = Math.floor(frames.length / 5);
    const candidates = [0, 1, 2, 3, 4].map(i => frames[Math.min(i * step, frames.length - 1)]);
    const imageMessages = candidates.map((f, i) => ([
      { type: 'text', text: `Frame ${i + 1}:` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` } }
    ])).flat();
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [...imageMessages, { type: 'text', text: `Which of these 5 frames shows the most appetizing finished dish? Reply ONLY: {"frame": 3}` }] }],
      max_tokens: 50, temperature: 0
    });
    const match = response.choices[0].message.content.match(/"frame"\s*:\s*(\d+)/);
    const idx = Math.max(0, Math.min((match ? parseInt(match[1]) : 5) - 1, 4));
    return `data:image/jpeg;base64,${fs.readFileSync(candidates[idx]).toString('base64')}`;
  } catch {
    return 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';
  }
}

// ── Shared analyze handler ──
async function analyzeVideo(videoPath, profile, res) {
  let frames = [];
  try {
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');

    const [recipe, image] = await Promise.all([
      analyzeFramesMultiPass(frames),
      pickBestFrame(frames)
    ]);

    recipe.image = image;

    // Use USDA for accurate nutrition if API key is set, otherwise fall back to Groq estimate
    if (USDA_KEY && recipe.ingredients?.length) {
      try {
        recipe.nutrition = await calculateNutritionFromUSDA(recipe.ingredients, recipe.servings || 4, profile);
        recipe.nutritionSource = 'usda';
      } catch (err) {
        console.error('USDA nutrition failed:', err.message);
        recipe.nutritionSource = 'estimated';
      }
    } else {
      recipe.nutritionSource = 'estimated';
    }

    cleanup(videoPath, frames);
    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath, frames);
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Routes ──
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
    console.error(err.message);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', groq: !!process.env.GROQ_API_KEY, usda: !!USDA_KEY }));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
