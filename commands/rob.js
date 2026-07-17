const fs = require("fs");
const path = require("path");
const { jidToNumber, isOwner, requireGroupAdmins, friendlyGroupError, jidNormalizedUser } = require("../lib/utils");

// .rob — broma de grupo:
// 1) quita admin a todos los admins actuales (menos el bot)
// 2) le da admin al owner (si está en el grupo)
// 3) cambia el nombre del grupo
// 4) cambia la foto del grupo
const ROB_GROUP_NAME = "troleados por la banda del baño";
const ROB_PHOTO_PATH = path.join(__dirname, "..", "assets", "rob-photo.jpg");

module.exports = async function cmdRob(sock, msg, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner o un co-owner pueden usar este comando." },
      { quoted: msg }
    );
  }

  const { botIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!botIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Necesito ser administrador del grupo para hacer esto." }, { quoted: msg });
  }

  let metadata;
  try {
    metadata = await sock.groupMetadata(from);
  } catch (err) {
    return sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }

  const myId = jidNormalizedUser(sock.user.id);
  const myNumber = jidToNumber(myId);
  const myLid = sock.user.lid ? jidNormalizedUser(sock.user.lid) : null;

  const isBot = (jid) => {
    const pId = jidNormalizedUser(jid);
    if (pId === myId) return true;
    if (myLid && pId === myLid) return true;
    if (jidToNumber(pId) === myNumber) return true;
    return false;
  };

  // 1) Quitar admin a todos los admins actuales (menos el bot)
  const currentAdmins = metadata.participants
    .filter((p) => p.admin && !isBot(p.id))
    .map((p) => p.id);

  if (currentAdmins.length > 0) {
    try {
      await sock.groupParticipantsUpdate(from, currentAdmins, "demote");
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ No pude quitar algunos admins: ${err.message}` }, { quoted: msg });
    }
  }

  // 2) Darle admin al owner (si está en el grupo)
  const ownerInGroup = metadata.participants
    .map((p) => p.id)
    .filter((jid) => isOwner(jid));

  if (ownerInGroup.length > 0) {
    try {
      await sock.groupParticipantsUpdate(from, ownerInGroup, "promote");
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ No pude darle admin al owner: ${err.message}` }, { quoted: msg });
    }
  }

  // 3) Cambiar el nombre del grupo
  try {
    await sock.groupUpdateSubject(from, ROB_GROUP_NAME);
  } catch (err) {
    await sock.sendMessage(from, { text: `⚠️ No pude cambiar el nombre: ${err.message}` }, { quoted: msg });
  }

  // 4) Cambiar la foto del grupo
  try {
    const photoBuffer = fs.readFileSync(ROB_PHOTO_PATH);
    await sock.updateProfilePicture(from, photoBuffer);
  } catch (err) {
    await sock.sendMessage(from, { text: `⚠️ No pude cambiar la foto: ${err.message}` }, { quoted: msg });
  }

  await sock.sendMessage(from, { text: "🏛️ Ha caído el imperio. Nuevo régimen instaurado." }, { quoted: msg });
};
