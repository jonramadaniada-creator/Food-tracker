const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── Serve frontend ──
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── yt-dlp setup ──
const ytDlpBinaryPath = path.join('/tmp', 'yt-dlp');
let ytDlp;

async function getYtDlp() {
  if (!ytDlp) {
    await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
    ytDlp = new YTDlpWrap(ytDlpBinaryPath);
  }
  return ytDlp;
}

// ── Helpers ──
function isYouTube(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

async function downloadVideo(url) {
  const videoPath = path.join('/tmp', `video_${Date.now()}.mp4`);
  const yt = await getYtDlp();
  // Use a permissive format: prefer mp4, fall back to anything available
  await yt.execPromise([
    url,
    '-f', 'mp4/best',
    '--merge-output-format', 'mp4',
    '-o', videoPath
  ]);
  return videoPath;
}

async function extractFrames(videoPath) {
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });
  return new Promise((resolve, reject) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" -vf "fps=0.2,scale=640:-1" "${frameDir}/frame_%03d.jpg"`, (err) => {
      if (err) { reject(new Error('Failed to extract frames')); return; }
      const frames = fs.readdirSync(frameDir)
        .filter(f => f.endsWith('.jpg'))
        .slice(0, 8)
        .map(f => path.join(frameDir, f));
      resolve(frames);
    });
  });
}

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

async function callGemini(parts) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts }] }
  );
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const RECIPE_PROMPT = `Analyze this cooking video and extract the recipe. Return ONLY valid JSON:
{
  "title": "Recipe Name",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "cookTime": 30,
  "servings": 4,
  "difficulty": "easy",
  "cost": 8.50
}`;

// ── API Routes ──
app.post('/api/analyze-video', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid URL. Please paste a valid Instagram, TikTok, or YouTube link.' });
  }

  let videoPath, frames = [];
  try {
    let text;

    if (isYouTube(url)) {
      // YouTube: pass URL directly to Gemini, no download needed
      text = await callGemini([
        { file_data: { mime_type: 'video/mp4', file_uri: url } },
        { text: RECIPE_PROMPT }
      ]);
    } else {
      // Instagram / TikTok / other: download and extract frames
      videoPath = await downloadVideo(url);
      frames = await extractFrames(videoPath);
      if (!frames.length) throw new Error('No frames extracted');

      const imageParts = frames.map(f => ({
        inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') }
      }));
      text = await callGemini([...imageParts, { text: RECIPE_PROMPT }]);
      cleanup(videoPath, frames);
    }

    let recipe = {};
    try { recipe = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]); } catch {}
    recipe.image = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';

    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath, frames);
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', gemini: !!GEMINI_API_KEY }));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ RecipeBox running on port ${PORT}`));
