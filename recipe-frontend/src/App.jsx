import React, { useState, useEffect } from 'react';
import { Search, Settings, Plus, Calendar, ShoppingCart, X, AlertCircle, Bookmark } from 'lucide-react';
import io from 'socket.io-client';

const styles = `
  * { box-sizing: border-box; -webkit-font-smoothing: antialiased; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif; background: #f2f2f7; }

  /* ── LAYOUT ── */
  .shell { display: flex; min-height: 100vh; background: #f2f2f7; }

  /* Sidebar — desktop only */
  .sidebar {
    display: none;
    width: 220px; flex-shrink: 0;
    background: #fff;
    border-right: 1px solid #e8e8ed;
    flex-direction: column;
    padding: 28px 0 24px;
    position: sticky; top: 0; height: 100vh;
    overflow-y: auto;
  }
  .sidebar-logo {
    display: flex; align-items: center; gap: 10px;
    padding: 0 20px 28px;
    font-size: 20px; font-weight: 800; color: #111; letter-spacing: -0.4px;
  }
  .sidebar-logo-dot { width: 10px; height: 10px; background: #2a9d5c; border-radius: 50%; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; flex: 1; }
  .sidebar-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-radius: 12px;
    border: none; background: none; cursor: pointer;
    font-size: 14px; font-weight: 500; color: #666;
    font-family: inherit; text-align: left; width: 100%;
    transition: background 0.15s, color 0.15s;
  }
  .sidebar-item:hover { background: #f5f5f7; color: #111; }
  .sidebar-item.active { background: #f0faf4; color: #1a7a42; font-weight: 600; }
  .sidebar-item.active svg { color: #2a9d5c; }
  .sidebar-item svg { width: 20px; height: 20px; flex-shrink: 0; }
  .sidebar-add {
    margin: 16px 12px 0;
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px; border-radius: 12px;
    background: linear-gradient(135deg, #ff8c00, #ff5e00);
    border: none; cursor: pointer; color: #fff;
    font-size: 14px; font-weight: 600; font-family: inherit;
    box-shadow: 0 4px 12px rgba(255,100,0,0.3);
    transition: opacity 0.15s;
  }
  .sidebar-add:hover { opacity: 0.9; }
  .sidebar-add svg { width: 18px; height: 18px; }

  /* Main column */
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  /* Top bar — desktop */
  .topbar {
    display: none;
    align-items: center; justify-content: space-between;
    padding: 20px 32px 0;
    background: #f2f2f7;
    position: sticky; top: 0; z-index: 40;
  }
  .topbar-title { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; color: #000; }
  .topbar-right { display: flex; gap: 10px; align-items: center; }
  .topbar-segment { display: flex; background: #e0e0e6; border-radius: 30px; padding: 3px; }
  .topbar-seg-btn {
    padding: 7px 20px; font-size: 14px; font-weight: 500;
    border-radius: 28px; border: none; background: transparent;
    cursor: pointer; color: #555; font-family: inherit; transition: all 0.2s;
  }
  .topbar-seg-btn.active { background: #fff; color: #000; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

  /* Desktop content area */
  .desktop-content { display: none; padding: 20px 32px 40px; flex: 1; }
  .desktop-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  @media (min-width: 1100px) { .desktop-grid { grid-template-columns: repeat(4, 1fr); } }

  /* ── MOBILE HEADER ── */
  .mobile-header { padding: 12px 20px 0; background: #f2f2f7; position: sticky; top: 0; z-index: 40; }
  .mobile-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .mobile-title { font-size: 34px; font-weight: 700; letter-spacing: -0.5px; color: #000; line-height: 1; }
  .header-icons { display: flex; gap: 10px; align-items: center; }
  .header-icon-btn { width: 40px; height: 40px; background: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }

  /* Segment */
  .segment { display: flex; background: #e0e0e6; border-radius: 30px; padding: 3px; margin: 0 0 16px; }
  .seg-btn { flex: 1; padding: 8px 0; text-align: center; font-size: 15px; font-weight: 500; border-radius: 28px; border: none; background: transparent; cursor: pointer; color: #555; transition: all 0.2s; font-family: inherit; }
  .seg-btn.active { background: #fff; color: #000; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .mobile-segment { margin: 0 20px 16px; }

  /* Banner */
  .banner { background: linear-gradient(135deg, #28a55a 0%, #47c96a 55%, #8ddc6a 100%); border-radius: 18px; padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; margin-bottom: 20px; }
  .banner-text p { font-size: 19px; font-weight: 800; color: #fff; line-height: 1.3; }
  .social-stack { display: flex; align-items: center; position: relative; width: 88px; height: 52px; flex-shrink: 0; }
  .si { position: absolute; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 2.5px solid #fff; }
  .si svg { width: 22px; height: 22px; }
  .si-ig { background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); left: 0; top: 0; }
  .si-tt { background: #000; left: 22px; top: -6px; }
  .si-fb { background: #1877F2; left: 42px; top: 10px; }

  /* Recipe cards */
  .recipe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .recipe-card { background: #fff; border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
  .recipe-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
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

  /* Video card */
  .video-card { background: #fff; border-radius: 18px; padding: 20px; margin-bottom: 20px; }
  .video-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .video-card-header h3 { font-size: 16px; font-weight: 600; color: #000; }
  .video-card-header button { background: none; border: none; cursor: pointer; color: #aaa; }
  .video-input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 12px; font-size: 14px; font-family: inherit; outline: none; color: #111; }
  .video-input:focus { border-color: #2a9d5c; }
  .video-label { font-size: 12px; color: #888; margin-bottom: 6px; display: block; font-weight: 500; }
  .btn-green { width: 100%; background: #2a9d5c; color: #fff; border: none; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; margin-top: 12px; }
  .btn-green:disabled { background: #aaa; }

  /* Ideas / misc */
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
  .suggested-card { background: #fff; border-radius: 16px; overflow: hidden; margin-bottom: 12px; cursor: pointer; transition: box-shadow 0.15s; }
  .suggested-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.09); }
  .suggested-card img { width: 100%; height: 150px; object-fit: cover; display: block; }
  .suggested-body { padding: 12px 14px; }
  .suggested-title { font-size: 14px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .suggested-meta { display: flex; justify-content: space-between; font-size: 13px; color: #666; }
  .suggested-cost { font-weight: 600; color: #2a9d5c; }
  .placeholder-card { background: #fff; border-radius: 18px; padding: 64px 24px; text-align: center; }
  .placeholder-card svg { color: #ccc; width: 48px; height: 48px; margin: 0 auto 12px; display: block; }
  .placeholder-card p { color: #aaa; font-size: 15px; }

  /* Mobile bottom nav */
  .bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: rgba(249,249,249,0.95); backdrop-filter: blur(12px);
    border-top: 0.5px solid #e0e0e0;
    padding: 8px 0 24px;
    display: flex; justify-content: space-around; align-items: center;
    z-index: 50;
  }
  .nav-item { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; cursor: pointer; min-width: 60px; }
  .nav-icon-wrap { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 14px; }
  .nav-item.active .nav-icon-wrap { background: #e8e8ed; }
  .nav-item svg { width: 24px; height: 24px; color: #888; }
  .nav-item.active svg { color: #111; }
  .nav-label { font-size: 10px; font-weight: 500; color: #888; }
  .nav-item.active .nav-label { color: #111; font-weight: 600; }
  .nav-add { width: 52px; height: 52px; background: linear-gradient(145deg, #ff8c00, #ff5e00); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(255,100,0,0.4); }

  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: flex-end; justify-content: center; }
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

  /* Status / notifications */
  .notif-container { position: fixed; top: 16px; right: 16px; width: 320px; z-index: 300; pointer-events: none; display: flex; flex-direction: column; gap: 8px; }
  .notif { padding: 12px 16px; border-radius: 12px; font-size: 13px; font-weight: 600; color: #fff; pointer-events: auto; }
  .notif.success { background: #2a9d5c; }
  .notif.error { background: #e53e3e; }
  .notif.info { background: #3b82f6; }
  .conn-banner { background: #fff1f0; border-bottom: 1px solid #fecaca; padding: 10px 20px; display: flex; align-items: center; gap: 8px; }
  .conn-banner span { font-size: 13px; color: #c53030; font-weight: 500; }
  .status-bar { padding: 10px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; font-size: 13px; color: #1d4ed8; font-weight: 500; margin-bottom: 16px; }
  .live-badge { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: #dcfce7; border-radius: 20px; }
  .live-dot { width: 7px; height: 7px; background: #16a34a; border-radius: 50%; }
  .live-label { font-size: 12px; color: #15803d; font-weight: 600; }

  @keyframes fade-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fade-in 0.25s ease; }

  /* ── RESPONSIVE BREAKPOINT ── */
  @media (min-width: 768px) {
    body { background: #f0f0f5; }

    .sidebar { display: flex; }
    .topbar { display: flex; }
    .desktop-content { display: block; }

    .mobile-header { display: none; }
    .bottom-nav { display: none; }

    /* Modal becomes centered dialog on desktop */
    .modal-overlay { align-items: center; }
    .modal-sheet { width: 540px; border-radius: 24px; max-height: 85vh; }

    .recipe-grid { grid-template-columns: repeat(3, 1fr); }
    @media (min-width: 1100px) { .recipe-grid { grid-template-columns: repeat(4, 1fr); } }
  }
`;

export default function RecipeApp() {
  const [activeTab, setActiveTab] = useState('home');
  const [recipeFilter, setRecipeFilter] = useState('all');
  const [recipes, setRecipes] = useState([
    { id: 1, title: 'Buffalo Chicken Crispy Tacos', time: 30, image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=300&fit=crop', cost: 8.50 },
    { id: 2, title: 'High Protein Crispy Chicken Mac n Cheese', time: 30, image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=300&fit=crop', cost: 12.00 },
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

  // Use environment variable, fallback to localhost for development
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  const isDevelopment = !import.meta.env.VITE_API_URL;
  const socketRef = React.useRef(null);

  useEffect(() => {
    console.log('Connecting to API_URL:', API_URL);
    const s = io(API_URL, { 
      reconnection: true, 
      reconnectionDelay: 1000, 
      reconnectionDelayMax: 5000, 
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling']
    });
    socketRef.current = s;

    s.on('connect', () => { 
      console.log('✅ Connected to server');
      setConnected(true); 
      addNotification('Connected to server', 'success'); 
    });

    s.on('disconnect', () => { 
      console.log('❌ Disconnected from server');
      setConnected(false); 
      addNotification('Disconnected from server', 'error'); 
    });

    s.on('video_analysis_started', () => setStatus('📹 Analyzing video...'));
    s.on('video_downloaded', () => setStatus('✓ Video downloaded, extracting frames...'));
    s.on('frames_extracted', d => setStatus(`✓ Extracted ${d.count} frames, analyzing with AI...`));
    s.on('gemini_analyzing', () => setStatus('🤖 AI analyzing frames...'));
    s.on('video_analysis_complete', d => {
      setStatus('✓ Video analysis complete!');
      setRecipes(prev => [...prev, { ...d.recipe, id: prev.length + 1 }]);
      setVideoInput(''); setShowVideoInput(false); setLoading(false);
      addNotification('Video analysis complete!', 'success');
    });
    s.on('video_analysis_error', d => { 
      setStatus(`❌ Error: ${d.error}`); 
      setLoading(false); 
      addNotification(`Error: ${d.error}`, 'error'); 
    });
    s.on('recipe_generation_started', () => setStatus('🍳 Generating recipe ideas...'));
    s.on('recipe_generation_complete', d => { 
      setStatus('✓ Recipes ready!'); 
      setSuggestedRecipes(d.recipes); 
      setLoading(false); 
      addNotification('Recipes generated!', 'success'); 
    });
    s.on('recipe_generation_error', d => { 
      setStatus(`❌ Error: ${d.error}`); 
      setLoading(false); 
      addNotification(`Error: ${d.error}`, 'error'); 
    });

    return () => s.close();
  }, [API_URL]);

  const addNotification = (msg, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000);
  };

  const getPricePerUnit = ing => (ing.pricePerUnit / ing.unitQuantity).toFixed(2);

  const generateRecipeIdeas = async () => {
    if (!availableIngredients.length) { alert('Add some ingredients first!'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/generate-recipes`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ ingredients: availableIngredients }) 
      });
      const data = await res.json();
      if (data.recipes) setSuggestedRecipes(data.recipes);
    } catch (e) { 
      console.error('Error:', e);
      addNotification('Error connecting to server. Make sure backend is running.', 'error'); 
      setLoading(false); 
    }
  };

  const handleVideoInput = async () => {
    if (!videoInput.trim()) { addNotification('Please enter a video URL', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/analyze-video`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ url: videoInput, socketId: socketRef.current?.id }) 
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    } catch (e) { 
      console.error('Error:', e);
      addNotification('Error connecting to server. Make sure backend is running.', 'error'); 
      setLoading(false); 
    }
  };

  const handleAddIngredient = () => {
    if (!newIngredient.name || !newIngredient.pricePerUnit || !newIngredient.unitQuantity) { addNotification('Please fill in all fields', 'error'); return; }
    setIngredients(prev => [...prev, { id: prev.length + 1, ...newIngredient, pricePerUnit: parseFloat(newIngredient.pricePerUnit), unitQuantity: parseFloat(newIngredient.unitQuantity) }]);
    setNewIngredient({ name: '', pricePerUnit: '', unitQuantity: '', unit: 'kg' });
    setShowIngredientForm(false);
    addNotification('Ingredient added!', 'success');
  };

  const toggleIngredient = name =>
    setAvailableIngredients(prev => prev.includes(name) ? prev.filter(i => i !== name) : [...prev, name]);

  const tabTitle = { home: 'Home', ideas: 'Ideas', planner: 'Planner', groceries: 'Groceries' }[activeTab];

  const NAV = [
    { key: 'home', label: 'Home', icon: <Bookmark size={20} /> },
    {
      key: 'ideas', label: 'Ideas',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    },
    {
      key: 'planner', label: 'Planner',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20">
        <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>
      </svg>
    },
    {
      key: 'groceries', label: 'Groceries',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
      </svg>
    },
  ];

  const BannerOrForm = () => !showVideoInput ? (
    <div className="banner" onClick={() => setShowVideoInput(true)}>
      <div className="banner-text"><p>Found a Recipe?<br />Save It Here →</p></div>
      <div className="social-stack">
        <div className="si si-ig">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/>
            <circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/>
          </svg>
        </div>
        <div className="si si-tt">
          <svg viewBox="0 0 24 24" fill="#fff">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 106.33 6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1-.06z"/>
          </svg>
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
      <button className="btn-green" onClick={handleVideoInput} disabled={loading || !connected}>
        {loading ? 'Analyzing...' : 'Analyze Video'}
      </button>
      {!connected && <p style={{ fontSize:12, color:'#e53e3e', marginTop:8, textAlign:'center' }}>Waiting for server connection…</p>}
    </div>
  );

  const RecipeGrid = () => (
    <div className="recipe-grid">
      {recipes.map(r => (
        <div key={r.id} className="recipe-card" onClick={() => setSelectedRecipe(r)}>
          <div className="card-img-wrap">
            <img src={r.image} alt={r.title} />
            <div className="play-overlay">
              <div className="play-btn">
                <svg viewBox="0 0 24 24" fill="#333"><polygon points="5,3 19,12 5,21"/></svg>
              </div>
            </div>
          </div>
          <div className="card-body">
            <div className="card-title">{r.title}</div>
            <div className="card-meta">
              <div className="card-time">
                <div className="clock-icon">
                  <svg viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="#fff" strokeWidth="1.3"/>
                    <path d="M6 3v3l2 1" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </div>
                {r.time} min
              </div>
              <button className="more-btn" onClick={e => e.stopPropagation()}>···</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const IdeasContent = () => (
    <>
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
          <div style={{ marginTop:16, borderTop:'1px solid #f0f0f0', paddingTop:16, display:'flex', flexDirection:'column', gap:8 }}>
            <input className="input-sm" placeholder="Ingredient name" value={newIngredient.name} onChange={e => setNewIngredient({ ...newIngredient, name: e.target.value })} />
            <div className="grid-2">
              <input className="input-sm" type="number" placeholder="Price" value={newIngredient.pricePerUnit} onChange={e => setNewIngredient({ ...newIngredient, pricePerUnit: e.target.value })} />
              <input className="input-sm" type="number" placeholder="Quantity" value={newIngredient.unitQuantity} onChange={e => setNewIngredient({ ...newIngredient, unitQuantity: e.target.value })} />
            </div>
            <select className="input-sm" value={newIngredient.unit} onChange={e => setNewIngredient({ ...newIngredient, unit: e.target.value })}>
              <option value="kg">kg</option><option value="g">g</option>
              <option value="l">liters</option><option value="ml">ml</option><option value="pieces">pieces</option>
            </select>
            <button className="btn-green" onClick={handleAddIngredient}>Add</button>
          </div>
        )}
      </div>
      <button className="btn-generate" onClick={generateRecipeIdeas} disabled={loading || !connected}>
        {loading ? 'Finding recipes...' : '✨ Generate Recipe Ideas'}
      </button>
      {!connected && <p style={{ fontSize:12, color:'#e53e3e', textAlign:'center', marginTop:8 }}>Waiting for server connection…</p>}
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
    </>
  );

  return (
    <>
      <style>{styles}</style>

      {/* Notifications */}
      <div className="notif-container">
        {notifications.map(n => <div key={n.id} className={`notif ${n.type} fade-in`}>{n.msg}</div>)}
      </div>

      <div className="shell">

        {/* ─── DESKTOP SIDEBAR ─── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="sidebar-logo-dot" />
            RecipeBox
          </div>
          <nav className="sidebar-nav">
            {NAV.map(item => (
              <button key={item.key} className={`sidebar-item ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <button className="sidebar-add" onClick={() => { setActiveTab('home'); setShowVideoInput(true); }}>
            <Plus size={18} />
            Save a Recipe
          </button>
        </aside>

        {/* ─── MAIN COLUMN ─── */}
        <div className="main">
          {!connected && (
            <div className="conn-banner">
              <AlertCircle size={16} color="#e53e3e" />
              <span>{isDevelopment ? 'Connecting to local server...' : 'Connecting to cloud server at ' + API_URL}</span>
            </div>
          )}

          {/* ─── DESKTOP TOP BAR ─── */}
          <div className="topbar">
            <h1 className="topbar-title">{tabTitle}</h1>
            <div className="topbar-right">
              {connected && (
                <div className="live-badge">
                  <div className="live-dot" />
                  <span className="live-label">Live</span>
                </div>
              )}
              {activeTab === 'home' && (
                <div className="topbar-segment">
                  <button className={`topbar-seg-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>All Recipes</button>
                  <button className={`topbar-seg-btn ${recipeFilter === 'cookbooks' ? 'active' : ''}`} onClick={() => setRecipeFilter('cookbooks')}>Cookbooks</button>
                </div>
              )}
              <button className="header-icon-btn"><Search size={17} /></button>
              <button className="header-icon-btn"><Settings size={17} /></button>
            </div>
          </div>

          {/* ─── DESKTOP CONTENT ─── */}
          <div className="desktop-content">
            {status && <div className="status-bar">{status}</div>}

            {activeTab === 'home' && (
              <>
                <BannerOrForm />
                <RecipeGrid />
              </>
            )}
            {activeTab === 'ideas' && <IdeasContent />}
            {activeTab === 'planner' && <div className="placeholder-card"><Calendar /><p>Meal planner coming soon</p></div>}
            {activeTab === 'groceries' && <div className="placeholder-card"><ShoppingCart /><p>Shopping list coming soon</p></div>}
          </div>

          {/* ─── MOBILE HEADER ─── */}
          <div className="mobile-header">
            <div className="mobile-header-row">
              <h1 className="mobile-title">{tabTitle}</h1>
              <div className="header-icons">
                {connected && (
                  <div className="live-badge">
                    <div className="live-dot" />
                    <span className="live-label">Live</span>
                  </div>
                )}
                <button className="header-icon-btn"><Search size={17} /></button>
                <button className="header-icon-btn"><Settings size={17} /></button>
              </div>
            </div>
            {activeTab === 'home' && (
              <div className="segment mobile-segment">
                <button className={`seg-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>All Recipes</button>
                <button className={`seg-btn ${recipeFilter === 'cookbooks' ? 'active' : ''}`} onClick={() => setRecipeFilter('cookbooks')}>Cookbooks</button>
              </div>
            )}
          </div>

          {/* ─── MOBILE CONTENT ─── */}
          <div style={{ display:'block', padding:'0 16px 100px' }} className="mobile-only-content">
            <style>{`.mobile-only-content { display: block; } @media (min-width: 768px) { .mobile-only-content { display: none !important; } }`}</style>
            {status && <div className="status-bar" style={{ marginTop:12 }}>{status}</div>}

            {activeTab === 'home' && (
              <div style={{ paddingTop:4 }}>
                <BannerOrForm />
                <RecipeGrid />
              </div>
            )}
            {activeTab === 'ideas' && <div style={{ paddingTop:16 }}><IdeasContent /></div>}
            {activeTab === 'planner' && <div style={{ paddingTop:16 }}><div className="placeholder-card"><Calendar /><p>Meal planner coming soon</p></div></div>}
            {activeTab === 'groceries' && <div style={{ paddingTop:16 }}><div className="placeholder-card"><ShoppingCart /><p>Shopping list coming soon</p></div></div>}
          </div>
        </div>
      </div>

      {/* ─── RECIPE DETAIL MODAL ─── */}
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

      {/* ─── MOBILE BOTTOM NAV ─── */}
      <div className="bottom-nav">
        {NAV.map((item, idx) => (
          <React.Fragment key={item.key}>
            <button className={`nav-item ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
              <div className="nav-icon-wrap">
                {React.cloneElement(item.icon, { size: 24 })}
              </div>
              <span className="nav-label">{item.label}</span>
            </button>
            {idx === 1 && (
              <button className="nav-add" onClick={() => { setActiveTab('home'); setShowVideoInput(true); }}>
                <Plus size={26} color="#fff" strokeWidth={2.5} />
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}