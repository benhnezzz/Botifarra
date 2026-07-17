const { load, save } = require("./db");

// data/economy.json — un objeto { [numero]: perfil }
const FILE = "economy";

function getAll() {
  return load(FILE, {});
}

function persist(all) {
  save(FILE, all);
}

// Perfil por defecto para un usuario nuevo
function defaultProfile() {
  return {
    wallet: 100, // arranca con un poco de plata para poder probar el bot
    bank: 0,
    xp: 0,
    name: null,
    cooldowns: {}, // { daily: ts, work: ts, crimen: ts, robar: ts, pescar: ts, minar: ts }
  };
}

/**
 * Trae el perfil de un usuario (por número, sin @). Lo crea si no existe.
 * Si se pasa displayName, lo actualiza (para los rankings).
 */
function getProfile(number, displayName) {
  const all = getAll();
  if (!all[number]) {
    all[number] = defaultProfile();
    persist(all);
  }
  if (displayName && all[number].name !== displayName) {
    all[number].name = displayName;
    persist(all);
  }
  // Por compatibilidad si el perfil viene de una versión vieja sin algún campo
  all[number].cooldowns = all[number].cooldowns || {};
  return all[number];
}

function saveProfile(number, profile) {
  const all = getAll();
  all[number] = profile;
  persist(all);
}

function addWallet(number, amount) {
  const p = getProfile(number);
  p.wallet = Math.max(0, p.wallet + amount);
  saveProfile(number, p);
  return p;
}

function addXp(number, amount) {
  const p = getProfile(number);
  p.xp = Math.max(0, p.xp + amount);
  saveProfile(number, p);
  return p;
}

// --- Cooldowns ---
// Devuelve null si ya puede usar el comando, o los ms restantes si no.
function checkCooldown(profile, key, ms) {
  const last = profile.cooldowns[key];
  if (!last) return null;
  const remaining = last + ms - Date.now();
  return remaining > 0 ? remaining : null;
}

function setCooldown(number, key) {
  const p = getProfile(number);
  p.cooldowns[key] = Date.now();
  saveProfile(number, p);
}

function formatCooldown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

// --- Dinero ---
function formatCoins(n) {
  return `🪙 ${Math.round(n).toLocaleString("es-CL")}`;
}

// --- Niveles ---
// Tabla de rangos por XP acumulada. El nivel de un usuario es el rango más
// alto cuyo xpRequired ya alcanzó.
const RANKS = [
  { level: 1, name: "Novato", xpRequired: 0 },
  { level: 2, name: "Aprendiz", xpRequired: 100 },
  { level: 3, name: "Curioso", xpRequired: 250 },
  { level: 4, name: "Trabajador", xpRequired: 500 },
  { level: 5, name: "Constante", xpRequired: 900 },
  { level: 6, name: "Experimentado", xpRequired: 1500 },
  { level: 7, name: "Veterano", xpRequired: 2300 },
  { level: 8, name: "Experto", xpRequired: 3400 },
  { level: 9, name: "Maestro", xpRequired: 4800 },
  { level: 10, name: "Gran Maestro", xpRequired: 6500 },
  { level: 11, name: "Élite", xpRequired: 8600 },
  { level: 12, name: "Campeón", xpRequired: 11000 },
  { level: 13, name: "Leyenda", xpRequired: 14000 },
  { level: 14, name: "Mítico", xpRequired: 17500 },
  { level: 15, name: "Inmortal", xpRequired: 21500 },
];

function getLevelInfo(xp) {
  let current = RANKS[0];
  let next = RANKS[1] || null;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].xpRequired) {
      current = RANKS[i];
      next = RANKS[i + 1] || null;
    }
  }
  const xpIntoLevel = xp - current.xpRequired;
  const xpForNext = next ? next.xpRequired - current.xpRequired : null;
  return {
    level: current.level,
    name: current.name,
    xp,
    xpIntoLevel,
    xpForNext,
    nextName: next ? next.name : null,
    isMax: !next,
  };
}

// --- Rankings (globales, entre todos los usuarios que hayan usado el bot) ---
function topByWallet(limit = 10) {
  const all = getAll();
  return Object.entries(all)
    .map(([number, p]) => ({ number, total: p.wallet + p.bank, name: p.name }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function topByXp(limit = 10) {
  const all = getAll();
  return Object.entries(all)
    .map(([number, p]) => ({ number, xp: p.xp, name: p.name }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

module.exports = {
  getProfile,
  saveProfile,
  addWallet,
  addXp,
  checkCooldown,
  setCooldown,
  formatCooldown,
  formatCoins,
  getLevelInfo,
  topByWallet,
  topByXp,
  RANKS,
};
