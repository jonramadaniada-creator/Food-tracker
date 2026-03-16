import React, { useState, useEffect } from 'react';
import { Search, Settings, Plus, Calendar, ShoppingCart, X, AlertCircle, Bookmark } from 'lucide-react';
import io from 'socket.io-client';

/* ─── iOS-style design tokens ─── */
const styles = `
  * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif; background: #f2f2f7; }

  .app { max-width: 430px; margin: 0 auto; min-height: 100vh; background: #f2f2f7; position: relative; }

  .header { padding: 12px 20px 0; background: #f2f2f7; position: sticky; top: 0; z-index: 40; }
  .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .header-title { font-size: 34px; font-weight: 700; letter-spacing: -0.5px; color: #000; line-height: 1; }
  .header-icons { display: flex; gap: 10px; align-items: center; }
  .header-icon-btn { width: 40px; height: 40px; background: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  .header-icon-btn svg { width: 17px; height: 17px; color: #111; }

  .segment { display: flex; background: #e0e0e6; border-radius: 30px; padding: 3px; margin: 0 20px 16px; }
  .seg-btn { flex: 1; padding: 8px 0; text-align: center; font-size: 15px; font-weight: 500; border-radius: 28px; border: none; background: transparent; cursor: pointer; color: #555; transition: all 0.2s; }
  .seg-btn.active { background: #fff; color: #000; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

  .banner { margin: 0 16px 20px; background: linear-gradient(135deg, #28a55a 0%, #47c96a 55%, #8ddc6a 100%); border-radius: 18px; padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
  .banner-text p { font-size: 19px; font-weight: 800; color: #fff; line-height: 1.3; }
  .social-stack { display: flex; align-items: center; position: relative; width: 88px; height: 52px; flex-shrink: 0; }
  .si { position: absolute; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 2.5px solid #fff; }
  .si svg { width: 22px; height: 22px; }
  .si-ig { background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); left: 0; top: 0; }
  .si-tt { background: #000; left: 22px; top: -6px; }
  .si-fb { background: #1877F2; left: 42px; top: 10px; }

  .recipe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 16px; }
  .recipe-card { background: #fff; border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.15s; }
  .recipe-card:active { transform: scale(0.97); }
  .card-img-wrap { position: relative; aspect-ratio: 1/1; overflow: hidden; background: #ddd; }
  .card-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .play-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .play-btn { width: 34px; height: 34px; background: rgba(255,255,255,0.88); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .play-btn svg { width: 13px; height: 13px; margin-left: 2px; }
  .card-body { padding: 10px 10px 12px; }
  .card-title { font-size: 13px; font-weight: 600; color: #111; line-height: 1.35; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card-meta { display: flex; justify-content: space-between; align-items: center; }
  .card-time { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #555; }
  .clock-icon { width: 16px; height: 16px; background: #ffa500; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .clock-icon svg { width: 9px; height: 9px; }
  .more-btn { background: none; border: none; cursor: pointer; color: #aaa; font-size: 17px; letter-spacing: 1px; line-height: 1; padding: 0 2px; }

  .video-card { background: #fff; border-radius: 18px; padding: 20px; margin: 0 16px 20px; }
  .video-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .video-card-header h3 { font-size: 16px; font-weight: 600; color: #000; }
  .video-card-header button { background: none; border: none; cursor: pointer; color: #aaa; }
  .video-input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 12px; font-size: 14px; font-family: inherit; outline: none; color: #111; }
  .video-input:focus { border-color: #2a9d5c; }
  .video-label { font-size: 12px; color: #888; margin-bottom: 6px; display: block; font-weight: 500; }
  .btn-green { width: 100%; background: #2a9d5c; color: #fff; border: none; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; margin-top: 12px; }
  .btn-green:disabled { background: #aaa; }

  .tab-content { padding: 16px 16px 100px; }
  .section-card { background: #fff; border-radius: 18px; padding: 18px; margin-bottom: 16px; }
  .section-title { font-size: 17px; font-weight: 700; color: #000; margin-bottom: 14px; }
  .ingredient-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 12px; cursor: pointer; margin-bottom: 8px; border: 2px solid transparent; }
  .ingredient-row.on { background: #edfaf3; border-color: #2a9d5c; }
  .ingredient-row.off { background: #f5f5f7; border-color: #e5e5ea; }
  .ing-name { font-size: 14px; font-weight: 600; color: #111; }
  .ing-price { font-size: 12px; color: #888; margin-top: 2px; }
  .check { color: #2a9d5c; font-weight: 700; font-size: 16px; }
  .btn-outline-green { width: 100%; padding: 11px; border: 1.5px solid #2a9d5c; border-radius: 12px; background: none; color: #2a9d5c; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; margin-top: 4px; }
  .input-sm { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; font-family: inherit; outline: none; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .btn-generate { width: 100%; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: none; border-radius: 14px; padding: 15px; font-size: 16px; font-weight: 700; font-family: inherit; cursor: pointer; margin-top: 4px; }
  .btn-generate:disabled { background: #aaa; }

  .placeholder-card { background: #fff; border-radius: 18px; padding: 48px 24px; text-align: center; }
  .placeholder-card svg { color: #ccc; width: 48px; height: 48px; margin: 0 auto 12px; display: block; }
  .placeholder-card p { color: #aaa; font-size: 15px; }

  .bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 430px; background: rgba(249,249,249,0.95); backdrop-filter: blur(12px); border-top: 0.5px solid #e0e0e0; padding: 8px 0 24px; display: flex; justify-content: space-around; align-items: center; z-index: 50; }
  .nav-item { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; cursor: pointer; min-width: 60px; }
  .nav-icon-wrap { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 14px; }
  .nav-item.active .nav-icon-wrap { background: #e8e8ed; }
  .nav-item svg { width: 24px; height: 24px; color: #888; }
  .nav-item.active svg { color: #111; }
  .nav-label { font-size: 10px; font-weight: 500; color: #888; }
  .nav-item.active .nav-label { color: #111; font-weight: 600; }
  .nav-add { width: 52px; height: 52px; background: linear-gradient(145deg, #ff8c00, #ff5e00); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(255,100,0,0.4); }
  .nav-add svg { width: 26px; height: 26px; color: #fff; }

  .notif-container { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: 100%; max-width: 390px; padding: 0 16px; z-index: 100; pointer-events: none; display: flex; flex-direction: column; gap: 8px; }
  .notif { padding: 12px 16px; border-radius: 12px; font-size: 13px; font-weight: 600; color: #fff; pointer-events: auto; }
  .notif.success { background: #2a9d5c; }
  .notif.error { background: #e53e3e; }
  .notif.info { background: #3b82f6; }

  .conn-banner { background: #fff1f0; border-bottom: 1px solid #fecaca; padding: 10px 20px; display: flex; align-items: center; gap: 8px; }
  .conn-banner span { font-size: 13px; color: #c53030; font-weight: 500; }
  .status-bar { margin: 0 16px 12px; padding: 10px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; font-size: 13px; color: #1d4ed8; font-weight: 500; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: flex-end; }
  .modal-sheet { width: 100%; background: #fff; border-radius: 24px 24px 0 0; padding: 24px 20px 40px; max-height: 90vh; overflow-y: auto; }
  .modal-close { float: right; background: none; border: none; cursor: pointer; color: #aaa; }
  .modal-img { width: 100%; height: 220px; object-fit: cover; border-radius: 16px; margin-bottom: 16px; display: block; clear: both; }
  .modal-title { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .modal-meta { display: flex; gap: 16px; font-size: 14px; color: #666; margin-bottom: 20px; }
  .modal-cost { font-weight: 700; color: #2a9d5c; }
  .modal-section-title { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 10px; }
  .modal-ing-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; color: #444; border-bottom: 0.5px solid #f0f0f0; }
  .modal-ing-price { color: #2a9d5c; font-weight: 600; }
  .btn-save { width: 100%; background: #2a9d5c; color: #fff; border: none; border-radius: 14px; padding: 15px; font-size: 16px; font-weight: 700; font-family: inherit; cursor: pointer; margin-top: 20px; }

  .suggested-card { background: #fff; border-radius: 16px; overflow: hidden; margin-bottom: 12px; cursor: pointer; }
  .suggested-card img { width: 100%; height: 150px; object-fit: cover; display: block; }
  .suggested-body { padding: 12px 14px; }
  .suggested-title { font-size: 14px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .suggested-meta { display: flex; justify-content: space-between; font-size: 13px; color: #666; }
  .suggested-cost { font-weight: 600; color: #2a9d5c; }

  @keyframes fade-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fade-in 0.25s ease; }
`;

export default function RecipeApp() {
  const [activeTab, setActiveTab] = useState('home');
  const [recipeFilter, setRecipeFilter] = useState('all');
  const [recipes, setRecipes] = useState([
    { id: 1, title: 'Buffalo Chicken Crispy Tacos', time: 30, image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=300&fit=crop', cost: 8.50 },
    { id: 2, title: 'High Protein Crispy Chicken Mac n Cheese', time: 30, image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=300&fit=crop', cost: 12.00 }
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
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [notifications, setNotifications] = useState([]);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  const isDevelopment = API_URL.includes('localhost');

  useEffect(() => {
    const newSocket = io(API_URL, { reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, reconnectionAttempts: 5 });
    newSocket.on('connect', () => { setConnected(true); addNotification('Connected to server', 'success'); });
    newSocket.on('disconnect', () => { setConnected(false); addNotification('Disconnected from server', 'error'); });
    newSocket.on('video_analysis_started', () => setStatus('📹 Analyzing video...'));
    newSocket.on('video_downloaded', () => setStatus('✓ Video downloaded, extracting frames...'));
    newSocket.on('frames_extracted', (d) => setStatus(`✓ Extracted ${d.count} frames, analyzing with AI...`));
    newSocket.on('gemini_analyzing', () => setStatus('🤖 AI analyzing frames...'));
    newSocket.on('video_analysis_complete', (d) => {
      setStatus('✓ Video analysis complete!');
      setRecipes(prev => [...prev, { ...d.recipe, id: prev.length + 1 }]);
      setVideoInput(''); setShowVideoInput(false); setLoading(false);
      addNotification('Video analysis complete!', 'success');
    });
    newSocket.on('video_analysis_error', (d) => { setStatus(`❌ Error: ${d.error}`); setLoading(false); addNotification(`Error: ${d.error}`, 'error'); });
    newSocket.on('recipe_generation_started', () => setStatus('🍳 Generating recipe ideas...'));
    newSocket.on('recipe_generation_complete', (d) => { setStatus('✓ Recipes ready!'); setSuggestedRecipes(d.recipes); setLoading(false); addNotification('Recipes generated!', 'success'); });
    newSocket.on('recipe_generation_error', (d) => { setStatus(`❌ Error: ${d.error}`); setLoading(false); addNotification(`Error: ${d.error}`, 'error'); });
    return () => newSocket.close();
  }, [API_URL]);

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000);
  };

  const getPricePerUnit = (ing) => (ing.pricePerUnit / ing.unitQuantity).toFixed(2);

  const generateRecipeIdeas = async () => {
    if (!availableIngredients.length) { alert('Add some ingredients first!'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/generate-recipes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingredients: availableIngredients }) });
      const data = await res.json();
      if (!data.recipes) setSuggestedRecipes(data.recipes || []);
    } catch { addNotification('Error connecting to server. Make sure backend is running.', 'error'); setLoading(false); }
  };

  const handleVideoInput = async () => {
    if (!videoInput.trim()) { addNotification('Please enter a video URL', 'error'); return; }
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/analyze-video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: videoInput }) });
    } catch { addNotification('Error connecting to server. Make sure backend is running.', 'error'); setLoading(false); }
  };

  const handleAddIngredient = () => {
    if (!newIngredient.name || !newIngredient.pricePerUnit || !newIngredient.unitQuantity) { addNotification('Please fill in all ingredient fields', 'error'); return; }
    setIngredients(prev => [...prev, { id: prev.length + 1, ...newIngredient, pricePerUnit: parseFloat(newIngredient.pricePerUnit), unitQuantity: parseFloat(newIngredient.unitQuantity) }]);
    setNewIngredient({ name: '', pricePerUnit: '', unitQuantity: '', unit: 'kg' });
    setShowIngredientForm(false);
    addNotification('Ingredient added!', 'success');
  };

  const toggleIngredient = (name) => setAvailableIngredients(prev => prev.includes(name) ? prev.filter(i => i !== name) : [...prev, name]);

  const tabTitle = { home: 'Home', ideas: 'Ideas', planner: 'Planner', groceries: 'Groceries' }[activeTab];

  const NavIcon = ({ tabKey, label, children }) => (
    <button className={`nav-item ${activeTab === tabKey ? 'active' : ''}`} onClick={() => setActiveTab(tabKey)}>
      <div className="nav-icon-wrap">{children}</div>
      <span className="nav-label">{label}</span>
    </button>
  );

  return (
    <>
      <style>{styles}</style>
      <div className="notif-container">
        {notifications.map(n => <div key={n.id} className={`notif ${n.type} fade-in`}>{n.message}</div>)}
      </div>
      <div className="app">
        {!connected && (
          <div className="conn-banner">
            <AlertCircle size={16} color="#e53e3e" />
            <span>{isDevelopment ? 'Connecting to local server...' : 'Connecting to cloud server...'}</span>
          </div>
        )}

        {/* Header */}
        <div className="header">
          <div className="header-row">
            <h1 className="header-title">{tabTitle}</h1>
            <div className="header-icons">
              {connected && (
                <div style={{ display:'flex',alignItems:'center',gap:4,padding:'4px 10px',background:'#dcfce7',borderRadius:20 }}>
                  <div style={{ width:7,height:7,background:'#16a34a',borderRadius:'50%' }} />
                  <span style={{ fontSize:12,color:'#15803d',fontWeight:600 }}>Live</span>
                </div>
              )}
              <button className="header-icon-btn"><Search size={17} /></button>
              <button className="header-icon-btn"><Settings size={17} /></button>
            </div>
          </div>
          {activeTab === 'home' && (
            <div className="segment">
              <button className={`seg-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>All Recipes</button>
              <button className={`seg-btn ${recipeFilter === 'cookbooks' ? 'active' : ''}`} onClick={() => setRecipeFilter('cookbooks')}>Cookbooks</button>
            </div>
          )}
        </div>

        {status && <div className="status-bar">{status}</div>}

        {/* HOME */}
        {activeTab === 'home' && (
          <div style={{ paddingBottom: 100 }}>
            {!showVideoInput ? (
              <div className="banner" onClick={() => setShowVideoInput(true)}>
                <div className="banner-text"><p>Found a Recipe?<br />Save It Here →</p></div>
                <div className="social-stack">
                  <div className="si si-ig">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/></svg>
                  </div>
                  <div className="si si-tt">
                    <svg viewBox="0 0 24 24" fill="#fff"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 106.33 6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1-.06z"/></svg>
                  </div>
                  <div className="si si-fb">
                    <svg viewBox="0 0 24 24" fill="#fff"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
                  </div>
                </div>
              </div>
            ) : (
              <div className="video-card fade-in">
                <div className="video-card-header">
                  <h3>Add from Video / Link</h3>
                  <button onClick={() => setShowVideoInput(false)}><X size={20} /></button>
                </div>
                <span className="video-label">Instagram / TikTok / YouTube Link</span>
                <input className="video-input" type="text" value={videoInput} onChange={e => setVideoInput(e.target.value)} placeholder="https://..." />
                <button className="btn-green" onClick={handleVideoInput} disabled={loading || !connected}>{loading ? 'Analyzing...' : 'Analyze Video'}</button>
                {!connected && <p style={{ fontSize:12,color:'#e53e3e',marginTop:8,textAlign:'center' }}>Waiting for server connection…</p>}
              </div>
            )}

            <div className="recipe-grid">
              {recipes.map(recipe => (
                <div key={recipe.id} className="recipe-card" onClick={() => setSelectedRecipe(recipe)}>
                  <div className="card-img-wrap">
                    <img src={recipe.image} alt={recipe.title} />
                    <div className="play-overlay">
                      <div className="play-btn">
                        <svg viewBox="0 0 24 24" fill="#333"><polygon points="5,3 19,12 5,21"/></svg>
                      </div>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="card-title">{recipe.title}</div>
                    <div className="card-meta">
                      <div className="card-time">
                        <div className="clock-icon">
                          <svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#fff" strokeWidth="1.3"/><path d="M6 3v3l2 1" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        </div>
                        {recipe.time} min
                      </div>
                      <button className="more-btn" onClick={e => e.stopPropagation()}>···</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IDEAS */}
        {activeTab === 'ideas' && (
          <div className="tab-content">
            <div className="section-card">
              <div className="section-title">Your Ingredients</div>
              {ingredients.map(ing => (
                <div key={ing.id} className={`ingredient-row ${availableIngredients.includes(ing.name) ? 'on' : 'off'}`} onClick={() => toggleIngredient(ing.name)}>
                  <div><div className="ing-name">{ing.name}</div><div className="ing-price">€{getPricePerUnit(ing)}/{ing.unit}</div></div>
                  {availableIngredients.includes(ing.name) && <span className="check">✓</span>}
                </div>
              ))}
              <button className="btn-outline-green" onClick={() => setShowIngredientForm(v => !v)}>+ Add Ingredient</button>
              {showIngredientForm && (
                <div style={{ marginTop:16,borderTop:'1px solid #f0f0f0',paddingTop:16,display:'flex',flexDirection:'column',gap:8 }}>
                  <input className="input-sm" placeholder="Ingredient name" value={newIngredient.name} onChange={e => setNewIngredient({ ...newIngredient, name: e.target.value })} />
                  <div className="grid-2">
                    <input className="input-sm" type="number" placeholder="Price" value={newIngredient.pricePerUnit} onChange={e => setNewIngredient({ ...newIngredient, pricePerUnit: e.target.value })} />
                    <input className="input-sm" type="number" placeholder="Quantity" value={newIngredient.unitQuantity} onChange={e => setNewIngredient({ ...newIngredient, unitQuantity: e.target.value })} />
                  </div>
                  <select className="input-sm" value={newIngredient.unit} onChange={e => setNewIngredient({ ...newIngredient, unit: e.target.value })}>
                    <option value="kg">kg</option><option value="g">g</option><option value="l">liters</option><option value="ml">ml</option><option value="pieces">pieces</option>
                  </select>
                  <button className="btn-green" onClick={handleAddIngredient}>Add</button>
                </div>
              )}
            </div>
            <button className="btn-generate" onClick={generateRecipeIdeas} disabled={loading || !connected}>{loading ? 'Finding recipes...' : '✨ Generate Recipe Ideas'}</button>
            {!connected && <p style={{ fontSize:12,color:'#e53e3e',textAlign:'center',marginTop:8 }}>Waiting for server connection…</p>}
            {suggestedRecipes.length > 0 && (
              <div style={{ marginTop:20 }}>
                <div className="section-title" style={{ marginBottom:12 }}>Suggested Recipes</div>
                {suggestedRecipes.map((r, i) => (
                  <div key={i} className="suggested-card" onClick={() => setSelectedRecipe(r)}>
                    <img src={r.image} alt={r.title} />
                    <div className="suggested-body">
                      <div className="suggested-title">{r.title}</div>
                      <div className="suggested-meta"><span>⏱ {r.cookTime} min</span><span className="suggested-cost">€{r.cost}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PLANNER */}
        {activeTab === 'planner' && (
          <div className="tab-content">
            <div className="placeholder-card"><Calendar /><p>Meal planner coming soon</p></div>
          </div>
        )}

        {/* GROCERIES */}
        {activeTab === 'groceries' && (
          <div className="tab-content">
            <div className="placeholder-card"><ShoppingCart /><p>Shopping list coming soon</p></div>
          </div>
        )}

        {/* Recipe Detail Modal */}
        {selectedRecipe && (
          <div className="modal-overlay" onClick={() => setSelectedRecipe(null)}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setSelectedRecipe(null)}><X size={24} /></button>
              <img src={selectedRecipe.image} alt={selectedRecipe.title} className="modal-img" />
              <div className="modal-title">{selectedRecipe.title}</div>
              <div className="modal-meta">
                <span>⏱ {selectedRecipe.time || selectedRecipe.cookTime} min</span>
                <span className="modal-cost">€{selectedRecipe.cost}</span>
              </div>
              {selectedRecipe.ingredients?.length > 0 && (
                <>
                  <div className="modal-section-title">Ingredients</div>
                  {selectedRecipe.ingredients.map((ing, i) => (
                    <div key={i} className="modal-ing-row">
                      <span>{ing}</span>
                      {selectedRecipe.ingredientPrices?.[i] && <span className="modal-ing-price">€{selectedRecipe.ingredientPrices[i]}</span>}
                    </div>
                  ))}
                </>
              )}
              <button className="btn-save">Save Recipe</button>
            </div>
          </div>
        )}

        {/* Bottom nav */}
        <div className="bottom-nav">
          <NavIcon tabKey="home" label="Home">
            <Bookmark size={24} />
          </NavIcon>
          <NavIcon tabKey="ideas" label="Ideas">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="24" height="24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </NavIcon>
          <button className="nav-add" onClick={() => { setActiveTab('home'); setShowVideoInput(true); }}>
            <Plus size={26} color="#fff" strokeWidth={2.5} />
          </button>
          <NavIcon tabKey="planner" label="Planner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="24" height="24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>
          </NavIcon>
          <NavIcon tabKey="groceries" label="Groceries">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="24" height="24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          </NavIcon>
        </div>
      </div>
    </>
  );
}