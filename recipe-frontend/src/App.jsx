import React, { useState, useEffect } from 'react';
import { Search, Settings, Plus, Home, Lightbulb, Calendar, ShoppingCart, MoreVertical, X, Upload, Link as LinkIcon, AlertCircle } from 'lucide-react';
import io from 'socket.io-client';

export default function RecipeApp() {
  const [activeTab, setActiveTab] = useState('home');
  const [recipes, setRecipes] = useState([
    { id: 1, title: 'Buffalo Chicken Crispy Tacos', time: 30, image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=300&fit=crop', cost: 8.50 },
    { id: 2, title: 'High Protein Crispy Chicken Mac n Che...', time: 30, image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=300&fit=crop', cost: 12.00 }
  ]);

  const [ingredients, setIngredients] = useState([
    { id: 1, name: 'Flour', pricePerUnit: 15, unitQuantity: 25, unit: 'kg' },
    { id: 2, name: 'Chicken Breast', pricePerUnit: 12, unitQuantity: 1, unit: 'kg' },
    { id: 3, name: 'Eggs', pricePerUnit: 3, unitQuantity: 12, unit: 'pieces' },
  ]);

  const [availableIngredients, setAvailableIngredients] = useState(['Chicken Breast', 'Eggs']);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [videoInput, setVideoInput] = useState('');
  const [suggestedRecipes, setSuggestedRecipes] = useState([]);
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [newIngredient, setNewIngredient] = useState({ name: '', pricePerUnit: '', unitQuantity: '', unit: 'kg' });
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Real-time monitoring
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [monitoringData, setMonitoringData] = useState({ connectedClients: 0, uptime: 0 });
  const [notifications, setNotifications] = useState([]);

  // Determine API URL (localhost for dev, cloud for production)
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  const isDevelopment = API_URL.includes('localhost');

  // Initialize WebSocket
  useEffect(() => {
    const newSocket = io(API_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('✓ Connected to server');
      setConnected(true);
      addNotification('Connected to server', 'success');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      setConnected(false);
      addNotification('Disconnected from server', 'error');
    });

    // Video analysis events
    newSocket.on('video_analysis_started', (data) => {
      setStatus('📹 Analyzing video...');
      addNotification('Video analysis started', 'info');
    });

    newSocket.on('video_downloaded', (data) => {
      setStatus('✓ Video downloaded, extracting frames...');
      addNotification('Video downloaded', 'info');
    });

    newSocket.on('frames_extracted', (data) => {
      setStatus(`✓ Extracted ${data.count} frames, analyzing with AI...`);
      addNotification(`Extracted ${data.count} frames`, 'info');
    });

    newSocket.on('gemini_analyzing', (data) => {
      setStatus('🤖 AI analyzing frames...');
      addNotification('AI analyzing', 'info');
    });

    newSocket.on('video_analysis_complete', (data) => {
      setStatus('✓ Video analysis complete!');
      setRecipes([...recipes, { ...data.recipe, id: recipes.length + 1 }]);
      setVideoInput('');
      setShowVideoInput(false);
      setLoading(false);
      addNotification('Video analysis complete!', 'success');
    });

    newSocket.on('video_analysis_error', (data) => {
      setStatus(`❌ Error: ${data.error}`);
      setLoading(false);
      addNotification(`Error: ${data.error}`, 'error');
    });

    // Recipe generation events
    newSocket.on('recipe_generation_started', (data) => {
      setStatus('🍳 Generating recipe ideas...');
      addNotification('Recipe generation started', 'info');
    });

    newSocket.on('recipe_generation_complete', (data) => {
      setStatus('✓ Recipes ready!');
      setSuggestedRecipes(data.recipes);
      setLoading(false);
      addNotification('Recipes generated!', 'success');
    });

    newSocket.on('recipe_generation_error', (data) => {
      setStatus(`❌ Error: ${data.error}`);
      setLoading(false);
      addNotification(`Error: ${data.error}`, 'error');
    });

    // Connection response
    newSocket.on('connection_response', (data) => {
      setMonitoringData(prev => ({ ...prev, connectedClients: data.clients }));
    });

    setSocket(newSocket);

    return () => newSocket.close();
  }, [API_URL]);

  // Add notification
  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };

  // Calculate price per unit
  const getPricePerUnit = (ingredient) => {
    return (ingredient.pricePerUnit / ingredient.unitQuantity).toFixed(2);
  };

  // Generate recipe ideas
  const generateRecipeIdeas = async () => {
    if (availableIngredients.length === 0) {
      alert('Add some ingredients first!');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/generate-recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: availableIngredients })
      });

      const data = await response.json();
      if (!data.recipes) {
        setSuggestedRecipes(data.recipes || []);
      }
    } catch (error) {
      console.error('Error generating recipes:', error);
      addNotification('Error connecting to server. Make sure backend is running.', 'error');
      setLoading(false);
    }
  };

  // Handle video input
  const handleVideoInput = async () => {
    if (!videoInput.trim()) {
      addNotification('Please enter a video URL', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoInput })
      });

      const data = await response.json();
      if (data.recipe) {
        // Recipe will be added via WebSocket event
      }
    } catch (error) {
      console.error('Error analyzing video:', error);
      addNotification('Error connecting to server. Make sure backend is running.', 'error');
      setLoading(false);
    }
  };

  // Add ingredient
  const handleAddIngredient = () => {
    if (!newIngredient.name || !newIngredient.pricePerUnit || !newIngredient.unitQuantity) {
      addNotification('Please fill in all ingredient fields', 'error');
      return;
    }

    setIngredients([...ingredients, {
      id: ingredients.length + 1,
      ...newIngredient,
      pricePerUnit: parseFloat(newIngredient.pricePerUnit),
      unitQuantity: parseFloat(newIngredient.unitQuantity)
    }]);

    setNewIngredient({ name: '', pricePerUnit: '', unitQuantity: '', unit: 'kg' });
    setShowIngredientForm(false);
    addNotification('Ingredient added!', 'success');
  };

  // Toggle ingredient
  const toggleIngredient = (ingredientName) => {
    setAvailableIngredients(prev =>
      prev.includes(ingredientName)
        ? prev.filter(i => i !== ingredientName)
        : [...prev, ingredientName]
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Connection Status */}
      {!connected && (
        <div className="fixed top-0 left-0 right-0 bg-red-100 border-b border-red-300 z-50">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="text-sm text-red-700">
              {isDevelopment ? 'Connecting to local server...' : 'Connecting to cloud server...'}
            </span>
          </div>
        </div>
      )}

      {/* Notifications */}
      <div className="fixed top-20 left-0 right-0 z-50 pointer-events-none">
        <div className="max-w-md mx-auto px-4 space-y-2">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`px-4 py-3 rounded-lg text-sm font-medium text-white animate-fade-in pointer-events-auto ${
                notif.type === 'success' ? 'bg-green-500' :
                notif.type === 'error' ? 'bg-red-500' :
                'bg-blue-500'
              }`}
            >
              {notif.message}
            </div>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">
              {activeTab === 'home' ? 'Home' : activeTab === 'ideas' ? 'Ideas' : activeTab === 'planner' ? 'Planner' : 'Groceries'}
            </h1>
            <div className="flex gap-3 items-center">
              {connected && (
                <div className="flex items-center gap-1 px-2 py-1 bg-green-100 rounded-full">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs text-green-700 font-medium">Live</span>
                </div>
              )}
              <button className="p-2 hover:bg-gray-100 rounded-lg transition">
                <Search className="w-5 h-5 text-gray-600" />
              </button>
              <button className="p-2 hover:bg-gray-100 rounded-lg transition">
                <Settings className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>

          {activeTab === 'home' && (
            <div className="flex gap-2">
              <button className="px-6 py-2 bg-white border-2 border-gray-300 rounded-full font-medium text-gray-700 hover:bg-gray-50 transition">
                All Recipes
              </button>
              <button className="px-6 py-2 bg-gray-300 rounded-full font-medium text-gray-700 hover:bg-gray-400 transition">
                Cookbooks
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      {status && (
        <div className="max-w-md mx-auto px-4 py-3 mt-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 font-medium">
          {status}
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 pb-24">
        {/* HOME TAB */}
        {activeTab === 'home' && (
          <div className="space-y-6 py-6">
            {/* Video Input Card */}
            {!showVideoInput ? (
              <button
                onClick={() => setShowVideoInput(true)}
                className="w-full bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-white rounded-2xl p-6 flex items-center justify-between transition transform hover:scale-105 shadow-lg"
              >
                <div className="text-left">
                  <h3 className="text-lg font-bold">Found a Recipe?</h3>
                  <p className="text-sm text-green-100">Save it here →</p>
                </div>
                <div className="flex gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">📱</div>
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">▶️</div>
                </div>
              </button>
            ) : (
              <div className="bg-white rounded-2xl p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-gray-900">Add from Video/Link</h3>
                  <button onClick={() => setShowVideoInput(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Instagram/TikTok/YouTube Link</label>
                    <input
                      type="text"
                      value={videoInput}
                      onChange={(e) => setVideoInput(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500"
                    />
                  </div>

                  <button
                    onClick={handleVideoInput}
                    disabled={loading || !connected}
                    className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition"
                  >
                    {loading ? 'Analyzing...' : 'Analyze Video'}
                  </button>

                  {!connected && (
                    <p className="text-xs text-red-600">Waiting for server connection...</p>
                  )}
                </div>
              </div>
            )}

            {/* Recipe Grid */}
            <div className="grid grid-cols-2 gap-4">
              {recipes.map(recipe => (
                <div
                  key={recipe.id}
                  onClick={() => setSelectedRecipe(recipe)}
                  className="bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition cursor-pointer"
                >
                  <div className="relative h-40 overflow-hidden bg-gray-200">
                    <img src={recipe.image} alt={recipe.title} className="w-full h-full object-cover hover:scale-110 transition" />
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-gray-900 text-sm line-clamp-2">{recipe.title}</h3>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">⏱️</span>
                        <span className="text-sm text-gray-600">{recipe.time} min</span>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IDEAS TAB */}
        {activeTab === 'ideas' && (
          <div className="space-y-6 py-6">
            {/* Available Ingredients Manager */}
            <div className="bg-white rounded-2xl p-6 shadow-md">
              <h3 className="font-bold text-gray-900 mb-4">Your Ingredients</h3>

              <div className="space-y-3 mb-4">
                {ingredients.map(ing => (
                  <div
                    key={ing.id}
                    onClick={() => toggleIngredient(ing.name)}
                    className={`p-3 rounded-lg cursor-pointer transition ${
                      availableIngredients.includes(ing.name)
                        ? 'bg-green-100 border-2 border-green-500'
                        : 'bg-gray-100 border-2 border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">{ing.name}</p>
                        <p className="text-xs text-gray-600">€{getPricePerUnit(ing)}/{ing.unit}</p>
                      </div>
                      {availableIngredients.includes(ing.name) && <span className="text-green-600">✓</span>}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowIngredientForm(!showIngredientForm)}
                className="w-full text-green-600 font-medium py-2 border-2 border-green-600 rounded-lg hover:bg-green-50 transition"
              >
                + Add Ingredient
              </button>

              {showIngredientForm && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <input
                    type="text"
                    placeholder="Ingredient name"
                    value={newIngredient.name}
                    onChange={(e) => setNewIngredient({ ...newIngredient, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      placeholder="Price"
                      value={newIngredient.pricePerUnit}
                      onChange={(e) => setNewIngredient({ ...newIngredient, pricePerUnit: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Quantity"
                      value={newIngredient.unitQuantity}
                      onChange={(e) => setNewIngredient({ ...newIngredient, unitQuantity: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <select
                    value={newIngredient.unit}
                    onChange={(e) => setNewIngredient({ ...newIngredient, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="l">liters</option>
                    <option value="ml">ml</option>
                    <option value="pieces">pieces</option>
                  </select>
                  <button
                    onClick={handleAddIngredient}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 rounded-lg transition"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Generate Recipes Button */}
            <button
              onClick={generateRecipeIdeas}
              disabled={loading || !connected}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 rounded-xl transition shadow-lg"
            >
              {loading ? 'Finding recipes...' : '✨ Generate Recipe Ideas'}
            </button>

            {!connected && (
              <p className="text-xs text-red-600 text-center">Waiting for server connection...</p>
            )}

            {/* Suggested Recipes */}
            {suggestedRecipes.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-bold text-gray-900">Suggested Recipes</h3>
                {suggestedRecipes.map((recipe, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedRecipe(recipe)}
                    className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-lg transition cursor-pointer"
                  >
                    <img src={recipe.image} alt={recipe.title} className="w-full h-40 object-cover" />
                    <div className="p-4">
                      <h4 className="font-bold text-gray-900">{recipe.title}</h4>
                      <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                        <span>⏱️ {recipe.cookTime} min</span>
                        <span className="font-medium text-green-600">€{recipe.cost}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PLANNER TAB */}
        {activeTab === 'planner' && (
          <div className="py-6">
            <div className="bg-white rounded-2xl p-8 text-center shadow-md">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Meal planner coming soon</p>
            </div>
          </div>
        )}

        {/* GROCERIES TAB */}
        {activeTab === 'groceries' && (
          <div className="py-6">
            <div className="bg-white rounded-2xl p-8 text-center shadow-md">
              <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Shopping list coming soon</p>
            </div>
          </div>
        )}
      </div>

      {/* Recipe Detail Modal */}
      {selectedRecipe && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="w-full bg-white rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedRecipe(null)}
              className="float-right text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>

            <img src={selectedRecipe.image} alt={selectedRecipe.title} className="w-full h-60 object-cover rounded-2xl mb-4" />

            <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedRecipe.title}</h2>

            <div className="flex gap-4 mb-6 text-gray-600">
              <div>⏱️ {selectedRecipe.time || selectedRecipe.cookTime} min</div>
              <div className="font-bold text-green-600">€{selectedRecipe.cost}</div>
            </div>

            <h3 className="font-bold text-gray-900 mb-3">Ingredients</h3>
            <div className="space-y-2 mb-6">
              {selectedRecipe.ingredients?.map((ing, idx) => (
                <div key={idx} className="flex justify-between text-gray-700">
                  <span>{ing}</span>
                  {selectedRecipe.ingredientPrices?.[idx] && <span className="text-green-600">€{selectedRecipe.ingredientPrices[idx]}</span>}
                </div>
              ))}
            </div>

            <button className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg transition">
              Save Recipe
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-around items-center">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg transition ${
              activeTab === 'home' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Home className="w-6 h-6" />
            <span className="text-xs">Home</span>
          </button>

          <button
            onClick={() => setActiveTab('ideas')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg transition ${
              activeTab === 'ideas' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Lightbulb className="w-6 h-6" />
            <span className="text-xs">Ideas</span>
          </button>

          <button
            onClick={() => setActiveTab('planner')}
            className="flex flex-col items-center gap-1 p-3 rounded-lg text-orange-500 hover:text-orange-600 transition"
          >
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-500 rounded-full flex items-center justify-center text-white shadow-lg">
              <Plus className="w-6 h-6" />
            </div>
            <span className="text-xs">Add</span>
          </button>

          <button
            onClick={() => setActiveTab('planner')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg transition ${
              activeTab === 'planner' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Calendar className="w-6 h-6" />
            <span className="text-xs">Planner</span>
          </button>

          <button
            onClick={() => setActiveTab('groceries')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg transition ${
              activeTab === 'groceries' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <ShoppingCart className="w-6 h-6" />
            <span className="text-xs">Groceries</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Add fade-in animation styles (add to your CSS)
const styles = `
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .animate-fade-in {
    animation: fade-in 0.3s ease-in-out;
  }
`;
