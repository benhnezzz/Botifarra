const { blockGroup, unblockGroup, isGroupBlocked } = require("../lib/blockedGroups");

const BLOCKED_NOTICE =
  "🚫 *Grupo bloqueado*\n\n" +
  "Este grupo ha sido bloqueado y el bot dejará de responder aquí hasta nuevo aviso.\n\n" +
  "Si crees que se trata de un error o deseas resolver la situación, por favor contacta al owner del bot.";

const UNBLOCKED_NOTICE =
  "✅ *Grupo reactivado*\n\n" +
  "Este grupo ha sido reactivado. El bot ya vuelve a estar disponible con normalidad.";

// .block <id del grupo>   (el ID se obtiene con .libgp)
// Mientras un grupo está bloqueado, el bot ignora TODOS los mensajes de ahí,
// incluyendo comandos — ni siquiera responde. Por eso .block/.unblock se
// mandan desde otro chat (privado con el bot, u otro grupo), no desde el
// grupo que se quiere bloquear.
//
// Al bloquear/desbloquear, además de guardarlo en la base de datos, el bot
// manda UN aviso directo al grupo afectado (una sola vez, en el momento del
// cambio) — después de eso, si quedó bloqueado, vuelve a quedar en silencio.
async function cmdBlock(sock, msg, args, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const groupId = args[0];
  if (!groupId || !groupId.endsWith("@g.us")) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .block <id del grupo>\nUsa .libgp para ver los IDs de los grupos donde está el bot." },
      { quoted: msg }
    );
  }

  if (isGroupBlocked(groupId)) {
    return sock.sendMessage(from, { text: "ℹ️ Ese grupo ya estaba bloqueado." }, { quoted: msg });
  }

  blockGroup(groupId);

  let noticeSent = true;
  try {
    await sock.sendMessage(groupId, { text: BLOCKED_NOTICE });
  } catch (err) {
    noticeSent = false;
    console.error("No se pudo avisar al grupo bloqueado:", err.message);
  }

  await sock.sendMessage(
    from,
    {
      text:
        `🚫 Grupo bloqueado:\n${groupId}\n\n` +
        `El bot va a ignorar todos los mensajes ahí hasta que uses .unblock.\n` +
        (noticeSent ? "Se avisó al grupo." : "⚠️ No se pudo avisar al grupo (revisa si el bot sigue ahí)."),
    },
    { quoted: msg }
  );
}

// .unblock <id del grupo>
async function cmdUnblock(sock, msg, args, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const groupId = args[0];
  if (!groupId || !groupId.endsWith("@g.us")) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .unblock <id del grupo>" },
      { quoted: msg }
    );
  }

  if (!isGroupBlocked(groupId)) {
    return sock.sendMessage(from, { text: "ℹ️ Ese grupo no estaba bloqueado." }, { quoted: msg });
  }

  unblockGroup(groupId);

  let noticeSent = true;
  try {
    await sock.sendMessage(groupId, { text: UNBLOCKED_NOTICE });
  } catch (err) {
    noticeSent = false;
    console.error("No se pudo avisar al grupo desbloqueado:", err.message);
  }

  await sock.sendMessage(
    from,
    {
      text:
        `✅ Grupo desbloqueado:\n${groupId}\n\n` +
        (noticeSent ? "Se avisó al grupo." : "⚠️ No se pudo avisar al grupo (revisa si el bot sigue ahí)."),
    },
    { quoted: msg }
  );
}

module.exports = { cmdBlock, cmdUnblock };
