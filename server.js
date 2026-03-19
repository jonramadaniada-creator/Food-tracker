const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;
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

async function downloadVideo(url) {
  const videoPath = path.join('/tmp', `video_${Date.now()}.mp4`);
  const yt = await getYtDlp();
  await yt.execPromise([url, '-f', 'mp4/best', '--merge-output-format', 'mp4', '-o', videoPath]);
  return videoPath;
}

// ── Frame extraction - returns all frames ──
async function extractFrames(videoPath) {
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  const duration = await new Promise((resolve) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" 2>&1`, (err, stdout, stderr) => {
      const match = (stdout + stderr).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(match ? parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]) : 30);
    });
  });

  // Extract 20 frames spread across the full video
  const fps = Math.max(0.5, Math.min(4, (20 / duration))).toFixed(2);

  return new Promise((resolve, reject) => {
    exec(`"${ffmpegPath}" -i "${videoPath}" -vf "fps=${fps},scale=640:-1" "${frameDir}/frame_%03d.jpg"`, (err) => {
      if (err) { reject(new Error('Failed to extract frames')); return; }
      const frames = fs.readdirSync(frameDir)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .slice(0, 20)
        .map(f => path.join(frameDir, f));
      resolve(frames);
    });
  });
}

function cleanup(...paths) {
  paths.flat().forEach(p => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

// ── Multi-pass analysis: 4 passes of 5 frames each ──
async function analyzeFramesMultiPass(frames, profile) {
  // Split 20 frames into 4 batches of 5
  const batches = [];
  for (let i = 0; i < frames.length; i += 5) {
    batches.push(frames.slice(i, i + 5));
  }

  // Pass each batch to Groq asking only for ingredients seen
  const ingredientLists = await Promise.all(batches.map(async (batch, idx) => {
    const imageMessages = batch.map(f => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` }
    }));

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          ...imageMessages,
          {
            type: 'text',
            text: `These are frames ${idx * 5 + 1}-${idx * 5 + batch.length} from a cooking video.
List EVERY ingredient you can see in these frames, including anything shown briefly.
Include quantities/amounts if visible (e.g. "900g potatoes", "2 tbsp olive oil").
Also note any cooking steps or techniques you see happening.
Return ONLY a JSON object:
{
  "ingredients": ["ingredient with quantity", "..."],
  "steps": ["any cooking action you see", "..."],
  "notes": "any other observations about the dish or quantities"
}`
          }
        ]
      }],
      max_tokens: 800,
      temperature: 0.2
    });

    try {
      const text = response.choices[0].message.content;
      return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]);
    } catch {
      return { ingredients: [], steps: [], notes: '' };
    }
  }));

  // Combine all observations
  const allIngredients = [...new Set(ingredientLists.flatMap(r => r?.ingredients || []))];
  const allSteps = ingredientLists.flatMap(r => r?.steps || []);
  const allNotes = ingredientLists.map(r => r?.notes || '').filter(Boolean).join(' ');

  // Final call: compile full recipe + nutrition from combined data
  const profileInfo = profile
    ? `User profile: Age ${profile.age}, ${profile.sex}, ${profile.height}cm, ${profile.weight}kg, activity: ${profile.activity}, training: ${profile.training}. Calculate personalized RDI percentages.`
    : `Use standard adult RDI values (2000 kcal reference diet).`;

  const finalResponse = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{
      role: 'user',
      content: `You are a professional nutritionist and chef. Based on the following observations extracted from a cooking video, compile the complete recipe and full nutritional breakdown.

OBSERVED INGREDIENTS (from 4 passes through the video):
${allIngredients.join('\n')}

OBSERVED COOKING STEPS:
${allSteps.join('\n')}

ADDITIONAL NOTES:
${allNotes}

${profileInfo}

Rules:
- Merge duplicate ingredients (e.g. "potatoes" and "900g potatoes" → use "900g potatoes")
- Estimate servings from the quantities (e.g. 900g potatoes + other ingredients likely = 3-4 servings)
- servingWeight = total estimated cooked weight / servings
- ALL nutrition values must be for exactly 1 serving

Return ONLY valid JSON (no extra text, no markdown):
{
  "title": "Recipe Name",
  "description": "One sentence description",
  "ingredients": ["900g potatoes", "400g chicken breast", "3 tbsp olive oil"],
  "steps": ["Step 1", "Step 2"],
  "cookTime": 25,
  "servings": 4,
  "servingWeight": 320,
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
}`
    }],
    max_tokens: 4000,
    temperature: 0.2
  });

  const finalText = finalResponse.choices[0].message.content;
  let recipe = {};
  try { recipe = JSON.parse(finalText.match(/\{[\s\S]*\}/)?.[0]); } catch {}
  return recipe;
}

// ── Pick the best "finished dish" frame from the video ──
async function pickBestFrame(frames) {
  try {
    const imageMessages = frames.map((f, i) => ([
      { type: 'text', text: `Frame ${i + 1}:` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` } }
    ])).flat();

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          ...imageMessages,
          {
            type: 'text',
            text: `Look at these ${frames.length} frames from a cooking video. Which frame number shows the most appetizing, fully plated/finished dish? 
Reply with ONLY a JSON object like: {"frame": 3}`
          }
        ]
      }],
      max_tokens: 50,
      temperature: 0
    });

    const text = response.choices[0].message.content;
    const match = text.match(/"frame"\s*:\s*(\d+)/);
    const frameIdx = match ? parseInt(match[1]) - 1 : frames.length - 1;
    const safeIdx = Math.max(0, Math.min(frameIdx, frames.length - 1));
    return `data:image/jpeg;base64,${fs.readFileSync(frames[safeIdx]).toString('base64')}`;
  } catch (err) {
    console.error('Frame picker failed:', err.message);
    return 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';
  }
}
app.post('/api/analyze-upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let profile = null;
  try { profile = req.body.profile ? JSON.parse(req.body.profile) : null; } catch {}
  const videoPath = req.file.path;
  let frames = [];
  try {
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');
    const [recipe, image] = await Promise.all([
      analyzeFramesMultiPass(frames, profile),
      pickBestFrame(frames)
    ]);
    recipe.image = image;
    cleanup(videoPath, frames);
    res.json({ recipe });
  } catch (err) {
    cleanup(videoPath, frames);
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── URL analyze (Instagram / TikTok) ──
app.post('/api/analyze-video', async (req, res) => {
  const { url } = req.body;
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return res.status(400).json({ error: 'Valid URL required' });
  }
  let profile = null;
  try { profile = req.body.profile ? JSON.parse(req.body.profile) : null; } catch {}
  let videoPath, frames = [];
  try {
    videoPath = await downloadVideo(url);
    frames = await extractFrames(videoPath);
    if (!frames.length) throw new Error('No frames extracted');
    const [recipe, image] = await Promise.all([
      analyzeFramesMultiPass(frames, profile),
      pickBestFrame(frames)
    ]);
    recipe.image = image;
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
