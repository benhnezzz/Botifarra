// Carga el archivo .env (si existe) ANTES que cualquier otro módulo, porque
// config.js y varios comandos leen process.env.* apenas se importan.
require("dotenv").config();

const { getBaileys } = require("./lib/baileysEsm");
const pino = require("pino");
const readline = require("readline");

const config = require("./config");

// --- Helper para preguntar el número por consola ---
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}
const { isOwner, isOwnerOrCoOwner, getMessageText, isBotAdmin, isBotJid, jidToNumber, requireGroupAdmins, toJidString } = require("./lib/utils");
const { isRestarting } = require("./lib/restartFlag");
const groupMetadataCache = require("./lib/groupMetadataCache");

const cmdJoin = require("./commands/join");
const cmdSticker = require("./commands/sticker");
const cmdRs = require("./commands/rs");
const cmdPf = require("./commands/pf");
const cmdKiss = require("./commands/kiss");
const cmdHug = require("./commands/hug");
const cmdPat = require("./commands/pat");
const { cmdAdd, cmdKick, cmdVaciar } = require("./commands/participants");
const { cmdSetPP, cmdSetName, cmdSetDesc } = require("./commands/groupSettings");
const cmdSelfAdmin = require("./commands/selfAdmin");
const cmdPromote = require("./commands/promote");
const cmdDemote = require("./commands/demote");
const cmdCoOwner = require("./commands/coowner");
const { cmdMute, cmdUnmute } = require("./commands/mute");
const cmdGroupBroadcast = require("./commands/broadcastGroups");
const { isMuted } = require("./lib/mutes");
const cmdOwner = require("./commands/owner");
const cmdAntilink = require("./commands/antilink");
const cmdDebugAdmin = require("./commands/debugAdmin");
const cmdCheckWhatsApp = require("./commands/checkWhatsApp");
const cmdRob = require("./commands/rob");
const cmdPing = require("./commands/ping");
const cmdPull = require("./commands/poll");
const cmdStalker = require("./commands/stalker");
const { cmdMp3, cmdMp4, cmdTik, cmdIg, cmdSc } = require("./commands/download");
const cmdRestart = require("./commands/restart");
const cmdLib = require("./commands/lib");
const { cmdOpen, cmdClose } = require("./commands/groupOpenClose");
const { cmdBlock, cmdUnblock } = require("./commands/blockGroup");
const cmdListGroups = require("./commands/listGroups");
const cmdLibG = require("./commands/libGroup");
const { isGroupBlocked } = require("./lib/blockedGroups");
const { trackMessage } = require("./lib/messageStore");
const cmdClear = require("./commands/clear");
const { isBanned } = require("./lib/bannedUsers");
const { cmdBan, cmdUnban } = require("./commands/ban");
const cmdSetSug = require("./commands/setSug");
const cmdSug = require("./commands/sug");
const cmdDiag = require("./commands/diag");
const { cmdLibC, cmdChangelog, cmdSetCanal } = require("./commands/channels");
const { cmdLink, cmdLinkAll } = require("./commands/groupLinks");
const { trackChannel, getLatestChangelogEntry, getChangelogChannel } = require("./lib/channels");
const { cmdC, cmdAct, cmdVer } = require("./commands/adminTools");
const cmdTts = require("./commands/tts");
const cmdSetVoz = require("./commands/setVoz");
// Sistema RPG "Elyndor" -- TODOS sus comandos empiezan con "rpg" (.rpgon,
// .rpgcrear, etc.), por lo que nunca chocan con ningún comando de arriba.
// Se enruta desde el `default` del switch de comandos (ver más abajo).
const { routeRpgCommand } = require("./commands/rpg");
const {
  cmdCartera,
  cmdDeposit,
  cmdWithdraw,
  cmdRegalar,
  cmdRankCoins,
  cmdDaily,
  cmdWork,
  cmdCrimen,
  cmdRobar,
  cmdPescar,
  cmdMinar,
  cmdCasino,
  cmdDado,
  cmdFlip,
  cmdBlackdice,
  cmdTiendaRpg,
  cmdRankNivel,
  cmdMiNivel,
  cmdVerNivel,
  cmdNiveles,
  cmdEconomyMenu,
} = require("./commands/economy");
const {
  cmdRw,
  cmdClain,
  cmdHarem,
  cmdDelChar,
  cmdSell,
  cmdWshop,
  cmdBuyc,
  cmdGiveChar,
  cmdGiveAll,
  cmdTrade,
  cmdVotar,
  cmdWtop,
  cmdNewChar,
  cmdClaimPj,
  cmdVerPj,
  cmdGachaMenu,
} = require("./commands/gacha");

// --- Red de seguridad: un error suelto (ej. rate-limit de WhatsApp) no debe
// tumbar el proceso completo. Solo lo logueamos y seguimos corriendo.
process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled rejection (bot sigue corriendo):", err);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught exception (bot sigue corriendo):", err);
});

// Se pone en true la primera vez que el bot avisa el changelog en este proceso.
// Evita que se repita el mensaje en el canal cada vez que hay una reconexión
// automática (misma ejecución de node), y solo lo manda en un arranque real
// del proceso (ej: primera vez, o tras un .re / crash-restart).
let changelogNotified = false;

async function startBot() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await getBaileys();

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"], // NO cambiar "Ubuntu" acá: Baileys necesita este valor específico para que el pairing code (vinculación por número) funcione bien. El nombre "Botifarra" ya queda puesto en package.json, config.js (autor de stickers) y el README.
    cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid),
  });

  // --- Vinculación por código en vez de QR ---
  // Si la sesión todavía no está registrada (no hay auth guardada), pedimos el
  // número de WhatsApp del bot (con código de país, sin "+" ni espacios) y
  // solicitamos el código de emparejamiento a WhatsApp.
  if (!sock.authState.creds.registered) {
    const phoneNumber =
      config.PAIRING_NUMBER ||
      process.env.PAIRING_NUMBER ||
      (await askQuestion(
        "📱 Ingresa el número de WhatsApp del bot (con código de país, sin '+' ni espacios, ej: 56912345678): "
      ));

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ""));
        console.log(`🔑 Tu código de emparejamiento es: ${code}`);
        console.log("Ve a WhatsApp > Dispositivos vinculados > Vincular con número de teléfono e ingresa este código.");
      } catch (err) {
        console.error("❌ Error solicitando el código de emparejamiento:", err.message);
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isRestarting();
      if (isRestarting()) {
        console.log("🔌 Conexión cerrada por reinicio manual (.re), no reconecto en este proceso.");
      } else {
        console.log("🔌 Conexión cerrada.", shouldReconnect ? "Reconectando..." : "Sesión cerrada, borra auth_info/ y vuelve a escanear.");
      }
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Bot conectado a WhatsApp.");

      // Si este proceso nació de un .re, avisamos en el mismo chat que el
      // reinicio ya terminó y el bot quedó conectado de nuevo.
      const notifyJid = process.env.NOTIFY_RESTART_JID;
      if (notifyJid) {
        delete process.env.NOTIFY_RESTART_JID; // que no se repita en futuras reconexiones de este mismo proceso
        sock
          .sendMessage(notifyJid, { text: "✅ Reinicio completado. El bot ya está en línea de nuevo." })
          .catch((err) => console.error("No se pudo avisar que el reinicio terminó:", err.message));
      }

      // Aviso de cambios al canal configurado (con .set_canal, o CHANGELOG_CHANNEL_JID
      // en config.js como respaldo si nunca se usó el comando), una sola vez por
      // proceso real (no en cada reconexión automática).
      if (!changelogNotified) {
        changelogNotified = true;
        const channelJid = getChangelogChannel() || config.CHANGELOG_CHANNEL_JID;
        if (channelJid) {
          const latest = getLatestChangelogEntry();
          const text = latest
            ? `🔄 *Botifarra se reinició*\n\n📝 Último cambio:\n${latest.text}`
            : `🔄 *Botifarra se reinició*\n\n(sin cambios registrados todavía — usa .changelog <texto> para agregar uno)`;
          sock
            .sendMessage(channelJid, { text })
            .catch((err) => console.error("No se pudo avisar el changelog en el canal:", err.message));
        }
      }
    }
  });

  // --- Cache de groupMetadata: la mantenemos al día con los eventos del grupo ---
  sock.ev.on("groups.update", async (updates) => {
    for (const update of updates) {
      if (!update.id) continue;
      try {
        groupMetadataCache.set(update.id, await sock.groupMetadata(update.id));
      } catch {
        groupMetadataCache.invalidate(update.id);
      }
    }
  });

  // --- Aviso de cambios de admin (dar/quitar) + auto-admin al owner ---
  sock.ev.on("group-participants.update", async (event) => {
    const { id: groupId, action } = event;
    // Baileys 7 puede mandar cada participante (y a veces "author") como un
    // objeto { id, phoneNumber, lid } en vez de un string plano de JID.
    // Normalizamos todo a string acá mismo, una sola vez.
    const author = toJidString(event.author);
    const participants = (event.participants || []).map(toJidString).filter(Boolean);

    try {
      groupMetadataCache.invalidate(groupId);
      try {
        groupMetadataCache.set(groupId, await sock.groupMetadata(groupId));
      } catch {
        // Si falla el refresco, no pasa nada: seguimos sin cache hasta la próxima consulta.
      }

      if (action === "promote" || action === "demote") {
        // Si la acción la ejecutó el bot (porque vino de .promote o .demote), esos
        // comandos ya mandaron su propio aviso mencionando correctamente a quién lo pidió.
        // Si no filtramos esto, saldría un segundo mensaje atribuyéndole la acción al
        // número del bot (porque técnicamente es la cuenta del bot la que la ejecuta),
        // en vez de a la persona real que escribió el comando.
        const authorIsBot = isBotJid(sock, author);

        if (!authorIsBot) {
          const verb = action === "promote" ? "le dio admin a" : "le quitó el admin a";
          const authorTag = author ? `@${jidToNumber(author)}` : "Alguien";
          const targetsTag = participants.map((p) => `@${jidToNumber(p)}`).join(", ");

          await sock.sendMessage(groupId, {
            text: `👑 ${authorTag} ${verb} ${targetsTag}`,
            mentions: [author, ...participants].filter(Boolean),
          });
        }
      }

      if (action === "add" && config.AUTO_ADMIN_OWNER) {
        for (const p of participants) {
          if (isOwner(p)) {
            const botAdmin = await isBotAdmin(sock, groupId);
            if (botAdmin) {
              await sock.groupParticipantsUpdate(groupId, [p], "promote");
              await sock.sendMessage(groupId, {
                text: `✅ Bienvenido owner @${jidToNumber(p)}, te di admin automáticamente.`,
                mentions: [p],
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Error en group-participants-update:", err.message);
    }
  });

  // --- Router de comandos ---
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    // Los canales (@newsletter) no son chats normales: nadie corre comandos ahí,
    // pero sí vamos registrando cada uno que veamos pasar, para poder listarlos
    // después con .libc (ver nota en lib/channels.js sobre por qué es necesario).
    if (from.endsWith("@newsletter")) {
      trackChannel(from, msg.pushName);
      return;
    }

    const isGroup = from.endsWith("@g.us");
    const sender = isGroup ? msg.key.participant : from;

    // Si el grupo está bloqueado, el bot ignora TODO (ni siquiera responde).
    // Solo se desbloquea con .unblock desde otro chat (ver commands/blockGroup.js).
    if (isGroup && isGroupBlocked(from)) return;

    // .mute: si quien escribió está muteado EN ESTE grupo, le borramos el
    // mensaje (si el bot es admin) y cortamos acá: no procesamos comandos
    // de alguien muteado tampoco.
    if (isGroup && isMuted(from, sender)) {
      try {
        if (await isBotAdmin(sock, from)) {
          await sock.sendMessage(from, { delete: msg.key });
        }
      } catch (err) {
        console.error("Error borrando mensaje de usuario muteado:", err.message);
      }
      return;
    }

    // Guarda la clave de este mensaje para que .clear la pueda borrar más adelante.
    if (isGroup) {
      trackMessage(from, msg.key);
    }

    const body = getMessageText(msg);
    if (!body || !body.startsWith(config.PREFIX)) return;

    const args = body.slice(config.PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    const senderIsOwner = isOwner(sender);
    const senderIsOwnerOrCo = isOwnerOrCoOwner(sender);

    // Un usuario baneado (.ban) no puede usar NINGÚN comando, salvo que sea el
    // owner (así nunca queda el bot bloqueado para sí mismo por accidente) o
    // que esté pidiendo el contacto del owner (.owner) para poder resolverlo.
    if (!senderIsOwner && command !== "owner" && isBanned(sender)) {
      return sock.sendMessage(
        from,
        {
          text:
            "⛔ *Acceso restringido*\n\n" +
            "Tu número ha sido bloqueado del uso de este bot.\n\n" +
            "Para resolver la situación, por favor contacta al owner (puedes usar .owner para ver sus datos de contacto).",
        },
        { quoted: msg }
      );
    }

    try {
      switch (command) {
        case "join":
          await cmdJoin(sock, msg, args, sender);
          break;

        case "sticker":
        case "s":
          await cmdSticker(sock, msg, args);
          break;

        case "rs":
          await cmdRs(sock, msg, args);
          break;

        case "pf":
          await cmdPf(sock, msg);
          break;

        case "kiss":
          await cmdKiss(sock, msg);
          break;

        case "hug":
          await cmdHug(sock, msg);
          break;

        case "pat":
          await cmdPat(sock, msg);
          break;

        case "agg":
        case "add":
          await cmdAdd(sock, msg, args, isGroup, sender);
          break;

        case "kick":
        case "del":
          await cmdKick(sock, msg, args, isGroup, sender);
          break;

        case "open":
          await cmdOpen(sock, msg, isGroup, sender);
          break;

        case "close":
          await cmdClose(sock, msg, isGroup, sender);
          break;

        case "vc":
          await cmdVaciar(sock, msg, args, isGroup, sender, senderIsOwnerOrCo);
          break;

        case "rob":
          await cmdRob(sock, msg, isGroup, sender, senderIsOwnerOrCo);
          break;

        case "ping":
        case "p":
          await cmdPing(sock, msg);
          break;

        // ── Economía ──
        case "cartera":
          await cmdCartera(sock, msg, args, sender);
          break;

        case "dep":
          await cmdDeposit(sock, msg, args, sender);
          break;

        case "ret":
          await cmdWithdraw(sock, msg, args, sender);
          break;

        case "regalar":
          await cmdRegalar(sock, msg, args, sender);
          break;

        case "rankcoins":
          await cmdRankCoins(sock, msg);
          break;

        case "daily":
          await cmdDaily(sock, msg, args, sender);
          break;

        case "work":
          await cmdWork(sock, msg, args, sender);
          break;

        case "crimen":
          await cmdCrimen(sock, msg, args, sender);
          break;

        case "robar":
          await cmdRobar(sock, msg, args, sender);
          break;

        case "pescar":
          await cmdPescar(sock, msg, args, sender);
          break;

        case "minar":
          await cmdMinar(sock, msg, args, sender);
          break;

        case "casino":
          await cmdCasino(sock, msg, args, sender);
          break;

        case "dado":
          await cmdDado(sock, msg, args, sender);
          break;

        case "flip":
          await cmdFlip(sock, msg, args, sender);
          break;

        case "blackdice":
          await cmdBlackdice(sock, msg, args, sender);
          break;

        case "tiendarpg":
          await cmdTiendaRpg(sock, msg, args, sender);
          break;

        case "ranknivel":
          await cmdRankNivel(sock, msg);
          break;

        case "minivel":
          await cmdMiNivel(sock, msg, args, sender);
          break;

        case "vernivel":
          await cmdVerNivel(sock, msg, args);
          break;

        case "niveles":
          await cmdNiveles(sock, msg);
          break;

        case "economy":
          await cmdEconomyMenu(sock, msg);
          break;

        // ── Gacha ──
        case "rw":
          await cmdRw(sock, msg, sender);
          break;

        case "clain":
          await cmdClain(sock, msg, args, sender);
          break;

        case "harem":
          await cmdHarem(sock, msg, args, sender);
          break;

        case "delchar":
          await cmdDelChar(sock, msg, args, sender);
          break;

        case "sell":
          await cmdSell(sock, msg, args, sender);
          break;

        case "wshop":
          await cmdWshop(sock, msg);
          break;

        case "buyc":
          await cmdBuyc(sock, msg, args, sender);
          break;

        case "givechar":
          await cmdGiveChar(sock, msg, args, sender);
          break;

        case "giveall":
          await cmdGiveAll(sock, msg, args, sender);
          break;

        case "trade":
          await cmdTrade(sock, msg, args, sender);
          break;

        case "votar":
          await cmdVotar(sock, msg, args, sender);
          break;

        case "wtop":
          await cmdWtop(sock, msg);
          break;

        case "newchar":
          await cmdNewChar(sock, msg, args, sender);
          break;

        case "claimpj":
          await cmdClaimPj(sock, msg, args, sender);
          break;

        case "verpj":
          await cmdVerPj(sock, msg, args);
          break;

        case "gacha":
          await cmdGachaMenu(sock, msg, sender);
          break;

        case "pull":
          await cmdPull(sock, msg, args);
          break;

        case "stalker":
          await cmdStalker(sock, msg, args);
          break;

        case "mp3":
          await cmdMp3(sock, msg, args);
          break;

        case "mp4":
          await cmdMp4(sock, msg, args);
          break;

        case "tik":
          await cmdTik(sock, msg, args);
          break;

        case "ig":
          await cmdIg(sock, msg, args);
          break;

        case "sc":
          await cmdSc(sock, msg, args);
          break;

        case "setpp":
          await cmdSetPP(sock, msg, isGroup, sender);
          break;

        case "setname":
          await cmdSetName(sock, msg, args, isGroup, sender);
          break;

        case "setdesc":
          await cmdSetDesc(sock, msg, args, isGroup, sender);
          break;

        case "admin":
          await cmdSelfAdmin(sock, msg, isGroup, senderIsOwnerOrCo);
          break;

        case "promote":
          await cmdPromote(sock, msg, args, isGroup, sender);
          break;

        case "demote":
          await cmdDemote(sock, msg, args, isGroup, sender);
          break;

        case "co":
          await cmdCoOwner(sock, msg, args, senderIsOwner, isGroup);
          break;

        case "re":
          await cmdRestart(sock, msg, senderIsOwner);
          break;

        case "lib":
          await cmdLib(sock, msg, senderIsOwner);
          break;

        case "clear":
          await cmdClear(sock, msg, isGroup);
          break;

        case "ban":
          await cmdBan(sock, msg, senderIsOwner);
          break;

        case "unban":
          await cmdUnban(sock, msg, senderIsOwner);
          break;

        case "set_sug":
          await cmdSetSug(sock, msg, args, isGroup, senderIsOwner);
          break;

        case "sug":
          await cmdSug(sock, msg, args, sender);
          break;

        case "diag":
          await cmdDiag(sock, msg, isGroup, senderIsOwner);
          break;

        case "block":
          await cmdBlock(sock, msg, args, senderIsOwner);
          break;

        case "unblock":
          await cmdUnblock(sock, msg, args, senderIsOwner);
          break;

        case "libgp":
          await cmdListGroups(sock, msg, senderIsOwner);
          break;

        case "libg":
          await cmdLibG(sock, msg, isGroup, senderIsOwner);
          break;

        case "mute":
          await cmdMute(sock, msg, args, isGroup, sender, senderIsOwnerOrCo);
          break;

        case "unmute":
          await cmdUnmute(sock, msg, args, isGroup, sender, senderIsOwnerOrCo);
          break;

        case "group":
          await cmdGroupBroadcast(sock, msg, args, senderIsOwnerOrCo);
          break;

        case "link":
          await cmdLink(sock, msg, isGroup, sender, senderIsOwnerOrCo);
          break;

        case "linkall":
          await cmdLinkAll(sock, msg, senderIsOwnerOrCo);
          break;

        case "libc":
          await cmdLibC(sock, msg, senderIsOwner);
          break;

        case "changelog":
          await cmdChangelog(sock, msg, args, senderIsOwner);
          break;

        case "set_canal":
          await cmdSetCanal(sock, msg, args, senderIsOwner);
          break;

        case "c":
          await cmdC(sock, msg, args, senderIsOwnerOrCo, sender);
          break;

        case "act":
          await cmdAct(sock, msg, senderIsOwner);
          break;

        case "ver":
          await cmdVer(sock, msg, senderIsOwnerOrCo);
          break;

        case "antilink":
          await cmdAntilink(sock, msg, args, isGroup, sender);
          break;

        case "debugadmin":
          await cmdDebugAdmin(sock, msg, isGroup);
          break;

        case "wa":
          await cmdCheckWhatsApp(sock, msg, args);
          break;

        case "tts":
          await cmdTts(sock, msg, args);
          break;

        case "setvoz":
          await cmdSetVoz(sock, msg, args, senderIsOwner);
          break;

        case "owner":
          await cmdOwner(sock, msg);
          break;

        case "menu":
        case "help": {
          let senderIsGroupAdmin = false;
          if (isGroup) {
            const { senderIsAdmin } = await requireGroupAdmins(sock, from, sender);
            senderIsGroupAdmin = senderIsAdmin;
          }

          const section = (emoji, title, lines) =>
            `┌ ${emoji} *${title}*\n` +
            lines.map((l) => `│ ${l}`).join("\n") +
            `\n└─────────────`;

          const generalSection = section("👤", "GENERAL", [
            "*.menu* / *.help* — ver este menú",
            "*.ping* / *.p* — latencia y estado del bot",
            "*.owner* — contacto del owner y co-owners",
            "*.wa* <número> — revisa si un número tiene WhatsApp",
            "*.stalker* <nombre> — edad/género/nacionalidad probable (por diversión)",
            "*.sug* <mensaje> — mandar una sugerencia al staff (podés adjuntar una foto)",
          ]);

          const stickersSection = section("🎨", "STICKERS Y PERFIL", [
            "*.sticker* <paquete> — crear sticker (imagen/video)",
            "*.rs* <paquete> | <autor> — robar sticker (respondé a uno)",
            "*.pf* @mención — foto de perfil (sin mención: la tuya)",
            "*.kiss* / *.hug* / *.pat* @mención — GIFs de reacción",
          ]);

          const descargasSection = section("⬇️", "DESCARGAS", [
            "*.mp3* <link YouTube> — descargar audio",
            "*.mp4* <link YouTube> — descargar video",
            "*.tik* <link TikTok> — descargar video",
            "*.ig* <link Instagram> — descargar video",
            "*.sc* <link SoundCloud> — descargar audio",
          ]);

          const extrasSection = section("✨", "EXTRAS", [
            "*.tts* <texto> — texto a nota de voz (*.tts -alias* <texto> para otra voz, ver *.setvoz list*)",
            "*.pull* p: <pregunta> o1: <op1> o2: <op2>... — encuesta fijada",
          ]);

          const economiaSection = section("🪙", "ECONOMÍA", [
            "*.cartera* [@mención] — saldo disponible (efectivo + banco)",
            "*.dep* <cantidad|todo> — deposita dinero en el banco",
            "*.ret* <cantidad|todo> — retira dinero del banco",
            "*.regalar* @mención <cantidad> — transfiere dinero a otro usuario",
            "*.rankcoins* — ranking global de los más ricos",
            "*.daily* — recompensa diaria",
            "*.work* — trabaja para ganar dinero",
            "*.crimen* — intenta un golpe (puede salir mal)",
            "*.robar* @mención — intenta robarle a otro usuario",
            "*.pescar* — pesca y vende lo que saques",
            "*.minar* — extrae y vende recursos",
            "*.casino* <cantidad> — tragamonedas",
            "*.dado* <cantidad> — tirada de dado contra el bot",
            "*.flip* <cara|cruz> <cantidad> — lanzamiento de moneda",
            "*.blackdice* @mención <cantidad> — duelo de dados contra otro usuario",
            "*.tiendarpg* comprar/vender <cantidad> — cambia monedas por XP o viceversa",
            "*.ranknivel* — ranking global por nivel/XP",
            "*.minivel* — tu nivel y progreso actual",
            "*.vernivel* @mención — nivel de otro usuario",
            "*.niveles* — lista completa de rangos",
            "*.economy* — ver este mismo listado aparte, como comando propio",
          ]);

          const rpgSection = section("🗡️", "RPG — ELYNDOR", [
            "*.rpgon* / *.rpgoff* — activa/desactiva el RPG en este chat (admin del grupo u owner)",
            "*.rpg* — ve TODOS los comandos del sistema RPG (personaje, combate, mazmorras, mercado, gremios, etc.)",
          ]);

          const gachaSection = section("🧩", "GACHA (personajes)", [
            "*.gacha* — menú completo con TODOS los comandos de gacha",
            "*.rw* — tira un waifu/husband aleatorio",
            "*.clain* <nombre> — reclama el personaje tirado",
            "*.harem* [@mención] — ver personajes reclamados",
            "*.wshop* / *.buyc* / *.sell* — mercado de personajes",
            "*.trade* / *.givechar* / *.giveall* — intercambia o regala",
            "*.votar* / *.wtop* — vota y ve el ranking de valor",
          ]);

          const adminSection = section("👮", "ADMINISTRACIÓN DEL GRUPO", [
            "*.agg* <número> — agregar al grupo",
            "*.kick* <número/mención/respuesta> — eliminar del grupo",
            "*.promote* / *.demote* <mención/respuesta> — dar/quitar admin",
            "*.setpp* — cambiar foto del grupo (respondé a una imagen)",
            "*.setname* <texto> — cambiar nombre del grupo",
            "*.setdesc* <texto> — cambiar descripción del grupo",
            "*.open* / *.close* — abrir/cerrar el grupo para escribir",
            "*.link* — link de invitación de este grupo",
            "*.mute* <mención/número/respuesta> <10m/2h/1d> — mutear",
            "*.unmute* <mención/número/respuesta> — sacar el mute",
            "*.clear* — borrar mensajes vistos por el bot en este grupo",
          ]);

          const ownerSection = section("👑", "OWNER", [
            "*.join* <link> — unirse a un grupo",
            "*.admin* — autoascenderte a admin",
            "*.vc* <id de grupo> — vaciar TODO un grupo (sin confirmación)",
            "*.rob* — quitar admin a todos y dárselo al owner (broma)",
            "*.co* <número> / *.co del* <número> / *.co list* — gestionar co-owners",
            "*.group* <mensaje> — mensaje a TODOS los grupos donde soy admin",
            "*.re* — git pull + reiniciar el bot",
            "*.lib* @mención — sacar el LID/JID real de alguien",
            "*.ban* / *.unban* @mención — bloquear/permitir uso del bot",
            "*.set_sug* <id de grupo> — grupo donde llegan las *.sug*",
            "*.diag* — diagnóstico completo del bot y sus comandos",
            "*.libgp* — IDs de los grupos donde está el bot",
            "*.libg* — ID de ESTE grupo",
            "*.linkall* — links de todos los grupos donde soy admin",
            "*.libc* — canales que el bot ha visto pasar",
            "*.set_canal* <jid> — canal para el changelog al reiniciar",
            "*.c* <mensaje> — comunicado al canal, te menciona",
            "*.act* — recargar config.js en caliente",
            "*.ver* — owners/co-owners reconocidos ahora mismo",
            "*.changelog* <texto> — agregar entrada de cambios",
            "*.block* / *.unblock* <id de grupo> — (des)bloquear un grupo para el bot",
            "*.debugadmin* — diagnóstico de admins del grupo",
            "*.setvoz* list / *.setvoz* <alias> <voz> / *.setvoz del* <alias> — voces para *.tts*",
          ]);

          let text =
            `╭───────────────────╮\n` +
            `   🧉 *BOTIFARRA BOT*\n` +
            `╰───────────────────╯\n` +
            `_Prefijo:_ \`.\`   _Escribí *.menu* cuando quieras volver a verlo_\n\n` +
            `${generalSection}\n\n${economiaSection}\n\n${rpgSection}\n\n${gachaSection}\n\n${stickersSection}\n\n${descargasSection}\n\n${extrasSection}`;

          if (senderIsOwnerOrCo) {
            text += `\n\n${adminSection}\n\n${ownerSection}`;
          } else if (senderIsGroupAdmin) {
            text += `\n\n${adminSection}`;
          }

          text += `\n\n_🧉 Botifarra Bot — hecho con cariño (y algo de café)_`;

          await sock.sendMessage(from, { text }, { quoted: msg });
          break;
        }

        default:
          // Cualquier comando que empiece con "rpg" (.rpgon, .rpgcrear,
          // .rpgperfil, .rpgmazmorra, etc.) se maneja acá. Ningún comando
          // de arriba usa ese prefijo, así que esto nunca genera conflicto.
          if (command.startsWith("rpg")) {
            await routeRpgCommand(sock, msg, args, sender, isGroup, senderIsOwnerOrCo, command);
          }
          break;
      }
    } catch (err) {
      console.error("Error procesando comando:", err);
      try {
        await sock.sendMessage(from, { text: `❌ Ocurrió un error: ${err.message}` }, { quoted: msg });
      } catch (sendErr) {
        console.error("Además, no se pudo avisar del error en el chat:", sendErr.message);
      }
    }
  });
}

startBot();
