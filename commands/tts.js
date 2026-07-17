const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const { getVoiceId, getDefaultVoiceId, listVoices } = require("../lib/ttsVoices");

const TMP_DIR = path.join(__dirname, "..", "tmp");

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Convierte el mp3 que devuelve Edge a ogg/opus (formato que WhatsApp usa
// para notas de voz con la forma de ondita, en vez de mostrarse como un
// archivo de audio suelto).
function convertToOpus(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vn",
      "-c:a", "libopus",
      "-b:a", "64k",
      "-ar", "48000",
      "-ac", "1",
      outputPath,
    ]);

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => {
      reject(new Error(`No se pudo ejecutar ffmpeg (${err.message}). ¿Está instalado?`));
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").pop() || `ffmpeg terminó con código ${code}`));
    });
  });
}

// Pide el audio a Edge (voces neuronales de Microsoft) y lo guarda como mp3.
async function synthesize(text, voiceId, outputPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(outputPath);
    audioStream.pipe(fileStream);
    audioStream.on("error", reject);
    fileStream.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

// .tts <texto>            -> voz por defecto
// .tts -juanito <texto>   -> usa el alias "juanito" (definido con .setvoz)
async function cmdTts(sock, msg, args) {
  const from = msg.key.remoteJid;

  if (args.length === 0) {
    return sock.sendMessage(
      from,
      {
        text:
          `⚠️ *Uso:* .tts <texto>\n` +
          `O con una voz configurada: .tts -alias <texto>\n\n` +
          `Voces disponibles: ${Object.keys(listVoices()).join(", ")}`,
      },
      { quoted: msg }
    );
  }

  let voiceId = getDefaultVoiceId();
  let text = args.join(" ");

  if (args[0].startsWith("-")) {
    const alias = args[0].slice(1);
    const found = getVoiceId(alias);
    if (!found) {
      return sock.sendMessage(
        from,
        {
          text:
            `⚠️ No conozco la voz "-${alias}".\n` +
            `Voces disponibles: ${Object.keys(listVoices()).join(", ")}`,
        },
        { quoted: msg }
      );
    }
    voiceId = found;
    text = args.slice(1).join(" ").trim();
  }

  if (!text) {
    return sock.sendMessage(from, { text: "⚠️ Falta el texto a convertir en voz." }, { quoted: msg });
  }

  if (text.length > 800) {
    return sock.sendMessage(
      from,
      { text: "⚠️ Ese texto es muy largo (máximo 800 caracteres) para no saturar el bot." },
      { quoted: msg }
    );
  }

  ensureTmpDir();
  const id = crypto.randomBytes(6).toString("hex");
  const mp3Path = path.join(TMP_DIR, `tts_${id}.mp3`);
  const oggPath = path.join(TMP_DIR, `tts_${id}.ogg`);

  try {
    await synthesize(text, voiceId, mp3Path);
    await convertToOpus(mp3Path, oggPath);

    const buffer = fs.readFileSync(oggPath);
    await sock.sendMessage(
      from,
      { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: true },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No se pudo generar el audio: ${err.message}` }, { quoted: msg });
  } finally {
    fs.promises.unlink(mp3Path).catch(() => {});
    fs.promises.unlink(oggPath).catch(() => {});
  }
}

module.exports = cmdTts;
