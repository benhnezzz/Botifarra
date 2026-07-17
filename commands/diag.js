const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { isBotAdmin } = require("../lib/utils");
const { getSuggestionsGroup } = require("../lib/suggestionsConfig");

const execFileAsync = promisify(execFile);

// ---------- Chequeos del entorno (cosas de las que dependen los comandos) ----------

async function checkBinary(bin, versionFlag = "--version") {
  try {
    await execFileAsync(bin, [versionFlag], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    if (err.code === "ENOENT") return { ok: false, reason: "no está instalado / no está en el PATH" };
    const firstLine = (err.message || "").split("\n").find((l) => l.trim()) || err.message;
    return { ok: false, reason: firstLine.slice(0, 200) };
  }
}

function checkModule(name) {
  try {
    require.resolve(name);
    return { ok: true };
  } catch {
    return { ok: false, reason: "no está en node_modules (falta correr npm install)" };
  }
}

function checkStorage() {
  try {
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const testFile = path.join(dataDir, ".diag-test");
    fs.writeFileSync(testFile, "ok");
    fs.readFileSync(testFile);
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function checkAuth() {
  const authDir = path.join(__dirname, "..", "auth_info");
  const exists = fs.existsSync(authDir);
  return { ok: exists, reason: exists ? null : "no existe la carpeta auth_info (¿nunca se vinculó?)" };
}

function checkConfigOwners() {
  const owners = config.OWNERS || [];
  if (owners.length === 0) return { ok: false, reason: "config.OWNERS está vacío" };
  const badOwner = owners.find((o) => !o.number);
  if (badOwner) return { ok: false, reason: "hay un owner en config.js sin 'number' definido" };
  return { ok: true, detail: `${owners.length} owner(s) configurado(s)` };
}

async function runEnvironmentChecks(sock) {
  const [ffmpeg, git, ytdlp] = await Promise.all([
    checkBinary("ffmpeg", "-version"),
    checkBinary("git"),
    checkBinary("yt-dlp"),
  ]);

  return {
    ffmpeg,
    git,
    ytdlp,
    webpmux: checkModule("node-webpmux"),
    jimp: checkModule("jimp"),
    baileys: checkModule("@whiskeysockets/baileys"),
    storage: checkStorage(),
    auth: checkAuth(),
    owners: checkConfigOwners(),
    connection: { ok: !!sock.user, detail: sock.user ? sock.user.id : null },
  };
}

// ---------- Catálogo de comandos: quién puede usarlos y de qué dependen ----------
// perm: "todos" | "admin" (admin del grupo) | "owner" (owner o co-owner según el comando)
// needsGroup: si solo funciona dentro de un grupo
// needsBotAdmin: si además necesita que EL BOT sea admin del grupo para funcionar
// deps: claves de runEnvironmentChecks() de las que depende
// note: aclaración extra que se muestra siempre
const CATALOG = [
  { cmd: ".join", perm: "owner", deps: [] },
  { cmd: ".sticker / .s", perm: "todos", deps: ["ffmpeg", "webpmux"] },
  { cmd: ".rs", perm: "todos", deps: ["webpmux"] },
  { cmd: ".pf", perm: "todos", deps: [] },
  { cmd: ".kiss / .hug / .pat", perm: "todos", deps: [], note: "usa la API pública nekos.best, necesita internet" },
  { cmd: ".agg / .add", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".kick / .del", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".open", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".close", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".vc", perm: "owner", needsBotAdmin: true, deps: [], note: "el admin se evalúa solo si lo corres dentro del grupo a vaciar; con ID remoto, revisa aparte" },
  { cmd: ".rob", perm: "owner", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".ping / .p", perm: "todos", deps: [] },
  { cmd: ".pull", perm: "todos", deps: [] },
  { cmd: ".stalker", perm: "todos", deps: [], note: "usa APIs públicas (agify/genderize/nationalize), necesita internet" },
  { cmd: ".mp3", perm: "todos", deps: ["ytdlp", "ffmpeg"] },
  { cmd: ".mp4", perm: "todos", deps: ["ytdlp", "ffmpeg"] },
  { cmd: ".tik", perm: "todos", deps: ["ytdlp", "ffmpeg"] },
  { cmd: ".ig", perm: "todos", deps: ["ytdlp", "ffmpeg"], note: "Instagram puede pedir cookies de sesión (ver README)" },
  { cmd: ".sc", perm: "todos", deps: ["ytdlp", "ffmpeg"] },
  { cmd: ".setpp", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".setname", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".setdesc", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".admin", perm: "owner", needsGroup: true, needsBotAdmin: false, deps: [], note: "el bot se auto-promueve al owner; no necesita ser admin antes" },
  { cmd: ".promote", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".demote", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".co", perm: "owner", deps: [] },
  { cmd: ".re", perm: "owner", deps: ["git"] },
  { cmd: ".lib", perm: "owner", deps: [] },
  { cmd: ".clear", perm: "todos", needsGroup: true, needsBotAdmin: true, deps: [] },
  { cmd: ".ban / .unban", perm: "owner", deps: [] },
  { cmd: ".set_sug", perm: "owner", deps: [] },
  { cmd: ".sug", perm: "todos", deps: [], dynamic: "sug", note: "si se manda con una imagen en el caption, esa imagen también se reenvía al grupo de sugerencias" },
  { cmd: ".block / .unblock", perm: "owner", deps: [] },
  { cmd: ".libgp", perm: "owner", deps: [] },
  { cmd: ".antilink", perm: "admin", needsGroup: true, deps: [] },
  { cmd: ".debugadmin", perm: "todos", needsGroup: true, deps: [] },
  { cmd: ".mute / .unmute", perm: "admin", needsGroup: true, needsBotAdmin: true, deps: [], note: "sin ser admin el mute igual queda guardado, pero no se borran los mensajes hasta que el bot sea admin" },
  { cmd: ".group", perm: "owner", deps: [], note: "manda un mensaje a todos los grupos donde el bot es admin; tarda ~1.5s por grupo" },
  { cmd: ".wa", perm: "todos", deps: [] },
  { cmd: ".owner", perm: "todos", deps: [] },
  { cmd: ".menu / .help", perm: "todos", deps: [] },
];

function evaluate(entry, env, isGroup, botIsAdminHere) {
  const problems = [];

  for (const depKey of entry.deps) {
    const check = env[depKey];
    if (check && !check.ok) problems.push(`falta ${depKey}: ${check.reason}`);
  }

  if (entry.needsGroup && !isGroup) {
    return { icon: "➖", text: "solo funciona en grupos (no evaluado en este chat)" };
  }

  if (entry.needsBotAdmin) {
    if (!isGroup) {
      problems.push("no evaluado (mándalo dentro de un grupo para revisar si soy admin ahí)");
    } else if (!botIsAdminHere) {
      problems.push("el bot no es admin en ESTE grupo");
    }
  }

  if (entry.dynamic === "sug" && !getSuggestionsGroup()) {
    problems.push("todavía no se configuró el grupo de sugerencias con .set_sug");
  }

  if (problems.length === 0) return { icon: "✅", text: "ok" };
  return { icon: "❌", text: problems.join("; ") };
}

// .diag — diagnóstico completo: entorno (binarios, módulos, storage, conexión) +
// estado de cada comando registrado. Solo el owner puede usarlo.
module.exports = async function cmdDiag(sock, msg, isGroup, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  await sock.sendMessage(
    from,
    { text: "╭───────────────────╮\n   🧉 *BOTIFARRA · DIAG*\n╰───────────────────╯\n\n🔎 Corriendo diagnóstico, dame un momento..." },
    { quoted: msg }
  );

  const env = await runEnvironmentChecks(sock);
  const botIsAdminHere = isGroup ? await isBotAdmin(sock, from).catch(() => false) : false;

  const line = (label, check) =>
    `│ ${check.ok ? "✅" : "❌"} ${label}${check.ok ? (check.detail ? `: ${check.detail}` : "") : `: ${check.reason}`}`;

  const envReport =
    `┌ 🔧 *ENTORNO*\n` +
    `${line("Conectado a WhatsApp", env.connection)}\n` +
    `${line("Carpeta auth_info", env.auth)}\n` +
    `${line("Owners en config.js", env.owners)}\n` +
    `${line("Lectura/escritura en data/", env.storage)}\n` +
    `${line("ffmpeg", env.ffmpeg)}\n` +
    `${line("git", env.git)}\n` +
    `${line("yt-dlp", env.ytdlp)}\n` +
    `${line("node-webpmux", env.webpmux)}\n` +
    `${line("jimp", env.jimp)}\n` +
    `${line("@whiskeysockets/baileys", env.baileys)}\n` +
    (isGroup
      ? `│ ${botIsAdminHere ? "✅" : "❌"} Soy admin en ESTE grupo\n`
      : `│ ➖ No estás en un grupo, no puedo revisar si soy admin en ninguno ahora mismo.\n`) +
    `└─────────────`;

  await sock.sendMessage(from, { text: envReport });

  const results = CATALOG.map((entry) => {
    const evalResult = evaluate(entry, env, isGroup, botIsAdminHere);
    const permTag = entry.perm === "owner" ? "👑" : entry.perm === "admin" ? "👮" : "👤";
    let lineText = `│ ${evalResult.icon} ${permTag} *${entry.cmd}* — ${evalResult.text}`;
    if (entry.note) lineText += `\n│    ℹ️ ${entry.note}`;
    return lineText;
  });

  const commandsReport =
    `┌ 📋 *ESTADO DE CADA COMANDO*\n` +
    `│ _👑 owner · 👮 admin del grupo · 👤 cualquiera_\n│\n` +
    `${results.join("\n")}\n` +
    `└─────────────\n\n` +
    `_🧉 Botifarra Bot — diagnóstico finalizado_`;

  await sock.sendMessage(from, { text: commandsReport });
};
