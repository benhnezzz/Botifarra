const { createToggleList } = require("../lib/db");
const { requireGroupAdmins } = require("../lib/utils");

// data/antilink.json guarda los IDs de los grupos donde está activado.
// Esto se carga UNA vez al iniciar el bot y se reescribe en disco en cada cambio,
// así que sobrevive a los reinicios.
const antilink = createToggleList("antilink");

// .antilink on / .antilink off / .antilink (sin nada = ver estado actual)
async function cmdAntilink(sock, msg, args, isGroup, sender) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
  if (!senderIsAdmin) {
    return sock.sendMessage(from, { text: "⛔ Solo un administrador del grupo puede usar este comando." }, { quoted: msg });
  }

  const estado = (args[0] || "").toLowerCase();

  if (estado === "on") {
    antilink.enable(from);
    return sock.sendMessage(from, { text: "🔒 Antilink activado en este grupo." }, { quoted: msg });
  }

  if (estado === "off") {
    antilink.disable(from);
    return sock.sendMessage(from, { text: "🔓 Antilink desactivado en este grupo." }, { quoted: msg });
  }

  const activo = antilink.isEnabled(from);
  return sock.sendMessage(
    from,
    {
      text:
        `Antilink está ${activo ? "🔒 ACTIVADO" : "🔓 DESACTIVADO"} en este grupo.\n\n` +
        `Usa:\n.antilink on\n.antilink off`,
    },
    { quoted: msg }
  );
}

// Se exporta también la instancia de la lista para poder usarla desde el listener
// de mensajes de index.js (ej: para borrar automáticamente mensajes con links).
module.exports = cmdAntilink;
module.exports.antilink = antilink;
