const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const Groq = require('groq-sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const upload = multer({ dest: '/tmp/uploads/' });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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

  const fps = Math.max(1, Math.min(4, (20 / duration))).toFixed(2);

  return new Promise((resolve, reject) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" -vf "fps=${fps},scale=640:-1" "${frameDir}/frame_%03d.jpg"`, (err) => {
      if (err) { reject(new Error('Failed to extract frames')); return; }
      const frames = fs.readdirSync(frameDir)
        .filter(f => f.endsWith('.jpg'))
        .slice(0, 10) // Groq has lower token limits so use 10 frames
        .map(f => path.join(frameDir, f));
      resolve(frames);
    });
  });
}

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

function buildRecipePrompt(profile) {
  const profileInfo = profile
    ? `User profile: Age ${profile.age}, ${profile.sex}, ${profile.height}cm, ${profile.weight}kg, activity: ${profile.activity}, training: ${profile.training}. Use this to calculate personalized daily RDI percentages.`
    : `Use standard adult RDI values (2000 kcal reference diet).`;

  return `You are a professional nutritionist and chef analyzing frames from a fast-paced cooking video (Instagram Reel / TikTok).
Frames are sampled throughout the full video — look for text overlays, ingredients shown briefly, cooking actions, and the final dish.

${profileInfo}

Extract the complete recipe AND full nutritional breakdown per serving.
Return ONLY valid JSON (no extra text, no markdown):
{
  "title": "Recipe Name",
  "description": "One sentence description",
  "ingredients": ["2 chicken breasts", "1 cup flour"],
  "steps": ["Step 1", "Step 2"],
  "cookTime": 25,
  "servings": 2,
  "difficulty": "easy",
  "cost": 8.50,
  "nutrition": {
    "perServing": {
      "macros": {
        "calories": { "amount": 450, "unit": "kcal", "rdi": 22 },
        "protein": { "amount": 35, "unit": "g", "rdi": 70 },
        "carbohydrates": { "amount": 40, "unit": "g", "rdi": 15 },
        "fat": { "amount": 14, "unit": "g", "rdi": 18 },
        "saturatedFat": { "amount": 3, "unit": "g", "rdi": 15 },
        "fiber": { "amount": 4, "unit": "g", "rdi": 14 },
        "sugar": { "amount": 6, "unit": "g", "rdi": 7 },
        "sodium": { "amount": 520, "unit": "mg", "rdi": 23 }
      },
      "vitamins": {
        "vitaminA": { "amount": 120, "unit": "µg", "rdi": 13 },
        "vitaminB1": { "amount": 0.4, "unit": "mg", "rdi": 33 },
        "vitaminB2": { "amount": 0.3, "unit": "mg", "rdi": 23 },
        "vitaminB3": { "amount": 8, "unit": "mg", "rdi": 50 },
        "vitaminB5": { "amount": 1.2, "unit": "mg", "rdi": 24 },
        "vitaminB6": { "amount": 0.6, "unit": "mg", "rdi": 35 },
        "vitaminB7": { "amount": 10, "unit": "µg", "rdi": 33 },
        "vitaminB9": { "amount": 40, "unit": "µg", "rdi": 10 },
        "vitaminB12": { "amount": 1.2, "unit": "µg", "rdi": 50 },
        "vitaminC": { "amount": 15, "unit": "mg", "rdi": 17 },
        "vitaminD": { "amount": 2, "unit": "µg", "rdi": 13 },
        "vitaminE": { "amount": 2, "unit": "mg", "rdi": 13 },
        "vitaminK": { "amount": 30, "unit": "µg", "rdi": 25 }
      },
      "minerals": {
        "calcium": { "amount": 80, "unit": "mg", "rdi": 8 },
        "iron": { "amount": 3, "unit": "mg", "rdi": 17 },
        "magnesium": { "amount": 45, "unit": "mg", "rdi": 11 },
        "phosphorus": { "amount": 280, "unit": "mg", "rdi": 40 },
        "potassium": { "amount": 520, "unit": "mg", "rdi": 11 },
        "zinc": { "amount": 3, "unit": "mg", "rdi": 27 },
        "copper": { "amount": 0.2, "unit": "mg", "rdi": 22 },
        "manganese": { "amount": 0.5, "unit": "mg", "rdi": 22 },
        "selenium": { "amount": 25, "unit": "µg", "rdi": 45 },
        "iodine": { "amount": 40, "unit": "µg", "rdi": 27 },
        "chromium": { "amount": 10, "unit": "µg", "rdi": 29 },
        "molybdenum": { "amount": 20, "unit": "µg", "rdi": 44 },
        "fluoride": { "amount": 0.3, "unit": "mg", "rdi": 8 }
      }
    }
  }
}`;
}

// ── Upload + analyze ──
app.post('/api/analyze-upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let profile = null;
  try { profile = req.body.profile ? JSON.parse(req.body.profile) : null; } catch {}

  const videoPath = req.file.path;
  let frames = [];
  try {
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');

    // Build image content for Groq vision
    const imageMessages = frames.map(f => ({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`
      }
    }));

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            ...imageMessages,
            { type: 'text', text: buildRecipePrompt(profile) }
          ]
        }
      ],
      max_tokens: 4000,
      temperature: 0.3
    });

    const text = response.choices[0].message.content;
    let recipe = {};
    try { recipe = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]); } catch {}
    recipe.image = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';

    cleanup(videoPath, frames);
    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath, frames);
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Generate recipe ideas ──
app.post('/api/generate-recipes', async (req, res) => {
  const { ingredients, profile } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingredients required' });

  const profileInfo = profile
    ? `User profile: Age ${profile.age}, ${profile.sex}, ${profile.height}cm, ${profile.weight}kg, activity: ${profile.activity}, training: ${profile.training}.`
    : '';

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `You are a creative chef. ${profileInfo}
Based on these available ingredients: ${ingredients.join(', ')}

Generate 2 realistic recipe ideas. Return ONLY a valid JSON array (no markdown):
[
  {
    "title": "Recipe Name",
    "description": "One sentence description",
    "ingredients": ["ingredient with quantity"],
    "cookTime": 25,
    "difficulty": "easy",
    "cost": 8.50
  }
]`
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });

    const text = response.choices[0].message.content;
    let recipes = [];
    try { recipes = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0]); } catch {}

    const images = [
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
      'https://images.unsplash.com/photo-1504674900769-7f88ad4a5c20?w=400&h=300&fit=crop',
    ];
    res.json({ recipes: recipes.map((r, i) => ({ ...r, image: images[i % images.length] })) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', groq: !!process.env.GROQ_API_KEY }));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
