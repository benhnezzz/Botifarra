const { isGroupBlocked } = require("../lib/blockedGroups");

// .libgp — lista los IDs de todos los grupos donde está el bot, para poder
// copiar uno y usarlo con .block / .unblock
module.exports = async function cmdListGroups(sock, msg, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  try {
    const groups = await sock.groupFetchAllParticipating();
    const entries = Object.values(groups);

    if (entries.length === 0) {
      return sock.sendMessage(from, { text: "El bot no está en ningún grupo todavía." }, { quoted: msg });
    }

    const lines = entries.map((g) => {
      const blocked = isGroupBlocked(g.id) ? " 🚫 (bloqueado)" : "";
      return `*${g.subject}*${blocked}\n${g.id}`;
    });

    const text = `📋 *Grupos donde está el bot (${entries.length})*\n\n${lines.join("\n\n")}`;
    await sock.sendMessage(from, { text }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No pude obtener los grupos: ${err.message}` }, { quoted: msg });
  }
};
