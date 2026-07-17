const { getMessages, clearMessages } = require("../lib/messageStore");
const { isBotAdmin } = require("../lib/utils");

// .clear — borra (para todos) los mensajes del grupo que el bot alcanzó a ver
// mientras estaba corriendo. Lo puede usar CUALQUIERA del grupo (sin
// restricción de owner/admin) — solo hace falta que el bot sea admin del
// grupo para poder borrar mensajes ajenos.
//
// Limitaciones (avisadas también en los mensajes del propio comando):
// - No borra mensajes de ANTES de que el bot arrancara / del último reinicio.
// - No borra los mensajes que el bot mismo mandó.
// - WhatsApp puede rechazar borrar mensajes muy viejos por su propia ventana de
//   tiempo para "eliminar para todos", aunque el bot los tenga guardados.
module.exports = async function cmdClear(sock, msg, isGroup) {
  const from = msg.key.remoteJid;

  if (!isGroup) {
    return sock.sendMessage(from, { text: "⛔ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  const botAdmin = await isBotAdmin(sock, from);
  if (!botAdmin) {
    return sock.sendMessage(
      from,
      { text: "⛔ Necesito ser admin del grupo para poder borrar mensajes de otras personas." },
      { quoted: msg }
    );
  }

  const keys = getMessages(from);

  if (keys.length === 0) {
    return sock.sendMessage(
      from,
      {
        text:
          "ℹ️ No tengo mensajes guardados de este grupo para borrar.\n" +
          "Solo puedo borrar los que vi mientras estaba corriendo (no el historial de antes de arrancar o de un reinicio).",
      },
      { quoted: msg }
    );
  }

  await sock.sendMessage(from, { text: `🧹 Borrando ${keys.length} mensajes...` }, { quoted: msg });

  const BATCH_SIZE = 10;
  const DELAY_MS = 800;
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    for (const key of batch) {
      try {
        await sock.sendMessage(from, { delete: key });
        deleted++;
      } catch {
        failed++;
      }
    }
    if (i + BATCH_SIZE < keys.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  clearMessages(from);

  try {
    await sock.sendMessage(from, {
      text: `✅ Listo. Borrados: ${deleted}. Fallidos: ${failed} (ej. mensajes muy viejos que WhatsApp ya no deja eliminar).`,
    });
  } catch (err) {
    console.error("No se pudo enviar el resumen de .clear:", err.message);
  }
};
