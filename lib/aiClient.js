// ═════════════════════════════════════════════════════════════════════════
// lib/aiClient.js
// Wrapper mínimo sobre la API de Anthropic (https://api.anthropic.com/v1/messages)
// para que los comandos del owner puedan pedirle a Claude que genere contenido
// (por ahora: clases y razas del RPG). Requiere ANTHROPIC_API_KEY en el .env.
//
// No usa ningún SDK externo -- solo `fetch`, que ya viene incluido desde
// Node 18+ (la misma versión que ya necesita este bot para correr Baileys).
// ═════════════════════════════════════════════════════════════════════════

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Modelo por defecto: rápido y barato, de sobra para generar un objeto JSON
// chico como una clase o raza. Se puede sobreescribir con ANTHROPIC_MODEL.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/**
 * Llama a la API de Anthropic con un system prompt + un mensaje de usuario
 * y devuelve el texto de la respuesta (string).
 *
 * @param {Object} opts
 * @param {string} opts.system - Instrucciones de sistema (reglas de formato, etc).
 * @param {string} opts.prompt - Lo que le pedimos a la IA.
 * @param {number} [opts.maxTokens=1200]
 * @param {string} [opts.model]
 */
async function askClaude({ system, prompt, maxTokens = 1200, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "Falta ANTHROPIC_API_KEY en el .env del bot. Consigue una clave en https://console.anthropic.com/settings/keys y agrégala al .env."
    );
    err.code = "NO_API_KEY";
    throw err;
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (networkErr) {
    const err = new Error(`No se pudo conectar con la API de Anthropic: ${networkErr.message}`);
    err.code = "NETWORK_ERROR";
    throw err;
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    const err = new Error(`La API de Anthropic respondió ${res.status}: ${detail.slice(0, 300)}`);
    err.code = "API_ERROR";
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock || !textBlock.text) {
    throw new Error("La IA respondió sin contenido de texto.");
  }
  return textBlock.text;
}

/**
 * Extrae el primer objeto JSON válido de un texto (por si la IA lo envuelve
 * en ```json ... ``` o agrega alguna palabra antes/después pese a las
 * instrucciones del system prompt).
 */
function extractJson(text) {
  const cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("La IA no devolvió un JSON válido.");
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`La IA devolvió un JSON con errores de formato: ${e.message}`);
  }
}

module.exports = { askClaude, extractJson, DEFAULT_MODEL };
