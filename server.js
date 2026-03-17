// server.js - Node.js Backend for Recipe App
// Install dependencies: npm install express socket.io cors dotenv axios fluent-ffmpeg child_process form-data
// Run: node server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBZYNMO6OC1lB1eAEFA5q8rqwNV17R0Lcc';

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper: Download video from URL
async function downloadVideo(url) {
  const videoPath = path.join(__dirname, `temp_${Date.now()}.mp4`);
  
  return new Promise((resolve, reject) => {
    const command = `yt-dlp -f "best[ext=mp4]" -o "${videoPath}" "${url}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Download error:', error);
        reject(new Error('Failed to download video'));
      } else {
        resolve(videoPath);
      }
    });
  });
}

// Helper: Extract frames from video (every 5 seconds)
async function extractFrames(videoPath) {
  const frameDir = path.join(__dirname, `frames_${Date.now()}`);
  
  if (!fs.existsSync(frameDir)) {
    fs.mkdirSync(frameDir);
  }

  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i "${videoPath}" -vf "fps=0.2" "${frameDir}/frame_%03d.png"`;
    
    exec(command, (error) => {
      if (error) {
        console.error('Frame extraction error:', error);
        reject(new Error('Failed to extract frames'));
      } else {
        const frames = fs.readdirSync(frameDir)
          .filter(f => f.endsWith('.png'))
          .map(f => path.join(frameDir, f));
        resolve(frames);
      }
    });
  });
}

// Helper: Convert image to base64
function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

// Helper: Call Gemini Vision API
async function analyzeWithGemini(base64Images, prompt) {
  const imageContents = base64Images.map(base64 => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: base64
    }
  }));

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [
        {
          parts: [
            ...imageContents,
            { type: 'text', text: prompt }
          ]
        }
      ]
    }
  );

  const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

// Helper: Parse recipe from Gemini response
function parseRecipeResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('JSON parse error:', e);
  }

  return {
    title: 'Recipe from Video',
    ingredients: [],
    cookTime: 30,
    servings: 4
  };
}

// Helper: Generate recipe with Gemini based on ingredients
async function generateRecipeWithGemini(ingredients) {
  const prompt = `Based on these available ingredients: ${ingredients.join(', ')}

Generate 2 delicious recipe ideas. For each recipe provide:
1. Recipe name
2. Brief description
3. All ingredients needed (with estimated quantities)
4. Cooking time in minutes
5. Difficulty level
6. Estimated cost (assume affordable pricing)

Format your response as JSON array with this structure:
[
  {
    "title": "Recipe Name",
    "description": "Brief description",
    "ingredients": ["ingredient1", "ingredient2"],
    "cookTime": 30,
    "difficulty": "easy",
    "cost": 8.50
  }
]`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [
        {
          parts: [{ type: 'text', text: prompt }]
        }
      ]
    }
  );

  const responseText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Parse error:', e);
  }

  return [
    {
      title: `${ingredients[0]} Delight`,
      description: 'A delicious dish using your available ingredients',
      ingredients,
      cookTime: 25,
      difficulty: 'easy',
      cost: 8.50,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop'
    },
    {
      title: `Quick ${ingredients[0]} Stir Fry`,
      description: 'Fast and tasty recipe',
      ingredients,
      cookTime: 20,
      difficulty: 'easy',
      cost: 7.20,
      image: 'https://images.unsplash.com/photo-1609501676725-7186f017a4b8?w=400&h=300&fit=crop'
    }
  ];
}

// Cleanup temporary files
function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

// ============ API ENDPOINTS ============

// Analyze video from URL
app.post('/api/analyze-video', async (req, res) => {
  try {
    const { url, socketId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    // Emit progress events to the specific socket if provided
    const emit = (event, data) => {
      if (socketId) io.to(socketId).emit(event, data);
    };

    emit('video_analysis_started');
    console.log('Downloading video...');
    const videoPath = await downloadVideo(url);
    emit('video_downloaded');

    console.log('Extracting frames...');
    const frames = await extractFrames(videoPath);

    if (frames.length === 0) {
      cleanup(videoPath);
      return res.status(400).json({ error: 'No frames extracted from video' });
    }

    console.log(`Extracted ${frames.length} frames`);
    emit('frames_extracted', { count: frames.length });

    const base64Frames = frames.map(f => imageToBase64(f));

    const prompt = `Analyze these video frames from a cooking video and extract:
1. Recipe name/title
2. All ingredients visible with estimated quantities
3. Cooking time
4. Servings/portions
5. Difficulty level

Provide a JSON response:
{
  "title": "Recipe Name",
  "ingredients": ["ingredient1: quantity", "ingredient2: quantity"],
  "cookTime": 30,
  "servings": 4,
  "difficulty": "medium"
}`;

    emit('gemini_analyzing');
    console.log('Analyzing with Gemini...');
    const analysisText = await analyzeWithGemini(base64Frames, prompt);
    const recipe = parseRecipeResponse(analysisText);

    recipe.image = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=400&h=300&fit=crop';

    cleanup(videoPath);
    frames.forEach(f => cleanup(f));

    emit('video_analysis_complete', { recipe });
    res.json({ recipe });
  } catch (error) {
    console.error('Video analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate recipes based on available ingredients
app.post('/api/generate-recipes', async (req, res) => {
  try {
    const { ingredients } = req.body;

    if (!ingredients || ingredients.length === 0) {
      return res.status(400).json({ error: 'Ingredients required' });
    }

    console.log(`Generating recipes for: ${ingredients.join(', ')}`);
    const recipes = await generateRecipeWithGemini(ingredients);

    const recipeImages = [
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
      'https://images.unsplash.com/photo-1609501676725-7186f017a4b8?w=400&h=300&fit=crop',
      'https://images.unsplash.com/photo-1504674900769-7f88ad4a5c20?w=400&h=300&fit=crop'
    ];

    const recipesWithImages = recipes.map((recipe, idx) => ({
      ...recipe,
      image: recipeImages[idx % recipeImages.length]
    }));

    res.json({ recipes: recipesWithImages });
  } catch (error) {
    console.error('Recipe generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', geminiConfigured: !!GEMINI_API_KEY });
});

// Start server — use server.listen, NOT app.listen
server.listen(PORT, () => {
  console.log(`\n🍳 Recipe App Server running on http://localhost:${PORT}`);
  console.log(`📚 Gemini API Key: ${GEMINI_API_KEY ? 'Configured ✓' : 'NOT SET ⚠️'}`);
  console.log(`🔌 Socket.io: Enabled ✓`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/analyze-video - Analyze video from URL`);
  console.log(`  POST /api/generate-recipes - Generate recipes from ingredients`);
  console.log(`  GET /api/health - Health check\n`);
});