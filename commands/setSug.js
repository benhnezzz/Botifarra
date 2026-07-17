const { setSuggestionsGroup } = require("../lib/suggestionsConfig");

// .set_sug <id del grupo> — define cuál grupo va a recibir las sugerencias
// mandadas con .sug. Solo el owner puede usarlo.
//
// Uso, igual que .block/.unblock:
//   .set_sug <id del grupo>   — se puede mandar desde cualquier chat (usa .libgp para ver los IDs)
//   .set_sug                 — si se manda DENTRO de un grupo, sin ID, usa ese grupo
module.exports = async function cmdSetSug(sock, msg, args, isGroup, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  let groupId = args[0] && args[0].endsWith("@g.us") ? args[0] : null;

  if (!groupId) {
    if (!isGroup) {
      return sock.sendMessage(
        from,
        {
          text:
            "📌 Uso: .set_sug <id del grupo>\n" +
            "Usa .libgp para ver los IDs de los grupos donde está el bot (igual que .block/.unblock).\n" +
            "O manda .set_sug directamente dentro del grupo que quieres usar para sugerencias.",
        },
        { quoted: msg }
      );
    }
    groupId = from;
  }

  let metadata;
  try {
    metadata = await sock.groupMetadata(groupId);
  } catch (err) {
    return sock.sendMessage(from, { text: `❌ No pude verificar ese grupo: ${err.message}` }, { quoted: msg });
  }

  setSuggestionsGroup(groupId);

  await sock.sendMessage(
    from,
    { text: `✅ Grupo de sugerencias configurado:\n*${metadata.subject}*\n${groupId}\n\nDesde ahora, todo lo que llegue con .sug se manda ahí.` },
    { quoted: msg }
  );
};
