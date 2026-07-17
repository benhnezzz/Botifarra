const { getBaileys } = require("../lib/baileysEsm");
const { getSuggestionsGroup } = require("../lib/suggestionsConfig");
const { jidToNumber } = require("../lib/utils");

// .sug <mensaje> — manda una sugerencia al grupo configurado con .set_sug.
// La puede usar cualquiera, desde cualquier chat (privado o grupo).
// También funciona si se manda una imagen con .sug <mensaje> en el caption:
// en ese caso la imagen se reenvía también al grupo de sugerencias.
// Formato del mensaje que le llega al grupo de sugerencias:
//   @mención - <nombre> -> <sugerencia>
module.exports = async function cmdSug(sock, msg, args, sender) {
  const from = msg.key.remoteJid;

  const suggestion = args.join(" ").trim();
  const directImage = msg.message?.imageMessage;

  if (!suggestion && !directImage) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .sug <tu sugerencia> (podés adjuntar una imagen con el texto en el caption)" },
      { quoted: msg }
    );
  }

  const suggestionsGroup = getSuggestionsGroup();
  if (!suggestionsGroup) {
    return sock.sendMessage(
      from,
      { text: "⚠️ Todavía no hay un grupo de sugerencias configurado. Pide al owner que use .set_sug." },
      { quoted: msg }
    );
  }

  const senderTag = `@${jidToNumber(sender)}`;
  const name = msg.pushName || "Sin nombre";

  const text = `📩 *Nueva sugerencia*\n\n${senderTag} - ${name} -> ${suggestion || "(sin texto, ver imagen)"}`;

  try {
    if (directImage) {
      const { downloadMediaMessage } = await getBaileys();
      const mediaBuffer = await downloadMediaMessage(msg, "buffer", {});
      await sock.sendMessage(suggestionsGroup, {
        image: mediaBuffer,
        caption: text,
        mentions: [sender],
      });
    } else {
      await sock.sendMessage(suggestionsGroup, { text, mentions: [sender] });
    }
  } catch (err) {
    return sock.sendMessage(
      from,
      { text: `❌ No pude mandar la sugerencia (¿el bot sigue en ese grupo?): ${err.message}` },
      { quoted: msg }
    );
  }

  await sock.sendMessage(from, { text: "✅ ¡Gracias! Tu sugerencia fue enviada." }, { quoted: msg });
};
