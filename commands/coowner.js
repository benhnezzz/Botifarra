const { getCoOwners, addCoOwner, removeCoOwner } = require("../lib/coowners");
const { jidToNumber, resolveCoOwnerIdentifiers } = require("../lib/utils");

// .co <número>              -> agrega co-owner
// .co (respondiendo/mencionando a alguien) -> agrega co-owner
// .co del <número>          -> quita co-owner
// .co list                    -> lista los co-owners actuales
//
// Sin importar si se usó @mención o se escribió el número a mano, el bot
// intenta guardar AMBOS identificadores (número real y @lid) de la persona,
// para reconocerla como co-owner sin importar cuál de los dos use WhatsApp.
module.exports = async function cmdCoOwner(sock, msg, args, senderIsOwner, isGroup) {
  const from = msg.key.remoteJid;
  const groupId = isGroup ? from : null;

  // Solo el owner original (el del config.js) puede dar o quitar co-owners.
  // Un co-owner NO puede agregar a otro co-owner.
  if (!senderIsOwner) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo el owner puede administrar co-owners." },
      { quoted: msg }
    );
  }

  const sub = args[0];

  // Mención o respuesta a un mensaje: captura el identificador REAL que usa WhatsApp
  // (puede ser un número de teléfono normal o un ID @lid).
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const mentionTarget =
    sub !== "list" && sub !== "del"
      ? (mentioned && mentioned.length > 0 ? mentioned[0] : quotedParticipant)
      : null;

  if (mentionTarget) {
    const { number, lid } = await resolveCoOwnerIdentifiers(sock, mentionTarget, groupId);
    console.log("[.co debug] mentionTarget:", mentionTarget, "-> number:", number, "lid:", lid);

    if (!number && !lid) {
      return sock.sendMessage(
        from,
        {
          text:
            "❌ No pude identificar a esa persona (formato de JID no reconocido). " +
            "Prueba respondiendo directamente a un mensaje suyo, o usa .co <número>.",
        },
        { quoted: msg }
      );
    }

    addCoOwner(number, lid);
    const label = number ? `+${number}` : `@${jidToNumber(mentionTarget)}`;
    return sock.sendMessage(
      from,
      {
        text:
          `✅ ${label} ahora es co-owner del bot y puede usar los comandos de moderación.` +
          (number && lid ? `\n(Guardado con número y @lid, para que el bot lo reconozca siempre.)` : ""),
        mentions: [mentionTarget],
      },
      { quoted: msg }
    );
  }

  if (!sub) {
    return sock.sendMessage(
      from,
      {
        text:
          "📌 Uso:\n" +
          ".co <número> — agregar co-owner\n" +
          ".co (respondiendo/mencionando a alguien) — agregar co-owner\n" +
          ".co del <número> — quitar co-owner\n" +
          ".co list — ver co-owners actuales",
      },
      { quoted: msg }
    );
  }

  if (sub === "list") {
    const list = getCoOwners();
    const text = list.length
      ? `👥 Co-owners actuales:\n${list
          .map((o) => `+${o.number || "?"}${(o.lids || []).length ? ` (lid: ${o.lids.join(", ")})` : ""}`)
          .join("\n")}`
      : "No hay co-owners agregados todavía.";
    return sock.sendMessage(from, { text }, { quoted: msg });
  }

  if (sub === "del") {
    const number = args[1]?.replace(/[^0-9]/g, "");
    if (!number) {
      return sock.sendMessage(from, { text: "📌 Uso: .co del <número>" }, { quoted: msg });
    }
    removeCoOwner(number);
    return sock.sendMessage(from, { text: `✅ +${number} ya no es co-owner.` }, { quoted: msg });
  }

  // Caso normal: .co <número>
  const number = sub.replace(/[^0-9]/g, "");
  if (!number) {
    return sock.sendMessage(from, { text: "📌 Uso: .co <número, ej: 56977776666>" }, { quoted: msg });
  }

  const { lid } = await resolveCoOwnerIdentifiers(sock, number, groupId);
  console.log("[.co debug] number:", number, "-> lid:", lid);
  addCoOwner(number, lid);
  await sock.sendMessage(
    from,
    {
      text:
        `✅ +${number} ahora es co-owner del bot y puede usar los comandos de moderación.` +
        (lid
          ? `\n(También se guardó su @lid, para que el bot lo reconozca aunque WhatsApp use ese ID en vez del número.)`
          : `\n\n⚠️ No se pudo encontrar su @lid todavía (por ejemplo, si esto no se ejecutó dentro de un grupo donde esa persona está). Si el bot no la reconoce, usa ".co" respondiendo directamente a un mensaje suyo.`),
    },
    { quoted: msg }
  );
};
