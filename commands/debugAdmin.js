// Comando temporal de diagnóstico: .debugadmin
// Te muestra el JID que usa el bot y la lista de admins del grupo, tal cual los ve WhatsApp.
// Puedes borrar este archivo (y su línea en index.js) una vez que .agg funcione bien.

module.exports = async function cmdDebugAdmin(sock, msg, isGroup) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const metadata = await sock.groupMetadata(from);
  const admins = metadata.participants.filter((p) => p.admin);

  const text =
    `🔎 *Diagnóstico*\n\n` +
    `Mi JID (sock.user.id): ${sock.user.id}\n` +
    `Mi LID (sock.user.lid): ${sock.user.lid || "no disponible"}\n\n` +
    `*Admins que ve WhatsApp en este grupo:*\n` +
    admins.map((a) => `- ${a.id} (${a.admin})`).join("\n");

  await sock.sendMessage(from, { text }, { quoted: msg });
};
