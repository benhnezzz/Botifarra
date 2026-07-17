const axios = require('axios');
const { numberToJid } = require("../lib/utils");

module.exports = async function cmdNum(sock, msg, args) {
  const from = msg.key.remoteJid;

  if (!args[0]) {
    return sock.sendMessage(from, { 
      text: "📌 Uso: .num <número>\nEj: .num 56942223333" 
    }, { quoted: msg });
  }

  const number = args[0].replace(/[^0-9]/g, "");
  let text = `🔍 *Consulta de +${number}*\n\n`;

  try {
    // === 1. NumVerify (Info básica: válido, operador, ubicación) ===
    const numverify = await axios.get(`http://apilayer.net/api/validate`, {
      params: {
        access_key: process.env.NUMVERIFY_KEY || "", // Pon tu clave aquí
        number: number,
        country_code: "CL",
        format: 1
      }
    }).catch(() => null);

    if (numverify?.data?.valid) {
      const d = numverify.data;
      text += `✅ **Número válido**\n`;
      text += `📍 País: \( {d.country_name} ( \){d.country_code})\n`;
      text += `📡 Operadora: ${d.carrier || "Desconocida"}\n`;
      text += `📌 Tipo: ${d.line_type || "Móvil"}\n\n`;
    } else {
      text += `⚠️ Número no válido según NumVerify\n\n`;
    }

    // === 2. AbstractAPI (Info más detallada) ===
    const abstract = await axios.get(`https://phonevalidation.abstractapi.com/v1/`, {
      params: {
        api_key: process.env.ABSTRACTAPI_KEY || "", // Pon tu clave aquí
        phone: number
      }
    }).catch(() => null);

    if (abstract?.data) {
      const a = abstract.data;
      if (a.valid) {
        text += `🌍 **AbstractAPI**\n`;
        if (a.country) text += `📍 País: ${a.country.name}\n`;
        if (a.location) text += `📌 Ubicación: ${a.location}\n`;
        if (a.carrier) text += `📡 Operadora: ${a.carrier}\n`;
        if (a.type) text += `📱 Tipo: ${a.type}\n`;
      }
    }

    // === 3. Info de WhatsApp ===
    try {
      const [wa] = await sock.onWhatsApp(number);
      if (wa?.exists) {
        text += `\n✅ **Tiene WhatsApp**\n`;
        const pp = await sock.profilePictureUrl(numberToJid(number), "image").catch(() => null);
        if (pp) text += `🖼️ Foto de perfil disponible\n`;
      }
    } catch (e) {}

    await sock.sendMessage(from, { text }, { quoted: msg });

  } catch (err) {
    await sock.sendMessage(from, { 
      text: `❌ Error en la consulta: ${err.message}` 
    }, { quoted: msg });
  }
};