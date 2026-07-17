const { numberToJid, requireGroupAdmins, friendlyGroupError } = require("../lib/utils");

// .promote (mencionando, respondiendo, o con número) -> da admin a otra persona
// Requiere que quien use el comando Y el bot sean admins del grupo.
// El aviso menciona TANTO a quien dio el admin (quien mandó el comando) COMO a quien lo recibió.
async function cmdPromote(sock, msg, args, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Solo un administrador del grupo puede usar este comando." }, { quoted: msg });
  }

  // Prioridad: mención > respuesta citada > número en el argumento
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

  let targetJid;
  if (mentioned && mentioned.length > 0) {
    targetJid = mentioned[0];
  } else if (quotedParticipant) {
    targetJid = quotedParticipant;
  } else if (args[0]) {
    targetJid = numberToJid(args[0]);
  }

  if (!targetJid) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .promote <número> o responde/menciona al usuario que quieres hacer admin." },
      { quoted: msg }
    );
  }

  try {
    await sock.groupParticipantsUpdate(from, [targetJid], "promote");
    await sock.sendMessage(
      from,
      {
        text: `👑 @${sender.split("@")[0]} le dio admin a @${targetJid.split("@")[0]}`,
        mentions: [sender, targetJid],
      },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

module.exports = cmdPromote;
