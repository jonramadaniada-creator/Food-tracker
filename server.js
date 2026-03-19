const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGemini(parts) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts }] }
  );
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function isYouTube(url) {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

async function downloadAndExtractFrames(url) {
  const videoPath = path.join('/tmp', `video_${Date.now()}.mp4`);
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  // Download
  await new Promise((resolve, reject) => {
    exec(`yt-dlp -f "best[ext=mp4][height<=480]/best[height<=480]/best" -o "${videoPath}" "${url}"`, 
      { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Download failed: ${stderr}`));
      else resolve();
    });
  });

  // Extract frames (1 every 5 seconds, max 8)
  await new Promise((resolve, reject) => {
    exec(`ffmpeg -i "${videoPath}" -vf "fps=0.2,scale=640:-1" "${frameDir}/frame_%03d.jpg"`,
      { timeout: 30000 }, (err) => {
      if (err) reject(new Error('Frame extraction failed'));
      else resolve();
    });
  });

  const frames = fs.readdirSync(frameDir)
    .filter(f => f.endsWith('.jpg'))
    .slice(0, 8)
    .map(f => path.join(frameDir, f));

  return { videoPath, frames };
}

// Analyze video
app.post('/api/analyze-video', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const recipePrompt = `Analyze this cooking video and extract the recipe. Return ONLY valid JSON:
{
  "title": "Recipe Name",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "cookTime": 30,
  "servings": 4,
  "difficulty": "easy",
  "cost": 8.50
}`;

  try {
    let text;

    if (isYouTube(url)) {
      // YouTube — pass URL directly to Gemini
      text = await callGemini([
        { fileData: { mimeType: 'video/mp4', fileUri: url } },
        { text: recipePrompt }
      ]);
    } else {
      // Instagram / TikTok — download frames first
      const { videoPath, frames } = await downloadAndExtractFrames(url);

      const imageParts = frames.map(f => ({
        inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') }
      }));

      text = await callGemini([...imageParts, { text: recipePrompt }]);
      cleanup(videoPath, frames);
    }

    let recipe = {};
    try { recipe = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]); } catch {}
    recipe.image = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';

    res.json({ recipe });
  } catch (err) {
    console.error('analyze-video error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate recipes from ingredients
app.post('/api/generate-recipes', async (req, res) => {
  const { ingredients } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingredients required' });

  try {
    const text = await callGemini([{ text: `Based on: ${ingredients.join(', ')}

Generate 2 recipe ideas. Return ONLY a valid JSON array:
[
  {
    "title": "Recipe Name",
    "description": "Brief description",
    "ingredients": ["item 1", "item 2"],
    "cookTime": 25,
    "difficulty": "easy",
    "cost": 8.50
  }
]` }]);

    let recipes = [];
    try { recipes = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0]); } catch {}

    const images = [
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
      'https://images.unsplash.com/photo-1504674900769-7f88ad4a5c20?w=400&h=300&fit=crop',
    ];
    res.json({ recipes: recipes.map((r, i) => ({ ...r, image: images[i % images.length] })) });
  } catch (err) {
    console.error('generate-recipes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', gemini: !!GEMINI_API_KEY }));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
