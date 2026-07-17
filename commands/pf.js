// .pf [número o @mención] — envía la foto de perfil.
// Soporta @mención, respuesta a mensaje, o número como +56912345678
// Si no se proporciona, usa la del remitente.
const { getQuotedMessage, jidToNumber, jidNormalizedUser } = require("../lib/utils");

module.exports = async function cmdPf(sock, msg) {
  const from = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quoted = getQuotedMessage(msg);

  // Obtener el texto del mensaje para parsear número
  let text = '';
  if (msg.message?.conversation) {
    text = msg.message.conversation;
  } else if (msg.message?.extendedTextMessage?.text) {
    text = msg.message.extendedTextMessage.text;
  }

  // Parsear argumento después de .pf
  let arg = text.split(/\s+/)[1]?.trim() || ''; // primer argumento después del comando

  let targetJid;
  if (mentioned && mentioned.length > 0) {
    targetJid = mentioned[0];
  } else if (quoted?.participant) {
    targetJid = quoted.participant;
  } else if (arg && /^[\+0-9\s\-\(\)]+$/.test(arg)) {
    // Limpiar número: solo dígitos
    let cleanNumber = arg.replace(/[^0-9]/g, '');
    if (cleanNumber.length > 0) {
      // Opcional: quitar leading 0 (ajusta según tu país si es necesario)
      if (cleanNumber.startsWith('0') && cleanNumber.length > 8) {
        cleanNumber = cleanNumber.substring(1);
      }
      targetJid = `${cleanNumber}@s.whatsapp.net`;
    } else {
      targetJid = sender;
    }
  } else {
    targetJid = sender; // sin mención: la propia foto de quien ejecuta el comando
  }

  targetJid = jidNormalizedUser(targetJid);

  try {
    const url = await sock.profilePictureUrl(targetJid, "image");
    const isSelf = targetJid === jidNormalizedUser(sender);
    const caption = isSelf
      ? "📸 Tu foto de perfil"
      : `📸 Foto de perfil de @${jidToNumber(targetJid)}`;

    await sock.sendMessage(
      from,
      {
        image: { url },
        caption,
        mentions: isSelf ? undefined : [targetJid],
      },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(
      from,
      { text: "❌ No pude obtener esa foto de perfil (puede que no tenga foto o su privacidad no lo permita)." },
      { quoted: msg }
    );
  }
};
