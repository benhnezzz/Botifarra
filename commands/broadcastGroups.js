const { isBotAdmin } = require("../lib/utils");
const { isGroupBlocked } = require("../lib/blockedGroups");

const DELAY_MS = 1500; // pausa entre envíos para no parecer spam ante WhatsApp
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// .group <mensaje> — le manda ese mensaje a TODOS los grupos donde el bot es
// admin (los bloqueados con .block se saltan). El mensaje llega anónimo: lo
// manda el bot como si fuera suyo, sin decir quién lo pidió ni citar nada.
// Solo el owner o un co-owner pueden usarlo.
module.exports = async function cmdGroupBroadcast(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner o un co-owner pueden mandar mensajes a todos los grupos." },
      { quoted: msg }
    );
  }

  const text = args.join(" ").trim();
  if (!text) {
    return sock.sendMessage(from, { text: "📌 Uso: .group <mensaje>" }, { quoted: msg });
  }

  await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

  let groups;
  try {
    groups = Object.values(await sock.groupFetchAllParticipating());
  } catch (err) {
    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
    return sock.sendMessage(
      from,
      { text: `❌ No pude obtener la lista de grupos: ${err.message}` },
      { quoted: msg }
    );
  }

  const total = groups.length;
  let sent = 0;

  for (const group of groups) {
    if (isGroupBlocked(group.id)) continue;

    try {
      const admin = await isBotAdmin(sock, group.id);
      if (!admin) continue;

      // Mensaje "anónimo": se manda tal cual, sin quoted/mentions que lo
      // liguen a quien lo pidió ni a este chat de origen.
      await sock.sendMessage(group.id, { text });
      sent++;
    } catch {
      // Si falla en un grupo puntual, seguimos con el resto.
    }

    await sleep(DELAY_MS);
  }

  await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  await sock.sendMessage(
    from,
    { text: `✅ Mensaje enviado a ${sent}/${total} grupos (grupos en los que está el bot).` },
    { quoted: msg }
  );
};
