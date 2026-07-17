const config = require("../config");
const { jidToNumber } = require("../lib/utils");
const { getChangelogChannel } = require("../lib/channels");
const { getCoOwners } = require("../lib/coowners");

// .c <mensaje> — manda un anuncio formal al mismo canal usado por .set_canal /
// .changelog, mencionando a quien lo mandó. Owner o co-owner.
// Ej: .c hola mundo
async function cmdC(sock, msg, args, senderIsOwnerOrCo, sender) {
  const from = msg.key.remoteJid;

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner o un co-owner pueden usar este comando." }, { quoted: msg });
  }

  const text = args.join(" ").trim();
  if (!text) {
    return sock.sendMessage(from, { text: "📌 Uso: .c <mensaje>\nEj: .c hola mundo" }, { quoted: msg });
  }

  const channelJid = getChangelogChannel() || config.CHANGELOG_CHANNEL_JID;
  if (!channelJid) {
    return sock.sendMessage(
      from,
      { text: "⚠️ No hay ningún canal configurado todavía. Usa .set_canal <jid> primero (.libc te da el jid)." },
      { quoted: msg }
    );
  }

  const formatted = text.charAt(0).toUpperCase() + text.slice(1);
  const announcement = `📢 *Comunicado oficial*\n\nDe parte de: @${jidToNumber(sender)}\n\n“${formatted}”`;

  try {
    await sock.sendMessage(channelJid, { text: announcement, mentions: [sender] });
    await sock.sendMessage(from, { text: "✅ Mensaje enviado al canal." }, { quoted: msg });
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No se pudo mandar el mensaje al canal: ${err.message}` }, { quoted: msg });
  }
}

// .act — recarga config.js "en caliente" (sin reiniciar el proceso). Solo hace
// falta si editaste config.js A MANO (ej. agregaste un owner directo en el
// archivo): Node lo carga una sola vez al arrancar, así que un cambio manual
// no se nota hasta esto (o hasta un .re completo). Los co-owners agregados con
// .co YA funcionan sin esto — se leen del json en cada comando, no se cachean.
async function cmdAct(sock, msg, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  try {
    const configPath = require.resolve("../config");
    const liveConfig = require(configPath); // el objeto que YA tienen referenciado los demás archivos

    delete require.cache[configPath];
    const freshConfig = require(configPath); // vuelve a leer y ejecutar config.js desde disco

    // Mutamos el objeto de siempre EN VEZ de reemplazarlo, para que los archivos
    // que ya hicieron "const config = require('../config')" al arrancar (utils.js,
    // index.js, etc.) vean los valores nuevos sin tener que volver a requerirlo.
    Object.keys(liveConfig).forEach((key) => delete liveConfig[key]);
    Object.assign(liveConfig, freshConfig);
    require.cache[configPath].exports = liveConfig;

    await sock.sendMessage(
      from,
      { text: "✅ config.js recargado en caliente. Usa .ver para confirmar que los cambios se aplicaron." },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(from, { text: `❌ No se pudo recargar config.js: ${err.message}` }, { quoted: msg });
  }
}

// .ver — muestra los owners (de config.js) y co-owners (de .co) que el bot
// tiene reconocidos AHORA MISMO, para confirmar que un cambio (manual o con
// .co) realmente surtió efecto. Owner o co-owner.
async function cmdVer(sock, msg, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;

  if (!senderIsOwnerOrCo) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner o un co-owner pueden usar este comando." }, { quoted: msg });
  }

  const ownerLines = config.OWNERS.map((o) => {
    const lids = (o.lids || []).length ? ` (lids: ${o.lids.join(", ")})` : "";
    return `• +${o.number}${lids}`;
  });

  const coOwners = getCoOwners();
  const coOwnerLines = coOwners.length
    ? coOwners.map((o) => {
        const lids = (o.lids || []).length ? ` (lids: ${o.lids.join(", ")})` : "";
        return `• +${o.number || "?"}${lids}`;
      })
    : ["(ninguno)"];

  const text =
    `🔎 *Estado actual de permisos*\n\n` +
    `👑 Owners (config.js):\n${ownerLines.join("\n")}\n\n` +
    `🤝 Co-owners (.co):\n${coOwnerLines.join("\n")}`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

module.exports = { cmdC, cmdAct, cmdVer };
