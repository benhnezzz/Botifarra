const { getBaileys } = require("../lib/baileysEsm");
const config = require("../config");
const { getQuotedMessage } = require("../lib/utils");
const { addStickerMetadata } = require("./sticker");

// .rs <nombre del paquete> | <nombre del autor>
// Toma un sticker (respondido) y lo reenvía con el nombre de paquete y autor
// que indique quien ejecuta el comando, reemplazando el exif original.
module.exports = async function cmdRs(sock, msg, args) {
  const from = msg.key.remoteJid;

  const quoted = getQuotedMessage(msg);
  const quotedSticker = quoted?.message?.stickerMessage;

  if (!quotedSticker) {
    return sock.sendMessage(
      from,
      {
        text:
          "📌 Responde a un sticker con .rs <nombre del paquete> | <nombre del autor>\n" +
          "Ejemplo: .rs Mi Pack | Yo",
      },
      { quoted: msg }
    );
  }

  const raw = args.join(" ");
  const [packNameRaw, authorRaw] = raw.split("|").map((s) => s?.trim());
  const packName = packNameRaw || config.DEFAULT_PACK_NAME;
  const author = authorRaw || config.DEFAULT_AUTHOR;

  await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

  try {
    const targetMsg = {
      key: {
        remoteJid: from,
        id: quoted.stanzaId,
        participant: quoted.participant,
      },
      message: quoted.message,
    };

    const { downloadMediaMessage } = await getBaileys();
    const webpBuffer = await downloadMediaMessage(targetMsg, "buffer", {});
    const finalBuffer = await addStickerMetadata(webpBuffer, packName, author);

    await sock.sendMessage(from, { sticker: finalBuffer }, { quoted: msg });
    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
    await sock.sendMessage(
      from,
      { text: `❌ No pude robar el sticker: ${err.message}` },
      { quoted: msg }
    );
  }
};
