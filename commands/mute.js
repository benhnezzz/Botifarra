const { numberToJid, jidToNumber, requireGroupAdmins, isOwner } = require("../lib/utils");
const { muteUser, unmuteUser, isMuted, remainingMs } = require("../lib/mutes");

const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
const UNIT_LABEL = { s: "segundo(s)", m: "minuto(s)", h: "hora(s)", d: "día(s)" };
const DURATION_RE = /^(\d+)([smhd])$/i;

function parseDuration(raw) {
  const m = raw?.match(DURATION_RE);
  if (!m) return null;
  const amount = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  return { ms: amount * UNIT_MS[unit], label: `${amount} ${UNIT_LABEL[unit]}` };
}

function formatRemaining(ms) {
  if (ms >= UNIT_MS.d) return `${Math.ceil(ms / UNIT_MS.d)} día(s)`;
  if (ms >= UNIT_MS.h) return `${Math.ceil(ms / UNIT_MS.h)} hora(s)`;
  if (ms >= UNIT_MS.m) return `${Math.ceil(ms / UNIT_MS.m)} minuto(s)`;
  return `${Math.ceil(ms / UNIT_MS.s)} segundo(s)`;
}

// Saca el target (mención > respuesta > número) y la duración (el primer arg
// que tenga forma de duración, sin importar en qué posición esté) de una.
function extractTargetAndDuration(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

  let targetJid = null;
  if (mentioned && mentioned.length > 0) targetJid = mentioned[0];
  else if (quotedParticipant) targetJid = quotedParticipant;

  let duration = null;
  for (const arg of args) {
    const parsed = parseDuration(arg);
    if (parsed) {
      duration = parsed;
      continue;
    }
    // Si no hay mención/respuesta, el primer arg que no sea una duración y
    // parezca número lo tomamos como el número del target.
    if (!targetJid && /^\+?\d{6,}$/.test(arg)) {
      targetJid = numberToJid(arg);
    }
  }

  return { targetJid, duration };
}

// .mute @mención|número xS/xM/xH/xD — le borra los mensajes a esa persona en
// este grupo durante ese tiempo. Necesita que el BOT sea admin para poder
// borrar; sin eso, el mute queda guardado pero no se hace cumplir.
async function cmdMute(sock, msg, args, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin, botIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin && !senderIsOwnerOrCo) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo un administrador del grupo, el owner o un co-owner pueden usar este comando." },
      { quoted: msg }
    );
  }

  const { targetJid, duration } = extractTargetAndDuration(msg, args);

  if (!targetJid || !duration) {
    return sock.sendMessage(
      from,
      {
        text:
          "📌 Uso: .mute <mención/número/respuesta> <tiempo>\n" +
          "Tiempo: número + s/m/h/d (ej: 30s, 10m, 2h, 1d)\n" +
          "Ejemplo: .mute @Juan 10m",
      },
      { quoted: msg }
    );
  }

  if (isOwner(targetJid)) {
    return sock.sendMessage(from, { text: "⛔ No se puede mutear al owner." }, { quoted: msg });
  }

  muteUser(from, targetJid, duration.ms);

  const warning = botIsAdmin
    ? ""
    : "\n\n⚠️ Ojo: no soy admin en este grupo todavía, así que por ahora NO voy a poder borrarle los mensajes. Hazme admin para que el mute se cumpla de verdad.";

  await sock.sendMessage(
    from,
    {
      text: `🔇 @${jidToNumber(targetJid)} quedó muteado por ${duration.label}.${warning}`,
      mentions: [targetJid],
    },
    { quoted: msg }
  );
}

// .unmute @mención|número|respuesta — saca el mute antes de tiempo
async function cmdUnmute(sock, msg, args, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin && !senderIsOwnerOrCo) {
    return sock.sendMessage(
      from,
      { text: "⛔ Solo un administrador del grupo, el owner o un co-owner pueden usar este comando." },
      { quoted: msg }
    );
  }

  const { targetJid } = extractTargetAndDuration(msg, args);
  if (!targetJid) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .unmute <mención/número/respuesta>" },
      { quoted: msg }
    );
  }

  if (!isMuted(from, targetJid)) {
    return sock.sendMessage(
      from,
      { text: `@${jidToNumber(targetJid)} no estaba muteado.`, mentions: [targetJid] },
      { quoted: msg }
    );
  }

  unmuteUser(from, targetJid);
  await sock.sendMessage(
    from,
    { text: `🔊 @${jidToNumber(targetJid)} ya puede volver a escribir.`, mentions: [targetJid] },
    { quoted: msg }
  );
}

module.exports = { cmdMute, cmdUnmute, formatRemaining };
