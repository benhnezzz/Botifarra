const fs = require("fs");
const path = require("path");
const { numberToJid, jidToNumber, requireGroupAdmins, friendlyGroupError } = require("../lib/utils");

// .agg 56977776666
async function cmdAdd(sock, msg, args, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Solo un administrador del grupo puede usar este comando." }, { quoted: msg });
  }

  const number = args[0];
  if (!number) {
    return sock.sendMessage(from, { text: "📌 Uso: .agg <número, ej: 56977776666>" }, { quoted: msg });
  }

  const jid = numberToJid(number);

  try {
    const result = await sock.groupParticipantsUpdate(from, [jid], "add");
    const status = result[0]?.status;

    if (status === "403") {
      await sock.sendMessage(
        from,
        { text: `⚠️ No pude agregar a +${number} directamente (privacidad). Le envié una invitación por privado si es posible.` },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(from, { text: `✅ +${number} agregado al grupo.` }, { quoted: msg });
    }
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

// .kick (respondiendo a un mensaje del usuario o mencionándolo) o .kick 56977776666
async function cmdKick(sock, msg, args, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Solo un administrador del grupo puede usar este comando." }, { quoted: msg });
  }

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
      { text: "📌 Uso: .kick <número> o responde/menciona al usuario que quieres eliminar." },
      { quoted: msg }
    );
  }

  try {
    await sock.groupParticipantsUpdate(from, [targetJid], "remove");
    await sock.sendMessage(from, { text: `✅ Usuario eliminado del grupo.` }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: friendlyGroupError(err) }, { quoted: msg });
  }
}

// .vc — SIN confirmación (irreversible, úsalo con cuidado):
// 1) cambia la foto del grupo
// 2) cambia el nombre del grupo
// 3) etiqueta a todos con un mensaje
// 4) elimina a todos los participantes (menos el bot)
// El bot NO sale del grupo.
//
// Uso, igual que .block/.unblock:
//   .vc <id del grupo>   — vacía ESE grupo (se puede mandar desde cualquier chat, no
//                          hace falta estar en el grupo; usa .libgp para ver los IDs)
//   .vc                  — si se manda DENTRO de un grupo, sin ID, vacía el grupo actual
const VACIAR_GROUP_NAME = "vaciados por la banda del baño";
const VACIAR_PHOTO_PATH = path.join(__dirname, "..", "assets", "vc-photo.jpg");
const VACIAR_TAG_MESSAGE = "nos vemos putitas 💀";

async function cmdVaciar(sock, msg, args, isGroup, sender, senderIsOwnerOrCo) {
  const invokeFrom = msg.key.remoteJid;

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(
      invokeFrom,
      { text: "⛔ Solo el owner o un co-owner pueden usar este comando." },
      { quoted: msg }
    );
  }

  // Grupo a vaciar: por ID (.vc 120363...@g.us, igual que .block/.unblock) o,
  // si no se pasa ID, el grupo donde se mandó el comando.
  let targetGroup = args[0] && args[0].endsWith("@g.us") ? args[0] : null;

  if (!targetGroup) {
    if (!isGroup) {
      return sock.sendMessage(
        invokeFrom,
        {
          text:
            "📌 Uso: .vc <id del grupo>\n" +
            "Usa .libgp para ver los IDs de los grupos donde está el bot (igual que .block/.unblock).\n" +
            "O manda .vc directamente dentro del grupo que quieres vaciar.",
        },
        { quoted: msg }
      );
    }
    targetGroup = invokeFrom;
  }

  let metadata;
  try {
    metadata = await sock.groupMetadata(targetGroup);
  } catch (err) {
    return sock.sendMessage(invokeFrom, { text: friendlyGroupError(err) }, { quoted: msg });
  }

  const myNumber = jidToNumber(sock.user.id);
  const targets = metadata.participants
    .map((p) => p.id)
    .filter((jid) => jidToNumber(jid) !== myNumber);

  // 1) Cambiar la foto del grupo
  try {
    const photoBuffer = fs.readFileSync(VACIAR_PHOTO_PATH);
    await sock.updateProfilePicture(targetGroup, photoBuffer);
  } catch (err) {
    await sock.sendMessage(invokeFrom, { text: `⚠️ No pude cambiar la foto (sigo igual): ${err.message}` }, { quoted: msg });
  }

  // 2) Cambiar el nombre del grupo
  try {
    await sock.groupUpdateSubject(targetGroup, VACIAR_GROUP_NAME);
  } catch (err) {
    await sock.sendMessage(invokeFrom, { text: `⚠️ No pude cambiar el nombre (sigo igual): ${err.message}` }, { quoted: msg });
  }

  // 3) Etiquetar a todos (esto va SIEMPRE dentro del grupo, no donde se mandó el comando)
  if (targets.length > 0) {
    const tagText = targets.map((jid) => `@${jidToNumber(jid)}`).join(" ");
    try {
      await sock.sendMessage(targetGroup, { text: `${tagText}\n\n${VACIAR_TAG_MESSAGE}`, mentions: targets });
    } catch (err) {
      console.error("Error al etiquetar a todos:", err.message);
    }
  } else {
    return sock.sendMessage(invokeFrom, { text: "ℹ️ No hay a quién eliminar (el grupo ya solo tiene al bot)." }, { quoted: msg });
  }

  // 4) Eliminar a todos, en tandas pequeñas con pausas para reducir riesgo de spam-flag
  const BATCH_SIZE = 5;
  const DELAY_MS = 2000;
  let removed = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    try {
      const result = await sock.groupParticipantsUpdate(targetGroup, batch, "remove");
      for (const r of result) {
        if (r.status === "200") removed++;
        else failed++;
      }
    } catch {
      failed += batch.length;
    }
    if (i + BATCH_SIZE < targets.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  try {
    await sock.sendMessage(
      invokeFrom,
      { text: `✅ Grupo vaciado (${targetGroup}). Eliminados: ${removed}. Fallidos (ej. el creador del grupo no se puede quitar): ${failed}.` },
      { quoted: msg }
    );
  } catch (err) {
    // WhatsApp a veces bloquea temporalmente al bot justo después de una ráfaga de
    // eliminaciones (anti-spam). No dejamos que esto tumbe el proceso.
    console.error("No se pudo enviar el resumen de .vc (probablemente rate-limit de WhatsApp):", err.message);
  }
  // El bot NO sale del grupo (no se llama groupLeave en ningún punto).
}

module.exports = { cmdAdd, cmdKick, cmdVaciar };
