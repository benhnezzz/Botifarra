const { spawn } = require("child_process");
const path = require("path");
const { setRestarting } = require("../lib/restartFlag");

// .re — reinicia el bot UNA sola vez:
// 1) avisa que va a reiniciar
// 2) marca el proceso como "reiniciando" (para que index.js no dispare una
//    segunda reconexión automática al cerrarse la conexión)
// 3) lanza un proceso nuevo idéntico, indicándole a qué chat avisar cuando
//    quede conectado de nuevo
// 4) cierra el proceso actual
// La sesión de WhatsApp (auth_info/) no se pierde, sigue conectado igual.
//
// NOTA: ya no hace "git pull" — el bot se instala/actualiza de forma local
// (copiando archivos a mano), no desde un repo de git.
module.exports = async function cmdRestart(sock, msg, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  await sock.sendMessage(from, { text: "♻️ Reiniciando el bot..." }, { quoted: msg });

  // Evita que index.js reconecte por su cuenta cuando cerremos la conexión
  // abajo — sin esto, el bot terminaba "reiniciándose 2 veces".
  setRestarting(true);

  const repoDir = path.join(__dirname, "..");
  const entryFile = path.join(repoDir, "index.js");

  const child = spawn(process.execPath, [entryFile], {
    detached: true,
    stdio: "inherit",
    cwd: repoDir,
    env: { ...process.env, NOTIFY_RESTART_JID: from },
  });
  child.unref();

  // Pequeño delay para asegurar que el mensaje de arriba salió antes de cerrar
  setTimeout(() => process.exit(0), 800);
};
