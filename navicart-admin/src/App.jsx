import React, { useState, useEffect } from 'react';
import { Store, Plus, Trash2, ClipboardPaste, LayoutGrid, Tags, Tag, Eye, ChevronLeft, AlertTriangle, Loader2, Cloud, CloudOff } from 'lucide-react';

const INK = '#2B241A';
const BG = '#1E2B22';
const CREAM = '#FBF8F2';
const PAPER = '#F1EBDA';
const ORANGE = '#E2891F';
const GREEN = '#7FB069';
const RED = '#B4552F';
const MUTED = '#9C8F78';

const STOCK_META = {
  in: { color: GREEN, label: 'In stock' },
  low: { color: ORANGE, label: 'Low stock' },
  out: { color: RED, label: 'Out of stock' },
};

const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const productKey = (s) => s.toLowerCase().trim().replace(/\s+/g, '_');
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const DISPLAY_FONT = "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

// ---- Supabase (REST, no SDK — avoids any dependency install) ----
const SUPABASE_URL = 'https://dsyrxdwtrjioehyefkbd.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzeXJ4ZHd0cmppb2VoeWVma2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyODgxNzAsImV4cCI6MjEwMTg2NDE3MH0.KU_wkNBbDKH6jkW6pTrK_wA0Iu5ENKwluDWvduFM6eI';

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${currentAccessToken || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Holds the logged-in owner's token once they sign in; sb() uses it
// automatically so writes are attributed to the right account.
let currentAccessToken = null;

async function authRequest(grantPath, email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${grantPath}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

// ---- Free, offline aisle classification ----
// Matches each pasted line against a built-in dictionary of common
// grocery items, no external API or paid key required. Anything
// not recognized comes back with category: null so the owner can
// assign it manually in the review screen.
const CATEGORY_KEYWORDS = {
  Produce: ['lettuce', 'tomato', 'banana', 'apple', 'onion', 'avocado', 'potato', 'carrot', 'pepper', 'grape',
    'orange', 'lemon', 'lime', 'garlic', 'broccoli', 'spinach', 'cucumber', 'celery', 'mushroom', 'berries',
    'strawberr', 'blueberr', 'melon', 'peach', 'pear', 'mango', 'corn'],
  Bakery: ['bread', 'bagel', 'tortilla', 'muffin', 'croissant', 'roll', 'bun', 'cake', 'donut', 'pastry', 'pita'],
  Dairy: ['milk', 'cheese', 'yogurt', 'egg', 'butter', 'cream cheese', 'sour cream', 'cottage cheese', 'half and half'],
  'Meat & Seafood': ['chicken', 'beef', 'fish', 'bacon', 'pork', 'turkey', 'sausage', 'ham', 'steak', 'shrimp',
    'salmon', 'ground beef', 'ground turkey', 'chix'],
  'Pasta & Grains': ['pasta', 'rice', 'cereal', 'bean', 'flour', 'spaghetti', 'noodle', 'oat', 'quinoa', 'sauce',
    'marinara', 'peanut butter', 'jelly', 'jam', 'honey'],
  Snacks: ['chip', 'soda', 'cookie', 'cracker', 'candy', 'salsa', 'popcorn', 'pretzel', 'granola bar', 'nuts',
    'coke', 'sprite', 'pepsi', 'cola'],
  Frozen: ['frozen', 'ice cream', 'popsicle'],
  Beverages: ['juice', 'coffee', 'tea', 'water', 'sparkling', 'soda water', 'gatorade', 'energy drink'],
  Household: ['paper towel', 'toilet paper', 'dish soap', 'detergent', 'laundry', 'foil', 'ziploc', 'trash bag',
    'sponge', 'cleaner', 'bleach'],
  'Health & Beauty': ['shampoo', 'toothpaste', 'deodorant', 'soap', 'vitamin', 'lotion', 'razor', 'floss'],
  Pets: ['dog food', 'cat food', 'cat litter', 'pet '],
};

function classifyOffline(existingCategories, rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const priceMatch = line.match(/\$?(\d+\.\d{1,2})/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    let name = line
      .replace(/^[\s\-\*\u2022\d.)]+/, '')
      .replace(/,?\s*\$?\d+\.\d{1,2}\s*$/, '')
      .replace(/\s+x\s*\d+$/i, '')
      .trim();
    name = name.replace(/\b\w/g, (c) => c.toUpperCase());

    const lower = name.toLowerCase();
    let category = null;

    for (const existing of existingCategories) {
      const kws = CATEGORY_KEYWORDS[existing];
      if (kws && kws.some((kw) => lower.includes(kw))) { category = existing; break; }
    }
    if (!category) {
      for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
        if (kws.some((kw) => lower.includes(kw))) { category = cat; break; }
      }
    }

    return { name, category, price };
  });
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await authRequest(
        mode === 'login' ? 'token?grant_type=password' : 'signup',
        email.trim(),
        password
      );
      if (data.access_token && data.user) {
        onAuthed({ accessToken: data.access_token, user: data.user });
      } else {
        setNotice('Account created — check your email to confirm, then log in.');
        setMode('login');
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: BG }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-2">
          <Store size={18} color={ORANGE} />
          <span style={{ color: ORANGE, letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>NAVICART · STORE SETUP</span>
        </div>
        <h1 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 30, fontWeight: 700 }} className="mb-6">
          {mode === 'login' ? 'Log in' : 'Create your account'}
        </h1>

        <div className="rounded-xl p-5" style={{ backgroundColor: CREAM }}>
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>EMAIL</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mt-1 mb-3"
            style={{ borderColor: '#E5DDCB', color: INK }}
          />
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>PASSWORD</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mt-1 mb-4"
            style={{ borderColor: '#E5DDCB', color: INK }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-bold"
            style={{ backgroundColor: ORANGE, color: BG }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>

          {error && <p className="text-xs mt-3" style={{ color: RED }}>{error}</p>}
          {notice && <p className="text-xs mt-3" style={{ color: '#4C6B45' }}>{notice}</p>}

          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}
            className="text-xs mt-4 block mx-auto"
            style={{ color: '#8C7A4A' }}
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StoreAdmin() {
  const [session, setSession] = useState(null); // {accessToken, user}
  const [phase, setPhase] = useState('auth'); // auth | loading | landing | editor
  const [storeList, setStoreList] = useState([]);
  const [newStoreName, setNewStoreName] = useState('');
  const [store, setStore] = useState(null); // {id, slug, name}
  const [aisles, setAisles] = useState([]); // [{id, number, name}]
  const [products, setProducts] = useState([]); // [{id, key, label, aisle_number, price, stock}]
  const [promos, setPromos] = useState([]); // [{id, aisle_number, text}]
  const [tab, setTab] = useState('aisles');
  const [sync, setSync] = useState('idle'); // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('');
  const [opening, setOpening] = useState(false);

  function handleAuthed(newSession) {
    currentAccessToken = newSession.accessToken;
    setSession(newSession);
    loadStores(newSession);
  }

  function logOut() {
    currentAccessToken = null;
    setSession(null);
    setStore(null);
    setPhase('auth');
  }

  async function loadStores(activeSession) {
    setPhase('loading');
    try {
      const uid = (activeSession || session).user.id;
      const rows = await sb(`stores?select=id,slug,name&owner_id=eq.${uid}&order=name`);
      setStoreList(rows || []);
    } catch (e) {
      setErrorMsg('Could not reach the database. Check your connection.');
    }
    setPhase('landing');
  }

  async function openStore(s) {
    setOpening(true);
    setErrorMsg('');
    try {
      const [aisleRows, productRows, promoRows] = await Promise.all([
        sb(`aisles?store_id=eq.${s.id}&select=*&order=number`),
        sb(`products?store_id=eq.${s.id}&select=*&order=aisle_number`),
        sb(`promos?store_id=eq.${s.id}&select=*&order=created_at`),
      ]);
      setAisles(aisleRows || []);
      setProducts(productRows || []);
      setPromos(promoRows || []);
      setStore(s);
      setTab('aisles');
      setPhase('editor');
    } catch (e) {
      setErrorMsg('Could not load that store. Try again.');
    }
    setOpening(false);
  }

  async function createStore() {
    const name = newStoreName.trim();
    if (!name) return;
    setOpening(true);
    setErrorMsg('');
    try {
      const rows = await sb('stores', {
        method: 'POST',
        body: JSON.stringify({ slug: slugify(name), name, owner_id: session.user.id }),
      });
      const s = rows[0];
      setAisles([]);
      setProducts([]);
      setPromos([]);
      setStore(s);
      setTab('aisles');
      setPhase('editor');
      setNewStoreName('');
    } catch (e) {
      setErrorMsg(`Could not create store: ${e.message || 'unknown error'}`);
    }
    setOpening(false);
  }

  // ---- promo ops ----
  async function addPromo(aisleNumber, text) {
    if (!text.trim() || !aisleNumber) return;
    setSync('saving');
    try {
      const rows = await sb('promos', {
        method: 'POST',
        body: JSON.stringify({ store_id: store.id, aisle_number: aisleNumber, text: text.trim() }),
      });
      setPromos((prev) => [...prev, rows[0]]);
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function deletePromo(id) {
    setPromos((prev) => prev.filter((p) => p.id !== id));
    setSync('saving');
    try {
      await sb(`promos?id=eq.${id}`, { method: 'DELETE' });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  function backToStores() {
    setStore(null);
    loadStores();
  }

  // ---- aisle ops (each hits the DB immediately) ----
  async function addAisle(name) {
    const nextNum = aisles.length ? Math.max(...aisles.map((a) => a.number)) + 1 : 1;
    setSync('saving');
    try {
      const rows = await sb('aisles', {
        method: 'POST',
        body: JSON.stringify({ store_id: store.id, number: nextNum, name: name || 'New aisle' }),
      });
      setAisles((prev) => [...prev, rows[0]].sort((a, b) => a.number - b.number));
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function renameAisle(id, name) {
    setAisles((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
    setSync('saving');
    try {
      await sb(`aisles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function deleteAisle(id, number) {
    setSync('saving');
    try {
      await sb(`aisles?id=eq.${id}`, { method: 'DELETE' });
      await sb(`products?store_id=eq.${store.id}&aisle_number=eq.${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ aisle_number: null }),
      });
      setAisles((prev) => prev.filter((a) => a.id !== id));
      setProducts((prev) => prev.map((p) => (p.aisle_number === number ? { ...p, aisle_number: null } : p)));
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  // ---- product ops ----
  async function addProduct(label, aisleNumber, price) {
    if (!label.trim()) return;
    setSync('saving');
    try {
      const rows = await sb('products', {
        method: 'POST',
        body: JSON.stringify({
          store_id: store.id,
          key: productKey(label),
          label: titleCase(label),
          aisle_number: aisleNumber || null,
          price: parseFloat(price) || 0,
          stock: 'in',
        }),
      });
      setProducts((prev) => [...prev, rows[0]]);
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function updateProduct(id, patch) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setSync('saving');
    try {
      await sb(`products?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function deleteProduct(id) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSync('saving');
    try {
      await sb(`products?id=eq.${id}`, { method: 'DELETE' });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function bulkImport(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const fallback = aisles.length ? aisles[0].number : null;
    const rowsToUpsert = lines
      .map((line) => {
        const parts = line.split(/\t|,/).map((p) => p.trim());
        const [name, aisleStr, priceStr, stockStr] = parts;
        if (!name) return null;
        const aisleNum = parseInt(aisleStr, 10);
        const stock = ['in', 'low', 'out'].includes((stockStr || '').toLowerCase()) ? stockStr.toLowerCase() : 'in';
        return {
          store_id: store.id,
          key: productKey(name),
          label: titleCase(name),
          aisle_number: isNaN(aisleNum) ? fallback : aisleNum,
          price: parseFloat(priceStr) || 0,
          stock,
        };
      })
      .filter(Boolean);

    if (rowsToUpsert.length === 0) return 0;

    setSync('saving');
    try {
      const saved = await sb('products?on_conflict=store_id,key', {
        method: 'POST',
        body: JSON.stringify(rowsToUpsert),
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
      setProducts((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        (saved || []).forEach((p) => byId.set(p.id, p));
        return Array.from(byId.values());
      });
      setSync('idle');
      return (saved || []).length;
    } catch (e) {
      setSync('error');
      return 0;
    }
  }

  // Commits AI-reviewed items: creates any brand-new categories as
  // real aisles first, then saves every product against its
  // resolved aisle number.
  async function commitSmartImport(reviewItems) {
    setSync('saving');
    try {
      const existingNames = aisles.map((a) => a.name.toLowerCase());
      const neededNewCats = [...new Set(reviewItems.map((i) => i.category))].filter(
        (c) => !existingNames.includes(c.toLowerCase())
      );

      let nextNum = aisles.length ? Math.max(...aisles.map((a) => a.number)) + 1 : 1;
      const newAisleRows = [];
      for (const catName of neededNewCats) {
        const rows = await sb('aisles', {
          method: 'POST',
          body: JSON.stringify({ store_id: store.id, number: nextNum, name: catName }),
        });
        newAisleRows.push(rows[0]);
        nextNum++;
      }

      const nameToNumber = {};
      [...aisles, ...newAisleRows].forEach((a) => { nameToNumber[a.name.toLowerCase()] = a.number; });

      const rowsToUpsert = reviewItems.map((item) => ({
        store_id: store.id,
        key: productKey(item.name),
        label: item.name,
        aisle_number: nameToNumber[item.category.toLowerCase()] ?? null,
        price: item.price || 0,
        stock: 'in',
      }));

      const saved = await sb('products?on_conflict=store_id,key', {
        method: 'POST',
        body: JSON.stringify(rowsToUpsert),
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });

      setAisles((prev) => [...prev, ...newAisleRows].sort((a, b) => a.number - b.number));
      setProducts((prev) => {
        const byKey = new Map(prev.map((p) => [p.key, p]));
        (saved || []).forEach((p) => byKey.set(p.key, p));
        return Array.from(byKey.values());
      });
      setSync('idle');
      return { newAisleCount: newAisleRows.length, productCount: (saved || []).length };
    } catch (e) {
      setSync('error');
      throw e;
    }
  }

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: BG, fontFamily: 'system-ui, sans-serif' }}>
      {phase === 'auth' && <AuthScreen onAuthed={handleAuthed} />}

      {phase === 'loading' && (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="animate-spin" size={28} color={CREAM} />
        </div>
      )}

      {phase === 'landing' && (
        <Landing
          storeList={storeList}
          newStoreName={newStoreName}
          setNewStoreName={setNewStoreName}
          onOpen={openStore}
          onCreate={createStore}
          opening={opening}
          errorMsg={errorMsg}
          onLogOut={logOut}
        />
      )}

      {phase === 'editor' && store && (
        <EditorShell
          store={store}
          aisles={aisles}
          products={products}
          promos={promos}
          tab={tab}
          setTab={setTab}
          onBack={backToStores}
          sync={sync}
          addAisle={addAisle}
          renameAisle={renameAisle}
          deleteAisle={deleteAisle}
          addProduct={addProduct}
          updateProduct={updateProduct}
          deleteProduct={deleteProduct}
          bulkImport={bulkImport}
          commitSmartImport={commitSmartImport}
          addPromo={addPromo}
          deletePromo={deletePromo}
        />
      )}
    </div>
  );
}

function SyncBadge({ sync }) {
  if (sync === 'saving') return <span className="flex items-center gap-1 text-xs" style={{ color: MUTED }}><Loader2 size={11} className="animate-spin" /> Saving…</span>;
  if (sync === 'error') return <span className="flex items-center gap-1 text-xs" style={{ color: '#E8A67D' }}><CloudOff size={11} /> Save failed</span>;
  return <span className="flex items-center gap-1 text-xs" style={{ color: GREEN }}><Cloud size={11} /> Synced live</span>;
}

function Landing({ storeList, newStoreName, setNewStoreName, onOpen, onCreate, opening, errorMsg, onLogOut }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Store size={18} color={ORANGE} />
            <span style={{ color: ORANGE, letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>NAVICART · STORE SETUP</span>
          </div>
          <button onClick={onLogOut} className="text-xs" style={{ color: MUTED }}>Log out</button>
        </div>
        <h1 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 34, fontWeight: 700, lineHeight: 1.15 }} className="mb-1">
          Get your aisles online
        </h1>
        <p style={{ color: MUTED }} className="text-sm mb-8">
          Set up your store's aisle layout and product catalog so shoppers can find what they need.
        </p>

        {errorMsg && (
          <div className="rounded-lg p-3 mb-4 flex gap-2 items-start" style={{ backgroundColor: 'rgba(200,80,50,0.15)' }}>
            <AlertTriangle size={14} color="#E8A67D" className="mt-0.5 flex-shrink-0" />
            <span className="text-xs" style={{ color: '#E8A67D' }}>{errorMsg}</span>
          </div>
        )}

        <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: CREAM }}>
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>NEW STORE</label>
          <div className="flex gap-2 mt-2">
            <input
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              placeholder="Your store's name"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none border"
              style={{ borderColor: '#E5DDCB', color: INK }}
              onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            />
            <button onClick={onCreate} disabled={opening} className="rounded-lg px-4 flex items-center justify-center" style={{ backgroundColor: ORANGE }}>
              {opening ? <Loader2 size={16} className="animate-spin" color={BG} /> : <Plus size={16} color={BG} />}
            </button>
          </div>
        </div>

        {storeList.length > 0 && (
          <div>
            <label style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>YOUR STORES</label>
            <div className="mt-2 space-y-2">
              {storeList.map((s) => (
                <button
                  key={s.id}
                  onClick={() => !opening && onOpen(s)}
                  className="w-full text-left rounded-lg px-4 py-3 flex items-center justify-between transition"
                  style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <span style={{ color: CREAM, fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                  <ChevronLeft size={14} color={MUTED} style={{ transform: 'rotate(180deg)' }} />
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs mt-8" style={{ color: 'rgba(245,241,232,0.4)' }}>
          Connected to a live database — changes here are real and shared with the shopper app.
        </p>
      </div>
    </div>
  );
}

function EditorShell({
  store, aisles, products, promos, tab, setTab, onBack, sync,
  addAisle, renameAisle, deleteAisle, addProduct, updateProduct, deleteProduct, bulkImport, commitSmartImport,
  addPromo, deletePromo,
}) {
  const unmapped = products.filter((p) => !aisles.some((a) => a.number === p.aisle_number));

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="md:w-64 flex-shrink-0 p-6 flex flex-col" style={{ backgroundColor: BG }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-8 text-sm" style={{ color: MUTED }}>
          <ChevronLeft size={14} /> Switch store
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Store size={16} color={ORANGE} />
          <span style={{ color: ORANGE, fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>EDITING</span>
        </div>
        <h2 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 22, fontWeight: 700 }} className="mb-8">
          {store.name}
        </h2>

        <nav className="space-y-1 flex-1">
          {[
            { id: 'aisles', label: 'Aisles', icon: LayoutGrid },
            { id: 'products', label: 'Products', icon: Tags },
            { id: 'deals', label: 'Deals', icon: Tag },
            { id: 'preview', label: 'Shopper preview', icon: Eye },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition"
              style={{ backgroundColor: tab === t.id ? ORANGE : 'transparent', color: tab === t.id ? BG : CREAM }}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="pt-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <SyncBadge sync={sync} />
        </div>
      </div>

      <div className="flex-1 p-6 md:p-10" style={{ backgroundColor: CREAM }}>
        {tab === 'aisles' && <AislesTab aisles={aisles} renameAisle={renameAisle} deleteAisle={deleteAisle} addAisle={addAisle} />}
        {tab === 'products' && (
          <ProductsTab aisles={aisles} products={products} updateProduct={updateProduct} deleteProduct={deleteProduct} addProduct={addProduct} bulkImport={bulkImport} commitSmartImport={commitSmartImport} />
        )}
        {tab === 'deals' && (
          <DealsTab aisles={aisles} promos={promos} addPromo={addPromo} deletePromo={deletePromo} />
        )}
        {tab === 'preview' && <PreviewTab aisles={aisles} products={products} unmapped={unmapped} />}
      </div>
    </div>
  );
}

function DealsTab({ aisles, promos, addPromo, deletePromo }) {
  const [aisleNumber, setAisleNumber] = useState(aisles[0]?.number || '');
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || !aisleNumber) return;
    addPromo(Number(aisleNumber), text);
    setText('');
  };

  const aisleName = (num) => aisles.find((a) => a.number === num)?.name || 'Unknown aisle';

  return (
    <div className="max-w-xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">
        Deals
      </h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>
        Attach a deal to an aisle — shoppers see it automatically when that aisle is on their route.
      </p>

      {aisles.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#B4A87F' }}>Add an aisle first, then come back here.</p>
      ) : (
        <>
          <div className="space-y-2 mb-6">
            {promos.length === 0 && (
              <p className="text-sm italic" style={{ color: '#B4A87F' }}>No deals yet — add your first one below.</p>
            )}
            {promos.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ backgroundColor: PAPER }}>
                <Tag size={15} color={ORANGE} className="flex-shrink-0" />
                <div className="flex-1">
                  <span className="text-xs font-bold block" style={{ color: '#8C7A4A' }}>{aisleName(p.aisle_number)}</span>
                  <span className="text-sm" style={{ color: INK }}>{p.text}</span>
                </div>
                <button onClick={() => deletePromo(p.id)}>
                  <Trash2 size={15} color={RED} />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
            <div className="flex gap-2 mb-2">
              <select
                value={aisleNumber}
                onChange={(e) => setAisleNumber(e.target.value)}
                className="rounded-lg px-3 py-2.5 text-sm border outline-none"
                style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
              >
                {aisles.map((a) => (
                  <option key={a.number} value={a.number}>{a.number} · {a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Buy one loaf, get one 50% off"
                className="flex-1 rounded-lg px-3 py-2.5 text-sm border outline-none"
                style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <button
                onClick={submit}
                className="rounded-lg px-4 flex items-center gap-2 text-sm font-bold"
                style={{ backgroundColor: ORANGE, color: BG }}
              >
                <Plus size={15} /> Add deal
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AislesTab({ aisles, renameAisle, deleteAisle, addAisle }) {
  const [name, setName] = useState('');
  return (
    <div className="max-w-xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Your aisles</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>These are the numbered signs shoppers will see hanging over each aisle.</p>

      <div className="space-y-2 mb-6">
        {aisles.length === 0 && <p className="text-sm italic" style={{ color: '#B4A87F' }}>No aisles yet — add your first one below.</p>}
        {aisles.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ backgroundColor: PAPER }}>
            <div className="flex items-center justify-center rounded-md font-mono font-bold text-sm flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: BG, color: ORANGE }}>
              {a.number}
            </div>
            <input
              value={a.name}
              onChange={(e) => renameAisle(a.id, e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm font-semibold"
              style={{ color: INK }}
            />
            <button onClick={() => deleteAisle(a.id, a.number)}>
              <Trash2 size={15} color={RED} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New aisle name, e.g. Produce"
          className="flex-1 rounded-lg px-3 py-2.5 text-sm border outline-none"
          style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          onKeyDown={(e) => { if (e.key === 'Enter') { addAisle(name); setName(''); } }}
        />
        <button onClick={() => { addAisle(name); setName(''); }} className="rounded-lg px-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: ORANGE, color: BG }}>
          <Plus size={15} /> Add aisle
        </button>
      </div>
    </div>
  );
}

function SmartImportPanel({ aisles, commitSmartImport }) {
  const [rawText, setRawText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | review | saving | done
  const [reviewItems, setReviewItems] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  const knownCategories = Object.keys(CATEGORY_KEYWORDS);
  const categoryOptions = [...new Set([...aisles.map((a) => a.name), ...knownCategories])];
  const unsortedCount = reviewItems.filter((i) => !i.category).length;

  const runClassify = () => {
    if (!rawText.trim()) return;
    const existing = aisles.map((a) => a.name);
    const items = classifyOffline(existing, rawText);
    if (items.length === 0) {
      setErrorMsg('Nothing to sort — check the pasted text.');
      return;
    }
    setErrorMsg('');
    setReviewItems(items);
    setStatus('review');
  };

  const updateReviewItem = (idx, patch) => {
    setReviewItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const removeReviewItem = (idx) => {
    setReviewItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setStatus('saving');
    try {
      const result = await commitSmartImport(reviewItems);
      setResultMsg(
        `Saved ${result.productCount} product${result.productCount === 1 ? '' : 's'}` +
          (result.newAisleCount ? ` and created ${result.newAisleCount} new aisle${result.newAisleCount === 1 ? '' : 's'}.` : '.')
      );
      setStatus('done');
      setRawText('');
      setReviewItems([]);
    } catch (e) {
      setErrorMsg('Saving failed — check your connection and try again.');
      setStatus('review');
    }
  };

  return (
    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#2B3D2F' }}>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardPaste size={15} color={ORANGE} />
        <span style={{ color: ORANGE, fontSize: 11, fontWeight: 800, letterSpacing: 1.5 }}>SMART IMPORT</span>
      </div>
      <p className="text-xs mb-3" style={{ color: '#D9CBAE' }}>
        Paste your raw product list — just names, or "name, price" — and it's automatically sorted into aisles.
        Anything it doesn't recognize is flagged for you to assign in one click.
      </p>

      {status === 'idle' && (
        <>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={6}
            placeholder={'Whole milk, 3.49\nSourdough bread\nBananas, 0.59\nCheddar cheese, 4.29\n...'}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none mb-2"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <button
            onClick={runClassify}
            className="rounded-lg px-4 py-2.5 text-sm font-bold"
            style={{ backgroundColor: ORANGE, color: BG }}
          >
            Sort into aisles
          </button>
          {errorMsg && <p className="text-xs mt-2" style={{ color: '#E8A67D' }}>{errorMsg}</p>}
        </>
      )}

      {(status === 'review' || status === 'saving') && (
        <>
          {unsortedCount > 0 && (
            <p className="text-xs mb-2" style={{ color: '#F2C18D' }}>
              {unsortedCount} item{unsortedCount === 1 ? "wasn't" : "s weren't"} recognized — pick a category for
              {unsortedCount === 1 ? ' it' : ' them'} below before saving.
            </p>
          )}
          <div className="rounded-lg overflow-hidden mb-3" style={{ backgroundColor: CREAM }}>
            {reviewItems.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: '#EDE6D4', backgroundColor: item.category ? 'transparent' : '#FBEAD3' }}
              >
                <input
                  value={item.name}
                  onChange={(e) => updateReviewItem(idx, { name: e.target.value })}
                  className="flex-1 text-sm bg-transparent outline-none"
                  style={{ color: INK }}
                />
                <select
                  value={item.category || ''}
                  onChange={(e) => updateReviewItem(idx, { category: e.target.value })}
                  className="text-xs rounded px-2 py-1 border outline-none"
                  style={{ borderColor: item.category ? '#E5DDCB' : ORANGE, color: INK, backgroundColor: '#fff' }}
                >
                  <option value="" disabled>Choose category…</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{c}{!aisles.some((a) => a.name.toLowerCase() === c.toLowerCase()) ? ' (new)' : ''}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1 font-mono text-sm" style={{ color: INK }}>
                  $<input
                    value={item.price ?? ''}
                    onChange={(e) => updateReviewItem(idx, { price: parseFloat(e.target.value) || 0 })}
                    className="w-14 bg-transparent outline-none"
                  />
                </div>
                <button onClick={() => removeReviewItem(idx)}>
                  <Trash2 size={13} color="#C7B99A" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={status === 'saving' || reviewItems.length === 0 || unsortedCount > 0}
              className="rounded-lg px-4 py-2.5 text-sm font-bold flex items-center gap-2"
              style={{ backgroundColor: GREEN, color: BG, opacity: unsortedCount > 0 ? 0.5 : 1 }}
            >
              {status === 'saving' && <Loader2 size={14} className="animate-spin" />}
              {status === 'saving' ? 'Saving…' : `Looks good — save ${reviewItems.length} product${reviewItems.length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => { setStatus('idle'); setReviewItems([]); }} className="text-xs" style={{ color: '#D9CBAE' }}>
              Start over
            </button>
          </div>
          {errorMsg && <p className="text-xs mt-2" style={{ color: '#E8A67D' }}>{errorMsg}</p>}
        </>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-2">
          <p className="text-sm" style={{ color: '#B8E0A0' }}>{resultMsg}</p>
          <button onClick={() => setStatus('idle')} className="text-xs underline" style={{ color: '#D9CBAE' }}>Import more</button>
        </div>
      )}
    </div>
  );
}

function ProductsTab({ aisles, products, updateProduct, deleteProduct, addProduct, bulkImport, commitSmartImport }) {
  const [showManualImport, setShowManualImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');

  const runImport = async () => {
    setImporting(true);
    const count = await bulkImport(importText);
    setImportMsg(count > 0 ? `Imported ${count} product${count === 1 ? '' : 's'}.` : 'Nothing to import — check the format.');
    setImportText('');
    setImporting(false);
  };

  return (
    <div>
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Product catalog</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>Each card below is a live shelf tag — edit it and shoppers see the change immediately.</p>

      <SmartImportPanel aisles={aisles} commitSmartImport={commitSmartImport} />

      <button onClick={() => setShowManualImport((v) => !v)} className="flex items-center gap-2 text-sm font-semibold mb-4 mt-2" style={{ color: MUTED }}>
        <ClipboardPaste size={13} />
        {showManualImport ? 'Hide manual import' : 'Prefer to assign aisles yourself? Manual import'}
      </button>

      {showManualImport && (
        <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: PAPER }}>
          <p className="text-xs mb-2" style={{ color: '#8C7A4A' }}>
            One product per line, with the aisle number you choose:{' '}
            <span className="font-mono">name, aisle number, price, stock (in/low/out)</span>
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            placeholder={'Milk, 3, 3.49, in\nBread, 2, 3.29, low'}
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none mb-2"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <div className="flex items-center gap-3">
            <button onClick={runImport} disabled={importing} className="rounded-lg px-4 py-2 text-sm font-bold flex items-center gap-2" style={{ backgroundColor: GREEN, color: BG }}>
              {importing && <Loader2 size={13} className="animate-spin" />}
              Import into catalog
            </button>
            {importMsg && <span className="text-xs" style={{ color: '#4C6B45' }}>{importMsg}</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {products.map((p) => (
          <ProductTag key={p.id} product={p} aisles={aisles} updateProduct={updateProduct} deleteProduct={deleteProduct} />
        ))}
      </div>

      <div className="rounded-lg p-4 flex gap-2 items-center flex-wrap" style={{ backgroundColor: PAPER }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New product name"
          className="rounded-lg px-3 py-2 text-sm border outline-none flex-1 min-w-[140px]"
          style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
        />
        <input
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          placeholder="Price"
          className="rounded-lg px-3 py-2 text-sm border outline-none w-24 font-mono"
          style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
        />
        <button
          onClick={() => { addProduct(newName, aisles[0] ? aisles[0].number : null, newPrice); setNewName(''); setNewPrice(''); }}
          className="rounded-lg px-4 py-2 text-sm font-bold flex items-center gap-1"
          style={{ backgroundColor: ORANGE, color: BG }}
        >
          <Plus size={14} /> Add product
        </button>
      </div>
    </div>
  );
}

function ProductTag({ product, aisles, updateProduct, deleteProduct }) {
  const stock = STOCK_META[product.stock] || STOCK_META.in;
  return (
    <div className="relative rounded-lg p-3 pt-4" style={{ backgroundColor: '#fff', border: '1px solid #E5DDCB' }}>
      <div className="absolute rounded-full" style={{ width: 10, height: 10, backgroundColor: CREAM, border: '1px solid #E5DDCB', top: -5, left: 12 }} />
      <div className="flex justify-between items-start mb-2">
        <input
          value={product.label}
          onChange={(e) => updateProduct(product.id, { label: e.target.value })}
          className="text-sm font-bold bg-transparent outline-none flex-1"
          style={{ color: INK }}
        />
        <button onClick={() => deleteProduct(product.id)} className="ml-1 flex-shrink-0">
          <Trash2 size={13} color="#C7B99A" />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs" style={{ color: '#8C7A4A' }}>Aisle</span>
        <select
          value={product.aisle_number ?? ''}
          onChange={(e) => updateProduct(product.id, { aisle_number: e.target.value === '' ? null : Number(e.target.value) })}
          className="text-xs rounded px-2 py-1 border outline-none flex-1"
          style={{ borderColor: '#E5DDCB', color: INK }}
        >
          <option value="">Unmapped</option>
          {aisles.map((a) => (
            <option key={a.id} value={a.number}>{a.number} · {a.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm font-bold" style={{ color: INK }}>$</span>
          <input
            value={product.price}
            onChange={(e) => updateProduct(product.id, { price: parseFloat(e.target.value) || 0 })}
            className="font-mono text-sm font-bold bg-transparent outline-none w-14"
            style={{ color: INK }}
          />
        </div>
        <button
          onClick={() => {
            const order = ['in', 'low', 'out'];
            const next = order[(order.indexOf(product.stock) + 1) % order.length];
            updateProduct(product.id, { stock: next });
          }}
          className="flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-1"
          style={{ backgroundColor: `${stock.color}22`, color: stock.color }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stock.color, display: 'inline-block' }} />
          {stock.label}
        </button>
      </div>
    </div>
  );
}

function PreviewTab({ aisles, products, unmapped }) {
  return (
    <div className="max-w-xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">What shoppers will see</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>A quick check before you move on.</p>

      {unmapped.length > 0 && (
        <div className="rounded-lg p-4 mb-6 flex gap-3" style={{ backgroundColor: '#FBEAD3', border: '1px solid #E2891F55' }}>
          <AlertTriangle size={18} color={RED} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold" style={{ color: INK }}>{unmapped.length} product{unmapped.length === 1 ? '' : 's'} not assigned to an aisle</p>
            <p className="text-xs mt-1" style={{ color: '#8C7A4A' }}>{unmapped.map((p) => p.label).join(', ')}</p>
          </div>
        </div>
      )}

      {aisles.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#B4A87F' }}>Add aisles and products to see a preview.</p>
      ) : (
        <div className="space-y-3">
          {aisles.map((a) => {
            const items = products.filter((p) => p.aisle_number === a.number);
            return (
              <div key={a.id} className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center rounded font-mono font-bold text-xs" style={{ width: 22, height: 22, backgroundColor: BG, color: ORANGE }}>
                    {a.number}
                  </div>
                  <span className="text-sm font-bold" style={{ color: INK }}>{a.name}</span>
                  <span className="text-xs ml-auto" style={{ color: '#8C7A4A' }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs italic" style={{ color: '#B4A87F' }}>No products here yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {items.map((p) => (
                      <span key={p.id} className="text-xs rounded-full px-2 py-1" style={{ backgroundColor: '#fff', color: INK }}>
                        {p.label} · ${Number(p.price).toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
