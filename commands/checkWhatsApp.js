const { numberToJid, jidToNumber } = require("../lib/utils");

// .wa <número>  ->  información ampliada de cuenta WhatsApp (perfil, business, foto, etc.)
module.exports = async function cmdCheckWhatsApp(sock, msg, args) {
  const from = msg.key.remoteJid;

  let number = args[0];
  if (!number) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .wa <número>\nEj: .wa 56977776666" },
      { quoted: msg }
    );
  }

  const cleanNumber = number.replace(/[^0-9]/g, "");
  const jid = numberToJid(cleanNumber);

  try {
    const [result] = await sock.onWhatsApp(cleanNumber);

    if (!result?.exists) {
      return sock.sendMessage(
        from,
        { text: `❌ +${cleanNumber} no tiene cuenta de WhatsApp (o no es válido).` },
        { quoted: msg }
      );
    }

    let infoText = `✅ *+${cleanNumber}* tiene cuenta activa de WhatsApp.\n\n`;

    // Perfil de negocio (si es cuenta business)
    try {
      const businessProfile = await sock.getBusinessProfile(jid);
      if (businessProfile) {
        infoText += `🏢 *Perfil Business*\n`;
        if (businessProfile.description) infoText += `📝 Descripción: ${businessProfile.description}\n`;
        if (businessProfile.category) infoText += `📂 Categoría: ${businessProfile.category}\n`;
        if (businessProfile.email) infoText += `✉️ Email: ${businessProfile.email}\n`;
        if (businessProfile.website) infoText += `🌐 Web: ${businessProfile.website}\n`;
        if (businessProfile.address) infoText += `📍 Dirección: ${businessProfile.address}\n`;
      }
    } catch (e) {
      // No es business o error (silencioso)
    }

    // Foto de perfil
    try {
      const ppUrl = await sock.profilePictureUrl(jid, "image");
      if (ppUrl) {
        infoText += `🖼️ [Foto de perfil disponible](${ppUrl})\n`;
      }
    } catch (e) {
      infoText += `🖼️ Sin foto de perfil pública.\n`;
    }

    // Info básica adicional
    infoText += `\n🆔 JID: ${result.jid || jid}\n`;

    await sock.sendMessage(from, { text: infoText }, { quoted: msg });

  } catch (err) {
    await sock.sendMessage(
      from,
      { text: `❌ Error al verificar: ${err.message}` },
      { quoted: msg }
    );
  }
};