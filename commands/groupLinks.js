const { requireGroupAdmins, friendlyGroupError, jidToNumber, jidNormalizedUser } = require("../lib/utils");
const { isGroupBlocked } = require("../lib/blockedGroups");

// .link — manda el link de invitación DEL GRUPO donde se escribe el comando.
// El bot necesita ser admin ahí (WhatsApp exige eso para sacar el link).
// Puede usarlo un admin del grupo, o el owner/co-owner desde cualquier lado.
async function cmdLink(sock, msg, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona dentro de un grupo." }, { quoted: msg });
  }

  const { senderIsAdmin, botIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin && !senderIsOwnerOrCo) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo un administrador del grupo, el owner o un co-owner pueden usar este comando." },
      { quoted: msg }
    );
  }
  if (!botIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Necesito ser administrador del grupo para sacar el link." }, { quoted: msg });
  }

  try {
    const code = await sock.groupInviteCode(from);
    const metadata = await sock.groupMetadata(from);
    await sock.sendMessage(
      from,
      { text: `🔗 *${metadata.subject}*\nhttps://chat.whatsapp.com/${code}` },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

// .linkall — manda al chat donde se escribe el comando el link de invitación
// de TODOS los grupos donde el bot es admin. Solo owner o co-owner: expone de
// una sola vez los links de todos los grupos, así que no es para cualquiera.
async function cmdLinkAll(sock, msg, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner o un co-owner pueden usar este comando." }, { quoted: msg });
  }

  let groups;
  try {
    groups = Object.values(await sock.groupFetchAllParticipating());
  } catch (err) {
    return sock.sendMessage(from, { text: `❌ No pude obtener los grupos: ${err.message}` }, { quoted: msg });
  }

  if (groups.length === 0) {
    return sock.sendMessage(from, { text: "El bot no está en ningún grupo todavía." }, { quoted: msg });
  }

  await sock.sendMessage(from, { text: `🔗 Sacando links de ${groups.length} grupo(s), dame un momento...` }, { quoted: msg });

  const lines = [];
  const skipped = [];

  for (const g of groups) {
    if (isGroupBlocked(g.id)) continue; // no exponemos link de grupos bloqueados

    const myId = jidNormalizedUser(sock.user.id);
    const myNumber = jidToNumber(myId);
    const myLid = sock.user.lid ? jidNormalizedUser(sock.user.lid) : null;

    const myParticipant = g.participants.find((p) => {
      const pId = jidNormalizedUser(p.id);
      if (pId === myId) return true;
      if (myLid && pId === myLid) return true;
      if (jidToNumber(pId) === myNumber) return true;
      return false;
    });
    const botIsAdminHere = !!myParticipant?.admin;

    if (!botIsAdminHere) {
      skipped.push(g.subject);
      continue;
    }

    try {
      const code = await sock.groupInviteCode(g.id);
      lines.push(`*${g.subject}*\nhttps://chat.whatsapp.com/${code}`);
    } catch (err) {
      skipped.push(`${g.subject} (error: ${err.message})`);
    }
  }

  const text =
    lines.length > 0
      ? `🔗 *Links de grupos donde soy admin (${lines.length})*\n\n${lines.join("\n\n")}`
      : "No soy admin en ningún grupo todavía, así que no pude sacar ningún link.";

  const skippedNote =
    skipped.length > 0 ? `\n\n⚠️ Sin link (no soy admin ahí, o falló): ${skipped.join(", ")}` : "";

  await sock.sendMessage(from, { text: text + skippedNote }, { quoted: msg });
}

module.exports = { cmdLink, cmdLinkAll };
