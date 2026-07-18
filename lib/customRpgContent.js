// ═════════════════════════════════════════════════════════════════════════
// lib/customRpgContent.js
// Guarda en data/*.json las razas y clases que el owner crea con la IA
// (.rpgcrearclase / .rpgcrearraza) y las refleja EN VIVO dentro de
// data.RACES / data.CLASSES (lib/rpgData.js) para que estén disponibles de
// inmediato, sin reiniciar el bot.
//
// require("./rpgData") se hace siempre DENTRO de las funciones (no al tope
// del archivo) a propósito: rpgData.js requiere este archivo para cargar lo
// ya guardado al arrancar, así que un require circular al tope rompería la
// carga. Haciéndolo perezoso, para cuando estas funciones se llaman de
// verdad (durante un comando) rpgData.js ya terminó de cargar tranquilo.
// ═════════════════════════════════════════════════════════════════════════

const { load, save } = require("./db");

const CLASSES_KEY = "customClasses";
const CLASS_META_KEY = "customClassMeta";
const RACES_KEY = "customRaces";

function getCustomClasses() {
  return load(CLASSES_KEY, {});
}
function getCustomClassMeta() {
  return load(CLASS_META_KEY, {});
}
function getCustomRaces() {
  return load(RACES_KEY, {});
}

function hasClassKey(slug) {
  const data = require("./rpgData");
  return Boolean(data.CLASSES[slug]);
}
function hasRaceKey(slug) {
  const data = require("./rpgData");
  return Boolean(data.RACES[slug]);
}

/**
 * Agrega un par inicial/avanzada a data.CLASSES (en vivo) y lo persiste.
 */
function addCustomClassPair(slug, inicial, avanzada, meta = {}) {
  const data = require("./rpgData");
  const advancedKey = `${slug}_asc`;

  const classes = getCustomClasses();
  classes[slug] = inicial;
  classes[advancedKey] = avanzada;
  save(CLASSES_KEY, classes);

  const metaAll = getCustomClassMeta();
  metaAll[slug] = { advancedKey, createdAt: new Date().toISOString(), ...meta };
  save(CLASS_META_KEY, metaAll);

  data.CLASSES[slug] = inicial;
  data.CLASSES[advancedKey] = avanzada;

  return { slug, advancedKey };
}

/**
 * Elimina un par inicial/avanzada creado por IA. Devuelve false si no existía.
 */
function removeCustomClassPair(slug) {
  const data = require("./rpgData");
  const metaAll = getCustomClassMeta();
  const entry = metaAll[slug];
  if (!entry) return false;

  const classes = getCustomClasses();
  delete classes[slug];
  delete classes[entry.advancedKey];
  save(CLASSES_KEY, classes);

  delete metaAll[slug];
  save(CLASS_META_KEY, metaAll);

  delete data.CLASSES[slug];
  delete data.CLASSES[entry.advancedKey];

  return true;
}

/**
 * Agrega una raza a data.RACES (en vivo) y la persiste.
 */
function addCustomRace(slug, raceObj) {
  const data = require("./rpgData");

  const races = getCustomRaces();
  races[slug] = raceObj;
  save(RACES_KEY, races);

  data.RACES[slug] = raceObj;

  return { slug };
}

/**
 * Elimina una raza creada por IA. Devuelve false si no existía.
 */
function removeCustomRace(slug) {
  const data = require("./rpgData");
  const races = getCustomRaces();
  if (!races[slug]) return false;

  delete races[slug];
  save(RACES_KEY, races);

  delete data.RACES[slug];

  return true;
}

module.exports = {
  getCustomClasses,
  getCustomClassMeta,
  getCustomRaces,
  hasClassKey,
  hasRaceKey,
  addCustomClassPair,
  removeCustomClassPair,
  addCustomRace,
  removeCustomRace,
};
