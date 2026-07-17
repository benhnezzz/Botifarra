const { setVoiceAlias, removeVoiceAlias, listVoices } = require("../lib/ttsVoices");

// .setvoz list                              -> ver alias configurados
// .setvoz <alias> <es-MX-JorgeNeural>        -> crear/editar un alias
// .setvoz del <alias>                        -> borrar un alias
async function cmdSetVoz(sock, msg, args, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede configurar voces." }, { quoted: msg });
  }

  const sub = (args[0] || "").toLowerCase();

  if (!sub || sub === "list") {
    const voices = listVoices();
    const lines = Object.entries(voices)
      .map(([alias, voiceId]) => `• -${alias} → ${voiceId}`)
      .join("\n");
    return sock.sendMessage(
      from,
      {
        text:
          `🗣️ *Voces configuradas*\n\n${lines}\n\n` +
          `Para agregar/editar: .setvoz <alias> <voz de Edge>\n` +
          `Ej: .setvoz juanito es-MX-JorgeNeural\n` +
          `Para borrar: .setvoz del <alias>\n\n` +
          `Lista completa de voces de Edge: corre "npx edge-tts --list-voices" en el server, o busca "edge-tts voice list" — hay varias por idioma (es-ES, es-MX, es-AR, etc).`,
      },
      { quoted: msg }
    );
  }

  if (sub === "del") {
    const alias = args[1];
    if (!alias) {
      return sock.sendMessage(from, { text: "⚠️ Uso: .setvoz del <alias>" }, { quoted: msg });
    }
    const removed = removeVoiceAlias(alias);
    return sock.sendMessage(
      from,
      { text: removed ? `✅ Voz "-${alias}" eliminada.` : `⚠️ No existía una voz con el alias "-${alias}".` },
      { quoted: msg }
    );
  }

  // .setvoz <alias> <voiceId>
  const alias = args[0];
  const voiceId = args[1];

  if (!alias || !voiceId) {
    return sock.sendMessage(
      from,
      { text: "⚠️ Uso: .setvoz <alias> <voz de Edge>\nEj: .setvoz juanito es-MX-JorgeNeural" },
      { quoted: msg }
    );
  }

  setVoiceAlias(alias, voiceId);
  await sock.sendMessage(
    from,
    { text: `✅ Ahora ".tts -${alias.toLowerCase()} <texto>" usará la voz ${voiceId}.` },
    { quoted: msg }
  );
}

module.exports = cmdSetVoz;
