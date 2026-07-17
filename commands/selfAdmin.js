const { friendlyGroupError } = require("../lib/utils");

module.exports = async function cmdSelfAdmin(sock, msg, isGroup, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner o un co-owner puede usar este comando." }, { quoted: msg });
  }

  try {
    await sock.groupParticipantsUpdate(from, [sender], "promote");
    await sock.sendMessage(from, { text: "✅ Listo, ahora eres admin." }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
};
