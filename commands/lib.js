const { jidToNumber } = require("../lib/utils");

// .lib @mención — muestra el JID/LID real de la(s) persona(s) mencionadas.
// Solo lo puede usar el owner. Solo funciona mencionando (no acepta número
// ni respuesta a mensaje, a propósito).
module.exports = async function cmdLib(sock, msg, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

  if (mentioned.length === 0) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .lib @mención\nMenciona a la persona de la que quieres sacar el LID/JID." },
      { quoted: msg }
    );
  }

  const lines = mentioned.map((jid) => `• @${jidToNumber(jid)} → ${jid}`);

  await sock.sendMessage(
    from,
    { text: `🔎 *LID/JID de los mencionados:*\n\n${lines.join("\n")}`, mentions: mentioned },
    { quoted: msg }
  );
};
