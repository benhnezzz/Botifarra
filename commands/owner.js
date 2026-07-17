const { getOwnerNumbers } = require("../lib/utils");
const { getCoOwners } = require("../lib/coowners");

// .owner — muestra los números reales del owner y co-owners como links wa.me.
// Usa getOwnerNumbers() (el campo "number" de cada owner en config.js), nunca los
// "lids", porque un lid no es un número de teléfono real y no sirve como link wa.me.
module.exports = async function cmdOwner(sock, msg) {
  const from = msg.key.remoteJid;

  const owners = getOwnerNumbers().map((n) => `👑 Owner: https://wa.me/${n}`);
  const coOwners = getCoOwners()
    .filter((o) => o.number)
    .map((o) => `⭐ Co-owner: https://wa.me/${o.number}`);

  const lines = [...owners, ...coOwners];

  const text = lines.length
    ? `*Contacto del staff del bot*\n\n${lines.join("\n")}`
    : "No hay owners configurados.";

  await sock.sendMessage(from, { text }, { quoted: msg });
};
