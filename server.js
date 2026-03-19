const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ── File upload ──
const upload = multer({ dest: '/tmp/uploads/' });

// ── Serve frontend ──
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Helpers ──
async function extractFrames(videoPath) {
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  // Step 1: get video duration
  const duration = await new Promise((resolve) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" 2>&1 | grep Duration`, (err, stdout) => {
      const match = stdout.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        resolve(secs);
      } else {
        resolve(60); // fallback
      }
    });
  });

  // Step 2: pick fps so we get ~20 frames regardless of video length
  // For a 15s reel: 20/15 = 1.33fps. For a 60s video: 20/60 = 0.33fps. Min 1fps for short clips.
  const targetFrames = 20;
  const fps = Math.max(1, Math.min(4, targetFrames / duration)).toFixed(2);

  return new Promise((resolve, reject) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" -vf "fps=${fps},scale=640:-1" "${frameDir}/frame_%03d.jpg"`, (err) => {
      if (err) { reject(new Error('Failed to extract frames')); return; }
      const frames = fs.readdirSync(frameDir)
        .filter(f => f.endsWith('.jpg'))
        .slice(0, 20)
        .map(f => path.join(frameDir, f));
      resolve(frames);
    });
  });
}

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

const RECIPE_PROMPT = `You are analyzing frames from a cooking video (likely a fast-paced Instagram Reel or TikTok). 
The frames are sampled throughout the full video, so ingredients or steps shown quickly are included.

Your job: identify every ingredient shown or mentioned, and reconstruct the full recipe.

Rules:
- Look for text overlays, ingredients on screen, cooking actions, and finished dish
- If an ingredient appears briefly, still include it
- Estimate quantities based on what you see (e.g. "2 chicken breasts", "1 cup flour")
- Estimate cook time from the cooking steps shown
- Estimate cost in EUR based on typical European grocery prices
- Difficulty: easy / medium / hard

Return ONLY valid JSON, no extra text:
{
  "title": "Recipe Name",
  "description": "One sentence description of the dish",
  "ingredients": ["2 chicken breasts", "1 cup flour", "..."],
  "steps": ["Step 1", "Step 2", "..."],
  "cookTime": 25,
  "servings": 2,
  "difficulty": "easy",
  "cost": 8.50
}`;

// ── Upload + analyze ──
app.post('/api/analyze-upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const videoPath = req.file.path;
  let frames = [];
  try {
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');

    const imageParts = frames.map(f => ({
      inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(f).toString('base64') }
    }));

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [...imageParts, { text: RECIPE_PROMPT }] }]
    });

    const text = result.response.text();
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

// ── Generate recipe ideas from ingredients ──
app.post('/api/generate-recipes', async (req, res) => {
  const { ingredients } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingredients required' });
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a creative chef. Based on these available ingredients: ${ingredients.join(', ')}

Generate 2 realistic recipe ideas I can make. Return ONLY a valid JSON array:
[
  {
    "title": "Recipe Name",
    "description": "One sentence description",
    "ingredients": ["ingredient with quantity", "..."],
    "cookTime": 25,
    "difficulty": "easy",
    "cost": 8.50
  }
]` }] }]
    });
    const text = result.response.text();
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', gemini: !!process.env.GEMINI_API_KEY }));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
