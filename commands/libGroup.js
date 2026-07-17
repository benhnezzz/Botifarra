const { isGroupBlocked } = require("../lib/blockedGroups");

// .libg — muestra el ID (@g.us) del grupo DONDE se manda el comando.
// Es un atajo de .libgp para no tener que buscarlo en la lista completa de
// todos los grupos. Solo el owner puede usarlo.
module.exports = async function cmdLibG(sock, msg, isGroup, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona dentro de un grupo." }, { quoted: msg });
  }

  try {
    const metadata = await sock.groupMetadata(from);
    const blocked = isGroupBlocked(from) ? " 🚫 (bloqueado)" : "";
    await sock.sendMessage(from, { text: `📋 *${metadata.subject}*${blocked}\n${from}` }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No pude obtener los datos del grupo: ${err.message}` }, { quoted: msg });
  }
};
