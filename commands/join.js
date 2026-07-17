const { extractInviteCode, isOwnerOrCoOwner } = require("../lib/utils");

module.exports = async function cmdJoin(sock, msg, args, sender) {
  const from = msg.key.remoteJid;

  if (!isOwnerOrCoOwner(sender)) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner o un co-owner puede usar este comando." },
      { quoted: msg }
    );
  }

  const link = args[0];
  if (!link) {
    return sock.sendMessage(
      from,
      { text: `📌 Uso: .join <link de invitación>` },
      { quoted: msg }
    );
  }

  const code = extractInviteCode(link);
  if (!code) {
    return sock.sendMessage(
      from,
      { text: "❌ Ese no parece un link de invitación válido de WhatsApp." },
      { quoted: msg }
    );
  }

  try {
    const result = await sock.groupAcceptInvite(code);
    await sock.sendMessage(
      from,
      { text: `✅ Me uní al grupo correctamente (${result}).` },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(
      from,
      { text: `❌ No pude unirme al grupo: ${err.message}` },
      { quoted: msg }
    );
  }
};
