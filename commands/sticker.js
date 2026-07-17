const { getBaileys } = require("../lib/baileysEsm");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const webpmux = require("node-webpmux");
const config = require("../config");
const { getQuotedMessage } = require("../lib/utils");

const execFileAsync = promisify(execFile);

// Convierte un buffer de imagen/video a webp (estático o animado) usando ffmpeg
async function convertToWebp(inputBuffer, isVideo) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString("hex");
  const inputExt = isVideo ? "mp4" : "jpg";
  const inputPath = path.join(tmpDir, `wabot-in-${id}.${inputExt}`);
  const outputPath = path.join(tmpDir, `wabot-out-${id}.webp`);

  await fs.writeFile(inputPath, inputBuffer);

  const filter =
    "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000";

  const args = isVideo
    ? [
        "-y",
        "-i", inputPath,
        "-t", "6",
        "-vf", filter,
        "-loop", "0",
        "-vcodec", "libwebp",
        "-lossless", "0",
        "-q:v", "60",
        "-preset", "default",
        "-an",
        "-vsync", "0",
        outputPath,
      ]
    : [
        "-y",
        "-i", inputPath,
        "-vf", filter,
        "-vcodec", "libwebp",
        "-lossless", "0",
        "-q:v", "80",
        outputPath,
      ];

  try {
    await execFileAsync("ffmpeg", args);
    const outBuffer = await fs.readFile(outputPath);
    return outBuffer;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// Le agrega el nombre de paquete/autor al webp (metadata EXIF que WhatsApp lee)
async function addStickerMetadata(webpBuffer, packName, author) {
  const img = new webpmux.Image();
  await img.load(webpBuffer);

  const json = {
    "sticker-pack-id": `wabot-${Date.now()}`,
    "sticker-pack-name": packName,
    "sticker-pack-publisher": author,
    emojis: ["🤖"],
  };

  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifHeader, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  img.exif = exif;
  return img.save(null);
}

module.exports = async function cmdSticker(sock, msg, args) {
  return cmdStickerImpl(sock, msg, args);
};
module.exports.addStickerMetadata = addStickerMetadata;

async function cmdStickerImpl(sock, msg, args) {
  const from = msg.key.remoteJid;

  const quoted = getQuotedMessage(msg);
  const directImage = msg.message?.imageMessage;
  const directVideo = msg.message?.videoMessage;
  const quotedImage = quoted?.message?.imageMessage;
  const quotedVideo = quoted?.message?.videoMessage;

  const hasMedia = directImage || directVideo || quotedImage || quotedVideo;
  if (!hasMedia) {
    return sock.sendMessage(
      from,
      {
        text:
          "📌 Envía una imagen/video con .sticker en el caption, " +
          "o responde a una imagen/video con .sticker <nombre del paquete>",
      },
      { quoted: msg }
    );
  }

  const isVideo = !!(directVideo || quotedVideo);
  const usingQuoted = !!(quotedImage || quotedVideo);

  const targetMsg = usingQuoted
    ? {
        key: {
          remoteJid: from,
          id: quoted.stanzaId,
          participant: quoted.participant,
        },
        message: quoted.message,
      }
    : msg;

  // Reacciona con ⏳ al mensaje donde se pidió el sticker, mientras se procesa
  await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

  try {
    const { downloadMediaMessage } = await getBaileys();
    const mediaBuffer = await downloadMediaMessage(targetMsg, "buffer", {});
    const webpBuffer = await convertToWebp(mediaBuffer, isVideo);

    const packName = args.join(" ") || config.DEFAULT_PACK_NAME;
    const finalBuffer = await addStickerMetadata(
      webpBuffer,
      packName,
      config.DEFAULT_AUTHOR
    );

    await sock.sendMessage(from, { sticker: finalBuffer }, { quoted: msg });

    // Reacciona con ✅ una vez que el sticker fue enviado
    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    // Quita el ⏳ y avisa que falló
    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
    await sock.sendMessage(
      from,
      { text: `❌ No pude crear el sticker: ${err.message}` },
      { quoted: msg }
    );
  }
}
