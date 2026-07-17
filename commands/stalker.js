// .stalker <nombre>
// Usa 3 APIs públicas y gratuitas que estiman edad, género y nacionalidad
// SOLO en base a estadísticas de un nombre (no es información real de nadie,
// es pura coincidencia estadística — por eso es gracioso, no es rastreo real).

const FLAGS = {
  US: "🇺🇸", MX: "🇲🇽", ES: "🇪🇸", AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴", PE: "🇵🇪",
  BR: "🇧🇷", VE: "🇻🇪", EC: "🇪🇨", BO: "🇧🇴", PY: "🇵🇾", UY: "🇺🇾", CU: "🇨🇺",
  FR: "🇫🇷", IT: "🇮🇹", DE: "🇩🇪", GB: "🇬🇧", PT: "🇵🇹", JP: "🇯🇵", CN: "🇨🇳",
  IN: "🇮🇳", NG: "🇳🇬", EG: "🇪🇬", RU: "🇷🇺", CA: "🇨🇦",
};

function flagFor(code) {
  return FLAGS[code] || "🏳️";
}

module.exports = async function cmdStalker(sock, msg, args) {
  const from = msg.key.remoteJid;
  const name = args.join(" ").trim();

  if (!name) {
    return sock.sendMessage(from, { text: "📌 Uso: .stalker <nombre>" }, { quoted: msg });
  }

  const encoded = encodeURIComponent(name.split(" ")[0]); // las APIs usan solo el primer nombre

  try {
    const [ageRes, genderRes, natRes] = await Promise.all([
      fetch(`https://api.agify.io?name=${encoded}`).then((r) => r.json()),
      fetch(`https://api.genderize.io?name=${encoded}`).then((r) => r.json()),
      fetch(`https://api.nationalize.io?name=${encoded}`).then((r) => r.json()),
    ]);

    const age = ageRes?.age ?? "desconocida";
    const gender = genderRes?.gender === "male" ? "Hombre" : genderRes?.gender === "female" ? "Mujer" : "Desconocido";
    const genderProb = genderRes?.probability ? Math.round(genderRes.probability * 100) : null;

    const topCountries = (natRes?.country || [])
      .slice(0, 3)
      .map((c) => `${flagFor(c.country_id)} ${c.country_id} (${Math.round(c.probability * 100)}%)`)
      .join("\n");

    const text =
      `🕵️ *REPORTE STALKER*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Nombre: ${name}\n` +
      `Edad estimada: ${age} años\n` +
      `Género probable: ${gender}${genderProb !== null ? ` (${genderProb}%)` : ""}\n` +
      `Nacionalidad probable:\n${topCountries || "sin datos"}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `_(Esto es 100% estadística de nombre, no info real de nadie 😅)_`;

    await sock.sendMessage(from, { text }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No pude generar el reporte: ${err.message}` }, { quoted: msg });
  }
};
