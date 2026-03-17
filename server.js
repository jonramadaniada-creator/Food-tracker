const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);

// ✅ Socket.io initialization with CORS
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());

// ✅ SOCKET.IO CONNECTION HANDLER
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });

  // Handle video analysis requests
  socket.on('analyze_video', async (data) => {
    try {
      socket.emit('video_analysis_started');
      // Your video analysis logic here
      console.log('📹 Analyzing video:', data.url);
    } catch (error) {
      socket.emit('video_analysis_error', { error: error.message });
    }
  });

  // Handle recipe generation requests
  socket.on('generate_recipes', async (data) => {
    try {
      socket.emit('recipe_generation_started');
      // Your recipe generation logic here
      console.log('🍳 Generating recipes for:', data.ingredients);
    } catch (error) {
      socket.emit('recipe_generation_error', { error: error.message });
    }
  });
});

// ✅ HEALTH CHECK ENDPOINT
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiConfigured: !!process.env.GEMINI_API_KEY
  });
});

// ✅ GENERATE RECIPES ENDPOINT
app.post('/api/generate-recipes', express.json(), async (req, res) => {
  try {
    const { ingredients } = req.body;
    
    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: 'Invalid ingredients' });
    }

    console.log('🍳 Generating recipes for:', ingredients);

    // TODO: Add your Gemini API logic here
    // For now, return mock data
    const mockRecipes = [
      {
        name: 'Simple Stir Fry',
        description: 'A quick and easy stir fry using your selected ingredients',
        cookTime: 15,
        cost: 8.50,
        ingredients: ingredients,
        image: 'https://images.unsplash.com/photo-1609501676725-7186f017a4b5?w=400&h=300&fit=crop'
      }
    ];

    res.json({ 
      recipes: mockRecipes,
      costPerServing: 8.50 
    });
  } catch (error) {
    console.error('Error generating recipes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ ANALYZE VIDEO ENDPOINT
app.post('/api/analyze-video', express.json(), async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Video URL required' });
    }

    console.log('📹 Analyzing video:', url);

    // TODO: Add your video analysis logic here
    // For now, return mock data
    const mockAnalysis = {
      ingredients: ['Chicken', 'Rice', 'Onions', 'Garlic'],
      costPerServing: 6.50,
      cookTime: 30
    };

    res.json(mockAnalysis);
  } catch (error) {
    console.error('Error analyzing video:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({
    message: '🍳 Food Tracker API Server',
    status: 'running',
    endpoints: [
      '/api/health',
      '/api/generate-recipes',
      '/api/analyze-video'
    ]
  });
});

// ✅ ERROR HANDLING
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ✅ START SERVER
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════╗');
  console.log('║  🍳 Food Tracker Server Running   ║');
  console.log('╚════════════════════════════════════╝');
  console.log('');
  console.log(`📍 Server: http://0.0.0.0:${PORT}`);
  console.log(`🔌 Socket.io: Connected`);
  console.log(`🤖 Gemini API: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  ✅ GET  /api/health');
  console.log('  ✅ POST /api/generate-recipes');
  console.log('  ✅ POST /api/analyze-video');
  console.log('');
});

module.exports = { app, server, io };