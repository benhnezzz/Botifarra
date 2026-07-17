const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");

const TMP_DIR = path.join(__dirname, "..", "tmp");
const COOKIES_DIR = path.join(__dirname, "..", "data", "cookies");

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Busca un archivo de cookies para el sitio dado (instagram.txt, tiktok.txt, etc.)
// Se coloca manualmente en data/cookies/<sitio>.txt (formato Netscape, exportado del
// navegador con la extensión "Get cookies.txt LOCALLY" estando logueado en tu propia cuenta).
function getCookiesPath(site) {
  const filePath = path.join(COOKIES_DIR, `${site}.txt`);
  return fs.existsSync(filePath) ? filePath : null;
}

// Corre yt-dlp como proceso externo. Requiere tenerlo instalado en el sistema
// (ver README: `pip install -U yt-dlp` + `pkg install ffmpeg` en Termux).
function runYtDlp(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("La descarga tardó demasiado y se canceló (¿link muy largo o conexión lenta?)."));
    }, timeoutMs);

    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `No se pudo ejecutar yt-dlp (${err.message}). ¿Está instalado? Corre: pip install -U yt-dlp`
        )
      );
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const lastLine = stderr.trim().split("\n").filter(Boolean).pop();
        reject(new Error(lastLine || `yt-dlp terminó con código ${code}`));
      }
    });
  });
}

function isYouTubeUrl(url) {
  return /(youtube\.com|youtu\.be)/i.test(url);
}
function isTikTokUrl(url) {
  return /tiktok\.com/i.test(url);
}
function isInstagramUrl(url) {
  return /instagram\.com/i.test(url);
}
function isSoundCloudUrl(url) {
  return /soundcloud\.com/i.test(url);
}

const USAGE = {
  mp3: "📌 Uso: .mp3 <link de YouTube>",
  mp4: "📌 Uso: .mp4 <link de YouTube>",
  tik: "📌 Uso: .tik <link de TikTok>",
  ig: "📌 Uso: .ig <link de Instagram>",
  sc: "📌 Uso: .sc <link de SoundCloud>",
};

// Mensaje de ayuda específico para cuando Instagram rechaza la descarga por falta de sesión
const IG_AUTH_HELP =
  "⚠️ Instagram está pidiendo estar logueado para este contenido (pasa incluso con posts públicos últimamente).\n\n" +
  "Para arreglarlo, el owner del bot debe:\n" +
  "1. Instalar la extensión *Get cookies.txt LOCALLY* en Chrome/Firefox\n" +
  "2. Iniciar sesión en instagram.com con SU propia cuenta\n" +
  "3. Exportar las cookies de ese sitio con la extensión\n" +
  "4. Guardar ese archivo como: data/cookies/instagram.txt\n\n" +
  "Después de eso, .ig debería funcionar con posts que esa cuenta pueda ver normalmente.";

async function downloadAndSend(sock, msg, args, type) {
  const from = msg.key.remoteJid;
  const url = args[0];

  if (!url || !/^https?:\/\//i.test(url)) {
    return sock.sendMessage(from, { text: USAGE[type] }, { quoted: msg });
  }

  if ((type === "mp3" || type === "mp4") && !isYouTubeUrl(url)) {
    return sock.sendMessage(from, { text: "⚠️ Ese link no parece ser de YouTube." }, { quoted: msg });
  }
  if (type === "tik" && !isTikTokUrl(url)) {
    return sock.sendMessage(from, { text: "⚠️ Ese link no parece ser de TikTok." }, { quoted: msg });
  }
  if (type === "ig" && !isInstagramUrl(url)) {
    return sock.sendMessage(from, { text: "⚠️ Ese link no parece ser de Instagram." }, { quoted: msg });
  }
  if (type === "sc" && !isSoundCloudUrl(url)) {
    return sock.sendMessage(from, { text: "⚠️ Ese link no parece ser de SoundCloud." }, { quoted: msg });
  }

  ensureTmpDir();
  const id = crypto.randomBytes(6).toString("hex");
  const outputTemplate = path.join(TMP_DIR, `${id}.%(ext)s`);

  await sock.sendMessage(from, { text: "⏳ Descargando, dame un momento..." }, { quoted: msg });

  // Sitio para buscar cookies (mismo nombre que usamos para el archivo en data/cookies/)
  const cookieSiteMap = { ig: "instagram", tik: "tiktok", mp3: "youtube", mp4: "youtube", sc: "soundcloud" };
  const cookiesPath = getCookiesPath(cookieSiteMap[type]);
  const cookieArgs = cookiesPath ? ["--cookies", cookiesPath] : [];

  let ytArgs;
  if (type === "mp3" || type === "sc") {
    ytArgs = [...cookieArgs, "-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist", "-o", outputTemplate, url];
  } else if (type === "mp4") {
    ytArgs = [
      ...cookieArgs,
      "-f",
      "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=480][vcodec^=avc1]/best[ext=mp4][vcodec^=avc1]/best[height<=480]/best",
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "--postprocessor-args",
      "ffmpeg:-movflags +faststart",
      "--no-playlist",
      "-o",
      outputTemplate,
      url,
    ];
  } else {
    ytArgs = [
      ...cookieArgs,
      "-f",
      "best[ext=mp4]/best",
      "--remux-video",
      "mp4",
      "--postprocessor-args",
      "ffmpeg:-movflags +faststart",
      "--no-playlist",
      "-o",
      outputTemplate,
      url,
    ];
  }

  let filePath;
  try {
    await runYtDlp(ytArgs);

    const files = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(id));
    if (files.length === 0) {
      throw new Error("No se generó ningún archivo. Puede que el link sea privado, tenga edad restringida o ya no exista.");
    }
    filePath = path.join(TMP_DIR, files[0]);

    const stats = fs.statSync(filePath);
    const MAX_BYTES = 64 * 1024 * 1024;
    if (stats.size > MAX_BYTES) {
      fs.unlinkSync(filePath);
      return sock.sendMessage(
        from,
        { text: "⚠️ El archivo pesa más de 64MB, WhatsApp probablemente lo rechace. Prueba con un video más corto." },
        { quoted: msg }
      );
    }

    const buffer = fs.readFileSync(filePath);

    if (type === "mp3" || type === "sc") {
      await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mpeg", fileName: `${id}.mp3` }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { video: buffer, mimetype: "video/mp4" }, { quoted: msg });
    }
  } catch (err) {
    const isIgAuthError = type === "ig" && /empty media response|login|rate-limit|not available/i.test(err.message);

    if (isIgAuthError && !cookiesPath) {
      await sock.sendMessage(from, { text: IG_AUTH_HELP }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: `❌ No se pudo descargar: ${err.message}` }, { quoted: msg });
    }
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // no pasa nada si falla la limpieza
      }
    }
  }
}

module.exports = {
  cmdMp3: (sock, msg, args) => downloadAndSend(sock, msg, args, "mp3"),
  cmdMp4: (sock, msg, args) => downloadAndSend(sock, msg, args, "mp4"),
  cmdTik: (sock, msg, args) => downloadAndSend(sock, msg, args, "tik"),
  cmdIg: (sock, msg, args) => downloadAndSend(sock, msg, args, "ig"),
  cmdSc: (sock, msg, args) => downloadAndSend(sock, msg, args, "sc"),
};
