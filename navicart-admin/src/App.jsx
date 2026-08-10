import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Store, Plus, Trash2, ClipboardPaste, LayoutGrid, Tags, Tag, Eye, ChevronLeft, AlertTriangle, Loader2, Cloud, CloudOff, BarChart3, Search, PackageX, MapPin, Users, Download, ScanLine, Languages, X, Move, ChefHat, Settings, ShieldAlert } from 'lucide-react';

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

// Client-side CSV download — no server round-trip needed.
function downloadCsv(filename, rows) {  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const DISPLAY_FONT = "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

// ---- Spanish/English translations for the entry screens and nav ----
const STRINGS = {
  en: {
    tagline: 'NAVICART · STORE SETUP',
    logIn: 'Log in',
    signUp: 'Sign up',
    createAccount: 'Create your account',
    email: 'EMAIL',
    password: 'PASSWORD',
    pleaseWait: 'Please wait…',
    noAccount: "Don't have an account? Sign up",
    haveAccount: 'Already have an account? Log in',
    logOut: 'Log out',
    getAislesOnline: 'Get your aisles online',
    landingSub: "Set up your store's aisle layout and product catalog so shoppers can find what they need.",
    newStore: 'NEW STORE',
    storeNamePlaceholder: "Your store's name",
    yourStores: 'YOUR STORES',
    switchStore: 'Switch store',
    editing: 'EDITING',
    navAisles: 'Aisles',
    navProducts: 'Products',
    navDeals: 'Deals',
    navInsights: 'Insights',
    navTeam: 'Team',
    navPreview: 'Shopper preview',
    connectedNote: 'Connected to a live database — changes here are real and shared with the shopper app.',
  },
  es: {
    tagline: 'NAVICART · CONFIGURACIÓN DE TIENDA',
    logIn: 'Iniciar sesión',
    signUp: 'Registrarse',
    createAccount: 'Crea tu cuenta',
    email: 'CORREO ELECTRÓNICO',
    password: 'CONTRASEÑA',
    pleaseWait: 'Espera un momento…',
    noAccount: '¿No tienes cuenta? Regístrate',
    haveAccount: '¿Ya tienes cuenta? Inicia sesión',
    logOut: 'Cerrar sesión',
    getAislesOnline: 'Publica los pasillos de tu tienda',
    landingSub: 'Configura el diseño de pasillos y el catálogo de productos para que los clientes encuentren lo que buscan.',
    newStore: 'NUEVA TIENDA',
    storeNamePlaceholder: 'Nombre de tu tienda',
    yourStores: 'TUS TIENDAS',
    switchStore: 'Cambiar de tienda',
    editing: 'EDITANDO',
    navAisles: 'Pasillos',
    navProducts: 'Productos',
    navDeals: 'Ofertas',
    navInsights: 'Estadísticas',
    navTeam: 'Equipo',
    navPreview: 'Vista del cliente',
    connectedNote: 'Conectado a una base de datos en vivo — los cambios aquí son reales y se comparten con la app del cliente.',
  },
};

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

// ---- Real spreadsheet upload ----
// Every store's inventory export uses its own column names and its
// own aisle/category labels — this reads the actual file (CSV or
// Excel) and, when it finds a category-like column, trusts the
// store's own naming instead of guessing. Only falls back to the
// keyword classifier above when there's no category data to read.
const HEADER_ALIASES = {
  name: ['name', 'item', 'product', 'description', 'item name', 'product name'],
  price: ['price', 'cost', 'retail', 'retail price', 'unit price'],
  category: ['category', 'aisle', 'department', 'section', 'dept', 'aisle name', 'category name'],
};

function findColumn(headers, kind) {
  const aliases = HEADER_ALIASES[kind];
  const lowerHeaders = headers.map((h) => (h || '').toString().trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lowerHeaders.indexOf(alias);
    if (idx !== -1) return idx;
  }
  // fall back to a loose "contains" match if no exact header hit
  for (const alias of aliases) {
    const idx = lowerHeaders.findIndex((h) => h.includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function parseSpreadsheetFile(file, existingCategories) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (rows.length === 0) return { items: [], usedOwnCategories: false };

  const headers = rows[0];
  const nameIdx = findColumn(headers, 'name');
  const priceIdx = findColumn(headers, 'price');
  const categoryIdx = findColumn(headers, 'category');
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell).trim()));

  // No recognizable header row at all — treat column A as the name
  // and fall back to the offline keyword classifier, same as a
  // plain paste would.
  if (nameIdx === -1 && categoryIdx === -1) {
    const rawText = dataRows.map((r) => r[0]).join('\n');
    return { items: classifyOffline(existingCategories, rawText), usedOwnCategories: false };
  }

  const items = dataRows.map((r) => {
    const rawName = nameIdx !== -1 ? r[nameIdx] : r[0];
    const name = titleCase(String(rawName || '').trim());
    const priceRaw = priceIdx !== -1 ? String(r[priceIdx]).replace(/[^0-9.]/g, '') : '';
    const price = priceRaw ? parseFloat(priceRaw) : null;
    const category = categoryIdx !== -1 ? String(r[categoryIdx] || '').trim() || null : null;
    return { name, category, price };
  }).filter((it) => it.name);

  return { items, usedOwnCategories: categoryIdx !== -1 };
}

function AuthScreen({ onAuthed, lang, setLang }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const t = STRINGS[lang];

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
        setNotice(lang === 'es' ? 'Cuenta creada — revisa tu correo para confirmar y luego inicia sesión.' : 'Account created — check your email to confirm, then log in.');
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
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Store size={18} color={ORANGE} />
            <span style={{ color: ORANGE, letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>{t.tagline}</span>
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'es' : 'en')} className="flex items-center gap-1 text-xs font-bold" style={{ color: CREAM }}>
            <Languages size={13} /> {lang === 'en' ? 'ES' : 'EN'}
          </button>
        </div>
        <h1 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 30, fontWeight: 700 }} className="mb-6">
          {mode === 'login' ? t.logIn : t.createAccount}
        </h1>

        <div className="rounded-xl p-5" style={{ backgroundColor: CREAM }}>
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{t.email}</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mt-1 mb-3"
            style={{ borderColor: '#E5DDCB', color: INK }}
          />
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{t.password}</label>
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
            {busy ? t.pleaseWait : mode === 'login' ? t.logIn : t.signUp}
          </button>

          {error && <p className="text-xs mt-3" style={{ color: RED }}>{error}</p>}
          {notice && <p className="text-xs mt-3" style={{ color: '#4C6B45' }}>{notice}</p>}

          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}
            className="text-xs mt-4 block mx-auto"
            style={{ color: '#8C7A4A' }}
          >
            {mode === 'login' ? t.noAccount : t.haveAccount}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StoreAdmin() {
  const [session, setSession] = useState(null); // {accessToken, user}
  const [lang, setLang] = useState('en');
  const [phase, setPhase] = useState('auth'); // auth | loading | landing | editor
  const [storeList, setStoreList] = useState([]);
  const [newStoreName, setNewStoreName] = useState('');
  const [store, setStore] = useState(null); // {id, slug, name}
  const [aisles, setAisles] = useState([]); // [{id, number, name}]
  const [products, setProducts] = useState([]); // [{id, key, label, aisle_number, price, stock}]
  const [promos, setPromos] = useState([]); // [{id, aisle_number, text}]
  const [recipes, setRecipes] = useState([]); // [{id, title, description, ingredients, image_url}]
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [adminStores, setAdminStores] = useState([]);
  const [tab, setTab] = useState('aisles');
  const [sync, setSync] = useState('idle'); // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('');
  const [opening, setOpening] = useState(false);

  function handleAuthed(newSession) {    currentAccessToken = newSession.accessToken;
    setSession(newSession);
    loadStores(newSession);
    checkAdmin(newSession);
  }

  function logOut() {
    currentAccessToken = null;
    setSession(null);
    setStore(null);
    setIsAdmin(false);
    setPhase('auth');
  }

  async function checkAdmin(activeSession) {
    try {
      const email = (activeSession || session).user.email;
      const rows = await sb(`platform_admins?select=email&email=eq.${encodeURIComponent(email)}`);
      setIsAdmin((rows || []).length > 0);
    } catch (e) {
      setIsAdmin(false);
    }
  }

  async function loadStores(activeSession) {
    setPhase('loading');
    try {
      const s = activeSession || session;
      const uid = s.user.id;
      const email = s.user.email;
      const [ownedRows, memberRows, transferRows] = await Promise.all([
        sb(`stores?select=id,slug,name,owner_id,entrance_x,entrance_y,checkout_x,checkout_y,pending_transfer_email,suspended&owner_id=eq.${uid}&order=name`),
        sb(`store_members?select=store_id,stores(id,slug,name,owner_id,entrance_x,entrance_y,checkout_x,checkout_y,pending_transfer_email,suspended)&email=eq.${encodeURIComponent(email)}`),
        sb(`stores?select=id,slug,name&pending_transfer_email=eq.${encodeURIComponent(email)}`),
      ]);
      const staffStores = (memberRows || []).map((m) => m.stores).filter(Boolean);
      const byId = new Map();
      [...(ownedRows || []), ...staffStores].forEach((s) => byId.set(s.id, s));
      setStoreList(Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)));
      setPendingTransfers(transferRows || []);
    } catch (e) {
      setErrorMsg('Could not reach the database. Check your connection.');
    }
    setPhase('landing');
  }

  async function acceptTransfer(storeId) {
    setErrorMsg('');
    try {
      await sb(`stores?id=eq.${storeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ owner_id: session.user.id, pending_transfer_email: null }),
      });
      await loadStores();
    } catch (e) {
      setErrorMsg('Could not accept that transfer. Try again.');
    }
  }

  async function loadAdminStores() {
    try {
      const rows = await sb('stores?select=id,slug,name,owner_id,suspended&order=name');
      setAdminStores(rows || []);
    } catch (e) {
      setAdminStores([]);
    }
  }

  async function adminSetSuspended(storeId, suspended) {
    setAdminStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, suspended } : s)));
    try {
      await sb(`stores?id=eq.${storeId}`, { method: 'PATCH', body: JSON.stringify({ suspended }) });
    } catch (e) {
      loadAdminStores();
    }
  }

  async function adminDeleteStore(storeId) {
    setAdminStores((prev) => prev.filter((s) => s.id !== storeId));
    try {
      await sb(`stores?id=eq.${storeId}`, { method: 'DELETE' });
    } catch (e) {
      loadAdminStores();
    }
  }

  async function openStore(s) {
    setOpening(true);
    setErrorMsg('');
    try {
      const [aisleRows, productRows, promoRows, recipeRows] = await Promise.all([
        sb(`aisles?store_id=eq.${s.id}&select=*&order=number`),
        sb(`products?store_id=eq.${s.id}&select=*&order=aisle_number`),
        sb(`promos?store_id=eq.${s.id}&select=*&order=created_at`),
        sb(`recipes?store_id=eq.${s.id}&select=*&order=created_at.desc`),
      ]);
      setAisles(aisleRows || []);
      setProducts(productRows || []);
      setPromos(promoRows || []);
      setRecipes(recipeRows || []);
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
      setRecipes([]);
      setStore(s);
      setTab('aisles');
      setPhase('editor');
      setNewStoreName('');
    } catch (e) {
      setErrorMsg(`Could not create store: ${e.message || 'unknown error'}`);
    }
    setOpening(false);
  }

  // ---- staff/team ops ----
  const [teamMembers, setTeamMembers] = useState([]);
  useEffect(() => {
    if (store && store.owner_id === session?.user?.id) loadTeam();
    else setTeamMembers([]);
  }, [store?.id]);
  async function loadTeam() {
    try {
      const rows = await sb(`store_members?store_id=eq.${store.id}&select=*&order=added_at`);
      setTeamMembers(rows || []);
    } catch (e) {
      setTeamMembers([]);
    }
  }
  async function addStaff(email) {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    setSync('saving');
    try {
      const rows = await sb('store_members', {
        method: 'POST',
        body: JSON.stringify({ store_id: store.id, email: clean }),
      });
      setTeamMembers((prev) => [...prev, rows[0]]);
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }
  async function removeStaff(id) {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    setSync('saving');
    try {
      await sb(`store_members?id=eq.${id}`, { method: 'DELETE' });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
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

  // ---- recipe ops ----
  async function addRecipe(title, description, ingredients, imageUrl) {
    if (!title.trim() || !ingredients.trim()) return;
    setSync('saving');
    try {
      const rows = await sb('recipes', {
        method: 'POST',
        body: JSON.stringify({
          store_id: store.id,
          title: title.trim(),
          description: description.trim() || null,
          ingredients: ingredients.trim(),
          image_url: imageUrl.trim() || null,
        }),
      });
      setRecipes((prev) => [rows[0], ...prev]);
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  async function deleteRecipe(id) {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setSync('saving');
    try {
      await sb(`recipes?id=eq.${id}`, { method: 'DELETE' });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  function backToStores() {
    setStore(null);
    loadStores();
  }

  // ---- danger zone: delete + transfer ----
  async function deleteStore() {
    const id = store.id;
    setSync('saving');
    try {
      await sb(`stores?id=eq.${id}`, { method: 'DELETE' });
      backToStores();
    } catch (e) {
      setErrorMsg('Could not delete that store. Try again.');
      setSync('error');
    }
  }

  async function setTransferEmail(email) {
    setSync('saving');
    try {
      const rows = await sb(`stores?id=eq.${store.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pending_transfer_email: email ? email.toLowerCase().trim() : null }),
      });
      setStore(rows[0]);
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
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

  // Persists a floor-plan box move/resize. Called frequently while
  // dragging (local state only) and once on release (writes to DB).
  function moveAisleLocal(id, patch) {
    setAisles((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  async function saveAisleLayout(id, patch) {
    setSync('saving');
    try {
      await sb(`aisles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setSync('idle');
    } catch (e) {
      setSync('error');
    }
  }

  // Same pattern, for the store's entrance/checkout markers.
  function moveStorePointLocal(patch) {
    setStore((prev) => ({ ...prev, ...patch }));
  }
  async function saveStorePoint(patch) {
    setSync('saving');
    try {
      await sb(`stores?id=eq.${store.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
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
      {phase === 'auth' && <AuthScreen onAuthed={handleAuthed} lang={lang} setLang={setLang} />}

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
          lang={lang}
          setLang={setLang}
          isAdmin={isAdmin}
          onOpenAdmin={() => { loadAdminStores(); setPhase('admin'); }}
          pendingTransfers={pendingTransfers}
          onAcceptTransfer={acceptTransfer}
        />
      )}

      {phase === 'admin' && (
        <AdminView
          stores={adminStores}
          onSuspend={adminSetSuspended}
          onDelete={adminDeleteStore}
          onBack={() => setPhase('landing')}
        />
      )}

      {phase === 'editor' && store && (
        <EditorShell
          store={store}
          session={session}
          lang={lang}
          aisles={aisles}
          products={products}
          promos={promos}
          teamMembers={teamMembers}
          addStaff={addStaff}
          removeStaff={removeStaff}
          tab={tab}
          setTab={setTab}
          onBack={backToStores}
          sync={sync}
          addAisle={addAisle}
          renameAisle={renameAisle}
          deleteAisle={deleteAisle}
          moveAisleLocal={moveAisleLocal}
          saveAisleLayout={saveAisleLayout}
          moveStorePointLocal={moveStorePointLocal}
          saveStorePoint={saveStorePoint}
          addProduct={addProduct}
          updateProduct={updateProduct}
          deleteProduct={deleteProduct}
          bulkImport={bulkImport}
          commitSmartImport={commitSmartImport}
          addPromo={addPromo}
          deletePromo={deletePromo}
          recipes={recipes}
          addRecipe={addRecipe}
          deleteRecipe={deleteRecipe}
          deleteStore={deleteStore}
          setTransferEmail={setTransferEmail}
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

function Landing({ storeList, newStoreName, setNewStoreName, onOpen, onCreate, opening, errorMsg, onLogOut, lang, setLang, isAdmin, onOpenAdmin, pendingTransfers, onAcceptTransfer }) {
  const t = STRINGS[lang];
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Store size={18} color={ORANGE} />
            <span style={{ color: ORANGE, letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>{t.tagline}</span>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button onClick={onOpenAdmin} className="flex items-center gap-1 text-xs font-bold" style={{ color: '#E8A67D' }}>
                <ShieldAlert size={13} /> Admin
              </button>
            )}
            <button onClick={() => setLang(lang === 'en' ? 'es' : 'en')} className="flex items-center gap-1 text-xs font-bold" style={{ color: MUTED }}>
              <Languages size={13} /> {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <button onClick={onLogOut} className="text-xs" style={{ color: MUTED }}>{t.logOut}</button>
          </div>
        </div>
        <h1 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 34, fontWeight: 700, lineHeight: 1.15 }} className="mb-1">
          {t.getAislesOnline}
        </h1>
        <p style={{ color: MUTED }} className="text-sm mb-8">
          {t.landingSub}
        </p>

        {errorMsg && (
          <div className="rounded-lg p-3 mb-4 flex gap-2 items-start" style={{ backgroundColor: 'rgba(200,80,50,0.15)' }}>
            <AlertTriangle size={14} color="#E8A67D" className="mt-0.5 flex-shrink-0" />
            <span className="text-xs" style={{ color: '#E8A67D' }}>{errorMsg}</span>
          </div>
        )}

        {pendingTransfers.length > 0 && (
          <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: '#2B3D2F', border: '1px solid rgba(226,137,31,0.4)' }}>
            <label style={{ color: ORANGE, fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>PENDING TRANSFERS TO YOU</label>
            <div className="mt-2 space-y-2">
              {pendingTransfers.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <span style={{ color: CHALK, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                  <button onClick={() => onAcceptTransfer(s.id)} className="rounded-md px-3 py-1 text-xs font-bold" style={{ backgroundColor: GREEN, color: BG }}>
                    Accept
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: CREAM }}>
          <label style={{ color: '#8C7A4A', fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{t.newStore}</label>
          <div className="flex gap-2 mt-2">
            <input
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              placeholder={t.storeNamePlaceholder}
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
            <label style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{t.yourStores}</label>
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
  store, session, lang, aisles, products, promos, teamMembers, addStaff, removeStaff, tab, setTab, onBack, sync,
  addAisle, renameAisle, deleteAisle, addProduct, updateProduct, deleteProduct, bulkImport, commitSmartImport,
  addPromo, deletePromo, moveAisleLocal, saveAisleLayout, moveStorePointLocal, saveStorePoint,
  recipes, addRecipe, deleteRecipe, deleteStore, setTransferEmail,
}) {
  // Lives here, not inside ProductsTab, so a paste + review survives
  // switching to another tab (e.g. Aisles) and back — ProductsTab
  // itself unmounts on tab switch, EditorShell does not.
  const [importState, setImportStateRaw] = useState({
    rawText: '', status: 'idle', reviewItems: [], errorMsg: '', resultMsg: '',
  });
  const setImportState = (patch) => setImportStateRaw((prev) => ({ ...prev, ...patch }));

  const unmapped = products.filter((p) => !aisles.some((a) => a.number === p.aisle_number));
  const isOwner = store.owner_id === session?.user?.id;
  const tr = STRINGS[lang];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="md:w-64 flex-shrink-0 p-6 flex flex-col" style={{ backgroundColor: BG }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-8 text-sm" style={{ color: MUTED }}>
          <ChevronLeft size={14} /> {tr.switchStore}
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Store size={16} color={ORANGE} />
          <span style={{ color: ORANGE, fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>{tr.editing}</span>
        </div>
        <h2 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 22, fontWeight: 700 }} className="mb-8">
          {store.name}
        </h2>

        <nav className="space-y-1 flex-1">
          {[
            { id: 'aisles', label: tr.navAisles, icon: LayoutGrid },
            { id: 'floorplan', label: 'Floor Plan', icon: Move },
            { id: 'products', label: tr.navProducts, icon: Tags },
            { id: 'deals', label: tr.navDeals, icon: Tag },
            { id: 'recipes', label: 'Recipes', icon: ChefHat },
            { id: 'insights', label: tr.navInsights, icon: BarChart3 },
            ...(isOwner ? [{ id: 'team', label: tr.navTeam, icon: Users }] : []),
            { id: 'preview', label: tr.navPreview, icon: Eye },
            ...(isOwner ? [{ id: 'settings', label: 'Settings', icon: Settings }] : []),
          ].map((tabDef) => (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition"
              style={{ backgroundColor: tab === tabDef.id ? ORANGE : 'transparent', color: tab === tabDef.id ? BG : CREAM }}
            >
              <tabDef.icon size={15} />
              {tabDef.label}
            </button>
          ))}
        </nav>

        <div className="pt-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <SyncBadge sync={sync} />
        </div>
      </div>

      <div className="flex-1 p-6 md:p-10" style={{ backgroundColor: CREAM }}>
        {tab === 'aisles' && <AislesTab aisles={aisles} renameAisle={renameAisle} deleteAisle={deleteAisle} addAisle={addAisle} />}
        {tab === 'floorplan' && (
          <FloorPlanTab
            store={store}
            aisles={aisles}
            moveAisleLocal={moveAisleLocal}
            saveAisleLayout={saveAisleLayout}
            moveStorePointLocal={moveStorePointLocal}
            saveStorePoint={saveStorePoint}
          />
        )}
        {tab === 'products' && (
          <ProductsTab aisles={aisles} products={products} updateProduct={updateProduct} deleteProduct={deleteProduct} addProduct={addProduct} bulkImport={bulkImport} commitSmartImport={commitSmartImport} importState={importState} setImportState={setImportState} />
        )}
        {tab === 'deals' && (
          <DealsTab aisles={aisles} promos={promos} addPromo={addPromo} deletePromo={deletePromo} />
        )}
        {tab === 'recipes' && (
          <RecipesTab recipes={recipes} addRecipe={addRecipe} deleteRecipe={deleteRecipe} />
        )}
        {tab === 'insights' && <InsightsTab store={store} aisles={aisles} addProduct={addProduct} />}
        {tab === 'team' && isOwner && (
          <TeamTab teamMembers={teamMembers} addStaff={addStaff} removeStaff={removeStaff} />
        )}
        {tab === 'preview' && <PreviewTab aisles={aisles} products={products} unmapped={unmapped} />}
        {tab === 'settings' && isOwner && (
          <SettingsTab store={store} onBack={onBack} deleteStore={deleteStore} setTransferEmail={setTransferEmail} />
        )}
      </div>
    </div>
  );
}

function SettingsTab({ store, onBack, deleteStore, setTransferEmail }) {
  const [transferInput, setTransferInput] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const sendTransfer = () => {
    if (!transferInput.trim()) return;
    setTransferEmail(transferInput.trim());
    setTransferInput('');
  };

  const confirmDelete = () => {
    if (confirmName.trim().toLowerCase() !== store.name.trim().toLowerCase()) return;
    deleteStore();
  };

  return (
    <div className="max-w-xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Settings</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>Ownership and account-level controls for {store.name}.</p>

      <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: PAPER }}>
        <p className="text-sm font-bold mb-1" style={{ color: INK }}>Transfer ownership</p>
        <p className="text-xs mb-3" style={{ color: '#8C7A4A' }}>
          Selling the store or handing it off? Enter the new owner's email. They'll need to log in and accept —
          nothing changes until they do.
        </p>
        {store.pending_transfer_email ? (
          <div className="flex items-center justify-between rounded-lg px-3 py-2 mb-2" style={{ backgroundColor: '#fff' }}>
            <span className="text-xs" style={{ color: INK }}>Pending transfer to <strong>{store.pending_transfer_email}</strong></span>
            <button onClick={() => setTransferEmail(null)} className="text-xs font-bold" style={{ color: RED }}>Cancel</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={transferInput}
              onChange={(e) => setTransferInput(e.target.value)}
              placeholder="newowner@email.com"
              className="flex-1 rounded-lg px-3 py-2 text-sm border outline-none"
              style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
            />
            <button onClick={sendTransfer} className="rounded-lg px-4 text-sm font-bold" style={{ backgroundColor: ORANGE, color: BG }}>
              Transfer
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg p-4" style={{ backgroundColor: '#FBEAD3', border: '1px solid #E2891F55' }}>
        <p className="text-sm font-bold mb-1" style={{ color: '#7A2E17' }}>Delete this store</p>
        <p className="text-xs mb-3" style={{ color: '#8C7A4A' }}>
          Permanently removes {store.name} and everything in it — aisles, products, deals, recipes, and usage
          history. This can't be undone.
        </p>
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="rounded-lg px-4 py-2 text-sm font-bold" style={{ backgroundColor: RED, color: '#fff' }}>
            Delete store
          </button>
        ) : (
          <div>
            <p className="text-xs mb-2" style={{ color: '#7A2E17' }}>
              Type <strong>{store.name}</strong> to confirm:
            </p>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-2"
              style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
            />
            <div className="flex gap-2">
              <button
                onClick={confirmDelete}
                disabled={confirmName.trim().toLowerCase() !== store.name.trim().toLowerCase()}
                className="rounded-lg px-4 py-2 text-sm font-bold"
                style={{ backgroundColor: RED, color: '#fff', opacity: confirmName.trim().toLowerCase() === store.name.trim().toLowerCase() ? 1 : 0.5 }}
              >
                Permanently delete
              </button>
              <button onClick={() => { setShowDeleteConfirm(false); setConfirmName(''); }} className="text-sm" style={{ color: '#8C7A4A' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminView({ stores, onSuspend, onDelete, onBack }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  return (
    <div className="min-h-screen p-6 md:p-10" style={{ backgroundColor: BG }}>
      <button onClick={onBack} className="flex items-center gap-1 mb-6 text-sm" style={{ color: MUTED }}>
        <ChevronLeft size={14} /> Back
      </button>
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert size={18} color="#E8A67D" />
        <span style={{ color: '#E8A67D', letterSpacing: 2, fontSize: 11, fontWeight: 700 }}>PLATFORM ADMIN</span>
      </div>
      <h1 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: CREAM, fontSize: 28, fontWeight: 700 }} className="mb-6">
        Every store
      </h1>

      <div className="space-y-2 max-w-2xl">
        {stores.map((s) => (
          <div key={s.id} className="rounded-lg p-4 flex items-center justify-between" style={{ backgroundColor: CREAM }}>
            <div>
              <p className="text-sm font-bold" style={{ color: INK }}>{s.name}</p>
              {s.suspended && <p className="text-xs font-bold" style={{ color: RED }}>SUSPENDED</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSuspend(s.id, !s.suspended)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{ backgroundColor: s.suspended ? GREEN : '#FBEAD3', color: s.suspended ? BG : '#7A2E17' }}
              >
                {s.suspended ? 'Reactivate' : 'Suspend'}
              </button>
              {confirmDeleteId === s.id ? (
                <>
                  <button onClick={() => onDelete(s.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: RED, color: '#fff' }}>
                    Confirm delete
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-xs" style={{ color: '#8C7A4A' }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDeleteId(s.id)}>
                  <Trash2 size={16} color={RED} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloorPlanTab({ store, aisles, moveAisleLocal, saveAisleLayout, moveStorePointLocal, saveStorePoint }) {
  const canvasRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [resizeId, setResizeId] = useState(null);
  const [dragPoint, setDragPoint] = useState(null); // 'entrance' | 'checkout' | null
  const dragOffset = useRef({ x: 0, y: 0 });
  const CANVAS_W = 600;
  const MAX_Y = 4000; // generous ceiling — the canvas itself grows to fit content, this just stops runaway drags
  const GRID = 10;

  const entranceX = store.entrance_x ?? 300;
  const entranceY = store.entrance_y ?? 10;
  const checkoutX = store.checkout_x ?? 300;
  const checkoutY = store.checkout_y ?? 480;

  // Canvas height grows to fit whatever's actually placed on it, with
  // a sensible floor so it never looks empty for a small store.
  const contentHeight = Math.max(
    500,
    ...aisles.map((a) => (a.y ?? 20) + (a.h ?? 90)),
    checkoutY + 30,
    0
  ) + 60;

  const snap = (v) => Math.round(v / GRID) * GRID;

  const getPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left + canvasRef.current.scrollLeft, y: clientY - rect.top + canvasRef.current.scrollTop };
  };

  const startDrag = (e, aisle) => {
    e.stopPropagation();
    const p = getPoint(e);
    dragOffset.current = { x: p.x - aisle.x, y: p.y - aisle.y };
    setDragId(aisle.id);
  };

  const startResize = (e, aisle) => {
    e.stopPropagation();
    dragOffset.current = { x: aisle.w, y: aisle.h, startX: getPoint(e).x, startY: getPoint(e).y };
    setResizeId(aisle.id);
  };

  const startPointDrag = (e, which) => {
    e.stopPropagation();
    const p = getPoint(e);
    const cur = which === 'entrance' ? { x: entranceX, y: entranceY } : { x: checkoutX, y: checkoutY };
    dragOffset.current = { x: p.x - cur.x, y: p.y - cur.y };
    setDragPoint(which);
  };

  const onMove = (e) => {
    if (!dragId && !resizeId && !dragPoint) return;
    const p = getPoint(e);
    if (dragId) {
      const x = Math.max(0, Math.min(CANVAS_W - 60, snap(p.x - dragOffset.current.x)));
      const y = Math.max(0, Math.min(MAX_Y, snap(p.y - dragOffset.current.y)));
      moveAisleLocal(dragId, { x, y });
    }
    if (resizeId) {
      const dw = p.x - dragOffset.current.startX;
      const dh = p.y - dragOffset.current.startY;
      const w = Math.max(60, Math.min(CANVAS_W, snap(dragOffset.current.x + dw)));
      const h = Math.max(40, snap(dragOffset.current.y + dh));
      moveAisleLocal(resizeId, { w, h });
    }
    if (dragPoint) {
      const x = Math.max(0, Math.min(CANVAS_W, snap(p.x - dragOffset.current.x)));
      const y = Math.max(0, Math.min(MAX_Y, snap(p.y - dragOffset.current.y)));
      if (dragPoint === 'entrance') moveStorePointLocal({ entrance_x: x, entrance_y: y });
      else moveStorePointLocal({ checkout_x: x, checkout_y: y });
    }
  };

  const endDrag = () => {
    const id = dragId || resizeId;
    if (id) {
      const a = aisles.find((a) => a.id === id);
      if (a) saveAisleLayout(id, { x: a.x, y: a.y, w: a.w, h: a.h });
    }
    if (dragPoint === 'entrance') saveStorePoint({ entrance_x: store.entrance_x, entrance_y: store.entrance_y });
    if (dragPoint === 'checkout') saveStorePoint({ checkout_x: store.checkout_x, checkout_y: store.checkout_y });
    setDragId(null);
    setResizeId(null);
    setDragPoint(null);
  };

  return (
    <div className="max-w-3xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Floor Plan</h3>
      <p className="text-sm mb-4" style={{ color: '#8C7A4A' }}>
        Drag each aisle to match your real store layout. Drag the bottom-right corner to resize it. Drag the green
        (entrance) and orange (checkout) pins to wherever they actually sit — they don't have to be top and bottom.
        Scroll down inside the box below if your store has more aisles than fit on screen.
      </p>

      <div
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchMove={onMove}
        onTouchEnd={endDrag}
        className="relative rounded-lg select-none"
        style={{
          width: CANVAS_W, maxWidth: '100%', maxHeight: 600, overflowY: 'auto', overflowX: 'hidden',
          backgroundColor: '#fff', border: '1px solid #E5DDCB', touchAction: 'none',
        }}
      >
        <div
          className="relative"
          style={{
            width: CANVAS_W, height: contentHeight,
            backgroundImage: 'linear-gradient(#F1EBDA 1px, transparent 1px), linear-gradient(90deg, #F1EBDA 1px, transparent 1px)',
            backgroundSize: `${GRID * 2}px ${GRID * 2}px`,
          }}
        >
          {aisles.map((a) => (
            <div
              key={a.id}
              onMouseDown={(e) => startDrag(e, a)}
              onTouchStart={(e) => startDrag(e, a)}
              className="absolute rounded-md flex flex-col items-center justify-center cursor-move"
              style={{
                left: a.x ?? 20, top: a.y ?? 20, width: a.w ?? 170, height: a.h ?? 90,
                backgroundColor: '#FBEAD3', border: '2px solid #E2891F',
              }}
            >
              <span className="text-xs font-bold font-mono" style={{ color: '#5A3E14' }}>{a.number}</span>
              <span className="text-xs font-semibold text-center px-1" style={{ color: '#5A3E14' }}>{a.name}</span>
              <div
                onMouseDown={(e) => startResize(e, a)}
                onTouchStart={(e) => startResize(e, a)}
                className="absolute"
                style={{
                  right: -4, bottom: -4, width: 16, height: 16, borderRadius: 8,
                  backgroundColor: ORANGE, border: '2px solid #fff', cursor: 'nwse-resize',
                }}
              />
            </div>
          ))}

          <div
            onMouseDown={(e) => startPointDrag(e, 'entrance')}
            onTouchStart={(e) => startPointDrag(e, 'entrance')}
            className="absolute flex flex-col items-center cursor-move"
            style={{ left: entranceX - 30, top: entranceY - 10, width: 60 }}
          >
            <div style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: GREEN, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            <span className="text-xs font-bold mt-1" style={{ color: '#4C6B45' }}>ENTRANCE</span>
          </div>

          <div
            onMouseDown={(e) => startPointDrag(e, 'checkout')}
            onTouchStart={(e) => startPointDrag(e, 'checkout')}
            className="absolute flex flex-col items-center cursor-move"
            style={{ left: checkoutX - 30, top: checkoutY - 10, width: 60 }}
          >
            <div style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            <span className="text-xs font-bold mt-1" style={{ color: '#8C6A1F' }}>CHECKOUT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamTab({ teamMembers, addStaff, removeStaff }) {
  const [email, setEmail] = useState('');
  return (
    <div className="max-w-xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Team</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>
        Give other people at your store their own login to manage aisles, products, and deals — without sharing your account.
        They'll need to sign up for a NaviCart account with this exact email first.
      </p>

      <div className="space-y-2 mb-6">
        {teamMembers.length === 0 && (
          <p className="text-sm italic" style={{ color: '#B4A87F' }}>Just you for now.</p>
        )}
        {teamMembers.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ backgroundColor: PAPER }}>
            <Users size={15} color={ORANGE} />
            <span className="flex-1 text-sm font-semibold" style={{ color: INK }}>{m.email}</span>
            <button onClick={() => removeStaff(m.id)}>
              <Trash2 size={15} color={RED} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@email.com"
          className="flex-1 rounded-lg px-3 py-2.5 text-sm border outline-none"
          style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          onKeyDown={(e) => { if (e.key === 'Enter') { addStaff(email); setEmail(''); } }}
        />
        <button onClick={() => { addStaff(email); setEmail(''); }} className="rounded-lg px-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: ORANGE, color: BG }}>
          <Plus size={15} /> Add
        </button>
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

function RecipesTab({ recipes, addRecipe, deleteRecipe }) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const submit = () => {
    if (!title.trim() || !ingredients.trim()) return;
    addRecipe(title, description, ingredients, imageUrl);
    setTitle('');
    setDescription('');
    setIngredients('');
    setImageUrl('');
    setShowForm(false);
  };

  return (
    <div className="max-w-2xl">
      <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }} className="mb-1">Recipes</h3>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>
        Post a "deal of the week" recipe — shoppers can tap it in the app and add every ingredient to their list in one go.
      </p>

      <div className="space-y-3 mb-6">
        {recipes.length === 0 && !showForm && (
          <p className="text-sm italic" style={{ color: '#B4A87F' }}>No recipes yet — add your first one below.</p>
        )}
        {recipes.map((r) => {
          const ingredientCount = r.ingredients.split('\n').map((l) => l.trim()).filter(Boolean).length;
          return (
            <div key={r.id} className="rounded-lg p-4 flex gap-3" style={{ backgroundColor: PAPER }}>
              {r.image_url ? (
                <img src={r.image_url} alt={r.title} className="rounded-md object-cover flex-shrink-0" style={{ width: 64, height: 64 }} />
              ) : (
                <div className="rounded-md flex items-center justify-center flex-shrink-0" style={{ width: 64, height: 64, backgroundColor: '#FBEAD3' }}>
                  <ChefHat size={24} color={ORANGE} />
                </div>
              )}
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: INK }}>{r.title}</p>
                {r.description && <p className="text-xs mt-0.5" style={{ color: '#8C7A4A' }}>{r.description}</p>}
                <p className="text-xs mt-1 font-semibold" style={{ color: '#4C6B45' }}>{ingredientCount} ingredient{ingredientCount === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => deleteRecipe(r.id)} className="flex-shrink-0">
                <Trash2 size={15} color={RED} />
              </button>
            </div>
          );
        })}
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: ORANGE, color: BG }}>
          <Plus size={15} /> Add recipe
        </button>
      ) : (
        <div className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
          <label className="text-xs font-bold block mb-1" style={{ color: '#8C7A4A' }}>TITLE</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sunday Chili"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <label className="text-xs font-bold block mb-1" style={{ color: '#8C7A4A' }}>SHORT DESCRIPTION (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Ready in 40 minutes, feeds 6"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <label className="text-xs font-bold block mb-1" style={{ color: '#8C7A4A' }}>IMAGE URL (optional)</label>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <label className="text-xs font-bold block mb-1" style={{ color: '#8C7A4A' }}>INGREDIENTS — one per line</label>
          <textarea
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            rows={6}
            placeholder={'Ground beef\nKidney beans\nDiced tomatoes\nChili powder\nOnion'}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
            style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
          />
          <div className="flex gap-3">
            <button onClick={submit} className="rounded-lg px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: GREEN, color: BG }}>
              Save recipe
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm" style={{ color: '#8C7A4A' }}>Cancel</button>
          </div>
        </div>
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

function SmartImportPanel({ aisles, commitSmartImport, importState, setImportState }) {
  const { rawText, status, reviewItems, errorMsg, resultMsg } = importState;
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const knownCategories = Object.keys(CATEGORY_KEYWORDS);
  const categoryOptions = [...new Set([...aisles.map((a) => a.name), ...knownCategories])];
  const unsortedCount = reviewItems.filter((i) => !i.category).length;

  const runClassify = () => {
    if (!rawText.trim()) return;
    const existing = aisles.map((a) => a.name);
    const items = classifyOffline(existing, rawText);
    if (items.length === 0) {
      setImportState({ errorMsg: 'Nothing to sort — check the pasted text.' });
      return;
    }
    setImportState({ errorMsg: '', resultMsg: '', reviewItems: items, status: 'review' });
  };

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setImportState({ errorMsg: '' });
    try {
      const existing = aisles.map((a) => a.name);
      const { items, usedOwnCategories } = await parseSpreadsheetFile(file, existing);
      if (items.length === 0) {
        setImportState({ errorMsg: "Couldn't find any rows in that file — check it has a header row and at least one product." });
      } else {
        setImportState({
          errorMsg: '',
          reviewItems: items,
          status: 'review',
          resultMsg: usedOwnCategories
            ? "Used your file's own category column — most items are already sorted."
            : '',
        });
      }
    } catch (e) {
      setImportState({ errorMsg: "Couldn't read that file. Make sure it's a .csv, .xlsx, or .xls export." });
    }
    setUploading(false);
  };

  const updateReviewItem = (idx, patch) => {
    setImportState({ reviewItems: reviewItems.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  };
  const removeReviewItem = (idx) => {
    setImportState({ reviewItems: reviewItems.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    setImportState({ status: 'saving' });
    try {
      const result = await commitSmartImport(reviewItems);
      setImportState({
        resultMsg:
          `Saved ${result.productCount} product${result.productCount === 1 ? '' : 's'}` +
          (result.newAisleCount ? ` and created ${result.newAisleCount} new aisle${result.newAisleCount === 1 ? '' : 's'}.` : '.'),
        status: 'done',
        rawText: '',
        reviewItems: [],
      });
    } catch (e) {
      setImportState({ errorMsg: 'Saving failed — check your connection and try again.', status: 'review' });
    }
  };

  return (
    <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: '#2B3D2F' }}>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardPaste size={15} color={ORANGE} />
        <span style={{ color: ORANGE, fontSize: 11, fontWeight: 800, letterSpacing: 1.5 }}>SMART IMPORT</span>
      </div>
      <p className="text-xs mb-3" style={{ color: '#D9CBAE' }}>
        Upload your real inventory file — if it already has its own aisle, department, or category column, we use
        your exact naming instead of guessing. No category column? We'll sort it for you automatically.
      </p>

      {status === 'idle' && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg mb-3 flex flex-col items-center justify-center cursor-pointer"
            style={{
              border: `2px dashed ${dragOver ? ORANGE : '#5A6B5E'}`,
              backgroundColor: dragOver ? 'rgba(226,137,31,0.1)' : 'rgba(255,255,255,0.03)',
              padding: 28,
            }}
          >
            {uploading ? (
              <>
                <Loader2 size={22} className="animate-spin" color={ORANGE} />
                <span className="text-xs mt-2" style={{ color: '#D9CBAE' }}>Reading file…</span>
              </>
            ) : (
              <>
                <ClipboardPaste size={22} color={ORANGE} />
                <span className="text-sm font-bold mt-2" style={{ color: CREAM }}>Drop your spreadsheet here</span>
                <span className="text-xs mt-1" style={{ color: '#8C9C8F' }}>or click to choose a file — .csv, .xlsx, or .xls</span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />

          <p className="text-xs mb-2" style={{ color: '#8C9C8F' }}>— or paste it as plain text instead —</p>
          <textarea
            value={rawText}
            onChange={(e) => setImportState({ rawText: e.target.value })}
            rows={5}
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
          {resultMsg && (
            <p className="text-xs mb-2" style={{ color: '#B8E0A0' }}>{resultMsg}</p>
          )}
          {unsortedCount > 0 && (
            <p className="text-xs mb-2" style={{ color: '#F2C18D' }}>
              {unsortedCount} item{unsortedCount === 1 ? "wasn't" : "s weren't"} recognized — type or pick a category
              for {unsortedCount === 1 ? 'it' : 'them'} below before saving. Typing a brand new name creates that
              aisle automatically.
            </p>
          )}
          <datalist id="smart-import-categories">
            {categoryOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
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
                <input
                  list="smart-import-categories"
                  value={item.category || ''}
                  onChange={(e) => updateReviewItem(idx, { category: e.target.value })}
                  placeholder="Type or pick a category"
                  className="text-xs rounded px-2 py-1 border outline-none"
                  style={{ borderColor: item.category ? '#E5DDCB' : ORANGE, color: INK, backgroundColor: '#fff', width: 160 }}
                />
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
            <button onClick={() => setImportState({ status: 'idle', reviewItems: [], resultMsg: '', errorMsg: '' })} className="text-xs" style={{ color: '#D9CBAE' }}>
              Start over
            </button>
          </div>
          {errorMsg && <p className="text-xs mt-2" style={{ color: '#E8A67D' }}>{errorMsg}</p>}
        </>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-2">
          <p className="text-sm" style={{ color: '#B8E0A0' }}>{resultMsg}</p>
          <button onClick={() => setImportState({ status: 'idle' })} className="text-xs underline" style={{ color: '#D9CBAE' }}>Import more</button>
        </div>
      )}
    </div>
  );
}

function ProductsTab({ aisles, products, updateProduct, deleteProduct, addProduct, bulkImport, commitSmartImport, importState, setImportState }) {
  const [showManualImport, setShowManualImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const runImport = async () => {
    setImporting(true);
    const count = await bulkImport(importText);
    setImportMsg(count > 0 ? `Imported ${count} product${count === 1 ? '' : 's'}.` : 'Nothing to import — check the format.');
    setImportText('');
    setImporting(false);
  };

  const exportCsv = () => {
    const rows = [
      ['Name', 'Aisle Number', 'Price', 'Stock', 'Barcode'],
      ...products.map((p) => [p.label, p.aisle_number ?? '', p.price, p.stock, p.barcode || '']),
    ];
    downloadCsv(`catalog-export-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }}>Product catalog</h3>
        <button onClick={exportCsv} className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#4C6B45' }}>
          <Download size={13} /> Export as CSV
        </button>
      </div>
      <p className="text-sm mb-4" style={{ color: '#8C7A4A' }}>Each card below is a live shelf tag — edit it and shoppers see the change immediately.</p>

      <div className="rounded-lg p-3 mb-4 flex items-start gap-2" style={{ backgroundColor: PAPER }}>
        <ScanLine size={15} color="#8C7A4A" className="mt-0.5 flex-shrink-0" />
        <p className="text-xs" style={{ color: '#8C7A4A' }}>
          Already run a POS system (Square, IT Retail, Clover, etc.)? Export your inventory report and paste it into
          Smart Import below. Live, automatic POS sync is on our roadmap — starting with Square.
        </p>
      </div>

      <button onClick={() => setShowScanner(true)} className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: '#4C6B45' }}>
        <ScanLine size={15} /> Scan a barcode to update stock
      </button>
      {showScanner && (
        <BarcodeScannerModal
          products={products}
          updateProduct={updateProduct}
          onClose={() => setShowScanner(false)}
        />
      )}

      <SmartImportPanel aisles={aisles} commitSmartImport={commitSmartImport} importState={importState} setImportState={setImportState} />

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

function BarcodeScannerModal({ products, updateProduct, onClose }) {
  const videoRef = useRef(null);
  const [supported] = useState(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  const [manualCode, setManualCode] = useState('');
  const [matched, setMatched] = useState(null); // product or 'notfound' or null
  const [scannedCode, setScannedCode] = useState('');
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!supported) return;
    let stream;
    let stop = false;
    const detector = new window.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
    });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const scanLoop = async () => {
          if (stop || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              handleCode(codes[0].rawValue);
              return;
            }
          } catch (e) { /* keep trying */ }
          requestAnimationFrame(scanLoop);
        };
        scanLoop();
      } catch (e) {
        setCameraError('Could not access the camera. Check your browser permissions, or enter the barcode manually below.');
      }
    })();

    return () => {
      stop = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [supported]);

  function handleCode(code) {
    setScannedCode(code);
    const found = products.find((p) => p.barcode && p.barcode === code);
    setMatched(found || 'notfound');
  }

  const cycleStock = (product) => {
    const order = ['in', 'low', 'out'];
    const next = order[(order.indexOf(product.stock) + 1) % order.length];
    updateProduct(product.id, { stock: next });
    setMatched({ ...product, stock: next });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(30,43,34,0.85)' }}>
      <div className="rounded-xl p-5 w-full max-w-sm" style={{ backgroundColor: CREAM }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold" style={{ color: INK }}>Scan a barcode</span>
          <button onClick={onClose}><X size={18} color="#8C7A4A" /></button>
        </div>

        {supported && !cameraError && !matched && (
          <video ref={videoRef} className="w-full rounded-lg mb-3" style={{ backgroundColor: '#000', aspectRatio: '4/3' }} muted playsInline />
        )}

        {(!supported || cameraError) && !matched && (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: '#8C7A4A' }}>
              {cameraError || "Camera barcode scanning isn't supported in this browser — try Chrome on Android, or type the code below."}
            </p>
            <div className="flex gap-2">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Enter barcode digits"
                className="flex-1 rounded-lg px-3 py-2 text-sm border outline-none"
                style={{ borderColor: '#E5DDCB', color: INK, backgroundColor: '#fff' }}
                onKeyDown={(e) => e.key === 'Enter' && handleCode(manualCode.trim())}
              />
              <button onClick={() => handleCode(manualCode.trim())} className="rounded-lg px-3 text-sm font-bold" style={{ backgroundColor: ORANGE, color: BG }}>Go</button>
            </div>
          </div>
        )}

        {matched && matched !== 'notfound' && (
          <div className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
            <p className="text-sm font-bold mb-1" style={{ color: INK }}>{matched.label}</p>
            <p className="text-xs mb-3" style={{ color: '#8C7A4A' }}>Current stock: {STOCK_META[matched.stock].label}</p>
            <button onClick={() => cycleStock(matched)} className="rounded-lg px-4 py-2 text-sm font-bold" style={{ backgroundColor: GREEN, color: BG }}>
              Tap to cycle stock status
            </button>
            <button onClick={() => { setMatched(null); setScannedCode(''); }} className="block mt-3 text-xs" style={{ color: '#8C7A4A' }}>Scan another</button>
          </div>
        )}

        {matched === 'notfound' && (
          <div className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
            <p className="text-sm font-bold mb-1" style={{ color: INK }}>No product matches this barcode</p>
            <p className="text-xs mb-2 font-mono" style={{ color: '#8C7A4A' }}>{scannedCode}</p>
            <p className="text-xs mb-3" style={{ color: '#8C7A4A' }}>
              Add a new product below, then paste this code into its Barcode field.
            </p>
            <button onClick={() => { setMatched(null); setScannedCode(''); }} className="text-xs font-bold" style={{ color: '#4C6B45' }}>Scan another</button>
          </div>
        )}
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

      <div className="flex items-center justify-between mb-2">
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

      <div className="flex items-center gap-1">
        <ScanLine size={11} color="#B4A87F" />
        <input
          value={product.barcode || ''}
          onChange={(e) => updateProduct(product.id, { barcode: e.target.value })}
          placeholder="Barcode (optional)"
          className="text-xs bg-transparent outline-none flex-1 font-mono"
          style={{ color: '#8C7A4A' }}
        />
      </div>
    </div>
  );
}

function InsightsTab({ store, aisles, addProduct }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [events, setEvents] = useState([]);
  const [addedKeys, setAddedKeys] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const rows = await sb(`events?store_id=eq.${store.id}&select=*&order=created_at.desc&limit=2000`);
        if (!cancelled) { setEvents(rows || []); setStatus('ready'); }
      } catch (e) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [store.id]);

  const countBy = (arr, key) => {
    const map = {};
    arr.forEach((e) => { const k = e[key]; if (k == null) return; map[k] = (map[k] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const searches = events.filter((e) => e.type === 'search');
  const notFound = events.filter((e) => e.type === 'not_found');
  const aisleVisits = events.filter((e) => e.type === 'aisle_visit');

  const topSearched = countBy(searches, 'item_name').slice(0, 8);
  const topNotFound = countBy(notFound, 'item_name').slice(0, 8);
  const topAisles = countBy(aisleVisits, 'aisle_number').slice(0, 8);
  const aisleName = (num) => aisles.find((a) => String(a.number) === String(num))?.name || `Aisle ${num}`;

  const handleAdd = (name) => {
    addProduct(name, aisles[0]?.number ?? null, 0);
    setAddedKeys((prev) => [...prev, name]);
  };

  const exportInsightsCsv = () => {
    const rows = [
      ['Type', 'Item / Aisle', 'Count'],
      ...topSearched.map(([name, count]) => ['Top Searched', name, count]),
      ...topNotFound.map(([name, count]) => ["Don't Carry", name, count]),
      ...topAisles.map(([num, count]) => ['Aisle Traffic', `Aisle ${num} · ${aisleName(num)}`, count]),
    ];
    downloadCsv(`insights-export-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  if (status === 'loading') {
    return <div className="flex items-center gap-2 text-sm" style={{ color: '#8C7A4A' }}><Loader2 size={14} className="animate-spin" /> Loading usage data…</div>;
  }
  if (status === 'error') {
    return <p className="text-sm" style={{ color: RED }}>Could not load usage data. Try again.</p>;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-1">
        <h3 style={{ fontFamily: DISPLAY_FONT, letterSpacing: -0.5, color: INK, fontSize: 24, fontWeight: 700 }}>Insights</h3>
        {events.length > 0 && (
          <button onClick={exportInsightsCsv} className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#4C6B45' }}>
            <Download size={13} /> Export as CSV
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: '#8C7A4A' }}>
        Real usage from shoppers in the app — this fills in on its own as people shop, nothing to set up.
      </p>

      {events.length === 0 ? (
        <p className="text-sm italic" style={{ color: '#B4A87F' }}>
          No activity yet. Once shoppers start using the app for this store, real search and traffic data shows up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-8">
            <StatCard label="Searches" value={searches.length} />
            <StatCard label="Aisles visited" value={aisleVisits.length} />
            <StatCard label="Items you don't carry" value={new Set(notFound.map((e) => e.item_name)).size} />
          </div>

          <InsightSection icon={Search} label="TOP SEARCHED">
            {topSearched.length === 0 ? (
              <p className="text-xs italic" style={{ color: '#B4A87F' }}>No searches yet.</p>
            ) : (
              topSearched.map(([name, count]) => (
                <div key={name} className="flex items-center py-1.5">
                  <span className="flex-1 text-sm" style={{ color: INK }}>{name}</span>
                  <span className="text-xs font-bold" style={{ color: '#8C7A4A' }}>{count}×</span>
                </div>
              ))
            )}
          </InsightSection>

          <InsightSection icon={PackageX} label="SHOPPERS WANTED, YOU DON'T CARRY">
            {topNotFound.length === 0 ? (
              <p className="text-xs italic" style={{ color: '#B4A87F' }}>Nothing missing — nice.</p>
            ) : (
              topNotFound.map(([name, count]) => (
                <div key={name} className="flex items-center py-1.5">
                  <span className="flex-1 text-sm" style={{ color: INK }}>{name}</span>
                  <span className="text-xs font-bold mr-3" style={{ color: '#8C7A4A' }}>{count}×</span>
                  {addedKeys.includes(name) ? (
                    <span className="text-xs font-bold" style={{ color: GREEN }}>Added</span>
                  ) : (
                    <button onClick={() => handleAdd(name)} className="flex items-center gap-1 text-xs font-bold" style={{ color: '#4C6B45' }}>
                      <Plus size={13} /> Add to catalog
                    </button>
                  )}
                </div>
              ))
            )}
          </InsightSection>

          <InsightSection icon={MapPin} label="AISLE TRAFFIC">
            {topAisles.length === 0 ? (
              <p className="text-xs italic" style={{ color: '#B4A87F' }}>No routes built yet.</p>
            ) : (
              topAisles.map(([num, count]) => (
                <div key={num} className="flex items-center py-1.5">
                  <span className="flex-1 text-sm" style={{ color: INK }}>Aisle {num} · {aisleName(num)}</span>
                  <span className="text-xs font-bold" style={{ color: '#8C7A4A' }}>{count} visit{count === 1 ? '' : 's'}</span>
                </div>
              ))
            )}
          </InsightSection>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: PAPER }}>
      <div className="text-2xl font-bold font-mono" style={{ color: INK }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: '#8C7A4A' }}>{label}</div>
    </div>
  );
}

function InsightSection({ icon: Icon, label, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} color={ORANGE} />
        <span className="text-xs font-bold" style={{ color: '#8C7A4A', letterSpacing: 1 }}>{label}</span>
      </div>
      <div className="rounded-lg px-3" style={{ backgroundColor: '#fff', border: '1px solid #E5DDCB' }}>
        {children}
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
