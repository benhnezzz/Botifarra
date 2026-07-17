const { isOwnerOrCoOwner, isParticipantAdmin, friendlyGroupError } = require("../lib/utils");

async function canManage(sock, groupId, sender) {
  if (isOwnerOrCoOwner(sender)) return true;
  return isParticipantAdmin(sock, groupId, sender);
}

// .close — cierra el grupo (solo admins pueden mandar mensajes)
async function cmdClose(sock, msg, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const allowed = await canManage(sock, from, sender);
  if (!allowed) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner del bot o un admin del grupo puede usar este comando." },
      { quoted: msg }
    );
  }

  try {
    await sock.groupSettingUpdate(from, "announcement");
    await sock.sendMessage(from, { text: "🔒 Grupo cerrado. Solo los admins pueden escribir." }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

// .open — abre el grupo (todos pueden mandar mensajes)
async function cmdOpen(sock, msg, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const allowed = await canManage(sock, from, sender);
  if (!allowed) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner del bot o un admin del grupo puede usar este comando." },
      { quoted: msg }
    );
  }

  try {
    await sock.groupSettingUpdate(from, "not_announcement");
    await sock.sendMessage(from, { text: "🔓 Grupo abierto. Todos pueden escribir." }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

module.exports = { cmdOpen, cmdClose };
