const { getKnownChannels, addChangelogEntry, getChangelogChannel, setChangelogChannel } = require("../lib/channels");

// .libc — lista los IDs (@newsletter) de los canales que el bot ha visto pasar
// mensajes. A diferencia de .libgp (grupos), esto NO es una lista completa de
// "todos los canales que sigue el bot": Baileys no tiene una función para eso.
// Solo aparece un canal acá después de que llegue al menos un mensaje/post suyo
// mientras el bot está corriendo. Solo el owner puede usarlo.
async function cmdLibC(sock, msg, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const known = getKnownChannels();
  const entries = Object.entries(known);

  if (entries.length === 0) {
    return sock.sendMessage(
      from,
      {
        text:
          "El bot todavía no ha visto ningún mensaje de un canal.\n\n" +
          "Nota: Baileys no puede listar \"todos los canales que sigue la cuenta\" directamente — " +
          "un canal aparece acá recién después de que publique algo mientras el bot está corriendo.",
      },
      { quoted: msg }
    );
  }

  const lines = entries.map(([jid, info]) => `*${info.name}*\n${jid}`);
  const text = `📋 *Canales vistos por el bot (${entries.length})*\n\n${lines.join("\n\n")}`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

// .changelog <texto> — agrega una entrada al changelog del bot (solo owner).
// Esa última entrada es la que se manda al canal configurado (CHANGELOG_CHANNEL_JID)
// cada vez que el bot arranca de nuevo (ver index.js, evento connection.update).
async function cmdChangelog(sock, msg, args, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const text = args.join(" ").trim();
  if (!text) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .changelog <texto>\nEj: .changelog Se agregó .sc para descargar de SoundCloud" },
      { quoted: msg }
    );
  }

  addChangelogEntry(text);
  await sock.sendMessage(
    from,
    { text: `✅ Entrada guardada. Se mandará al canal la próxima vez que el bot arranque:\n\n📝 ${text}` },
    { quoted: msg }
  );
}

// .set_canal <jid @newsletter> — define a qué canal se manda el changelog al
// arrancar el bot. Sin argumentos, muestra el canal configurado actualmente.
// El JID se saca con .libc (después de que el canal haya publicado algo).
async function cmdSetCanal(sock, msg, args, senderIsOwner) {
  const from = msg.key.remoteJid;

  if (!senderIsOwner) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const jid = (args[0] || "").trim();

  if (!jid) {
    const current = getChangelogChannel();
    return sock.sendMessage(
      from,
      {
        text: current
          ? `📌 Canal actual del changelog:\n${current}\n\nUso: .set_canal <jid> — para cambiarlo\nUsa .libc para sacar el jid de un canal.`
          : "📌 No hay ningún canal configurado todavía.\n\nUso: .set_canal <jid>\nUsa .libc para sacar el jid de un canal.",
      },
      { quoted: msg }
    );
  }

  if (!jid.endsWith("@newsletter")) {
    return sock.sendMessage(
      from,
      { text: "⚠️ Ese no parece un JID de canal válido (debe terminar en @newsletter). Usa .libc para copiarlo bien." },
      { quoted: msg }
    );
  }

  setChangelogChannel(jid);
  await sock.sendMessage(from, { text: `✅ Canal del changelog actualizado:\n${jid}` }, { quoted: msg });
}

module.exports = { cmdLibC, cmdChangelog, cmdSetCanal };
