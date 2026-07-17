const { jidToNumber, numberToJid } = require("../lib/utils");
const eco = require("../lib/economy");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Saca el número del que envía el mensaje (sin @s.whatsapp.net)
function senderNumber(sender) {
  return jidToNumber(sender);
}

// Actualiza el nombre visible (pushName) del que escribió, para que los
// rankings puedan mostrar un nombre en vez de solo el número.
function touchProfile(msg, sender) {
  const num = senderNumber(sender);
  eco.getProfile(num, msg.pushName || null);
  return num;
}

// Resuelve a quién se está apuntando: @mención, respuesta a un mensaje, o
// número escrito a mano como primer argumento.
function resolveTarget(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

  if (mentioned && mentioned.length > 0) {
    return { jid: mentioned[0], number: jidToNumber(mentioned[0]) };
  }
  if (quotedParticipant) {
    return { jid: quotedParticipant, number: jidToNumber(quotedParticipant) };
  }
  const maybeNumber = (args[0] || "").replace(/[^0-9]/g, "");
  if (maybeNumber.length >= 8) {
    return { jid: numberToJid(maybeNumber), number: maybeNumber };
  }
  return null;
}

function displayName(number, profile) {
  return profile?.name ? profile.name : `+${number}`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseAmount(raw, available) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "todo" || lower === "all") return available;
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  if (!n || n <= 0) return null;
  return n;
}

// ─────────────────────────────────────────────────────────────
// Cartera / banco
// ─────────────────────────────────────────────────────────────

async function cmdCartera(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const target = resolveTarget(msg, args);
  const num = target ? target.number : touchProfile(msg, sender);
  const p = eco.getProfile(num);
  const info = eco.getLevelInfo(p.xp);

  const text =
    `👛 *Cartera de ${target ? displayName(num, p) : "ti"}*\n\n` +
    `▸ Efectivo: ${eco.formatCoins(p.wallet)}\n` +
    `▸ Banco: ${eco.formatCoins(p.bank)}\n` +
    `▸ Total: ${eco.formatCoins(p.wallet + p.bank)}\n` +
    `▸ Nivel: ${info.level} — ${info.name}`;

  await sock.sendMessage(from, { text, mentions: target ? [target.jid] : [] }, { quoted: msg });
}

async function cmdDeposit(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const amount = parseAmount(args[0], p.wallet);
  if (!amount) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .dep <cantidad|todo>\nMueve dinero de tu efectivo al banco (a salvo de robos)." },
      { quoted: msg }
    );
  }
  if (amount > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }

  p.wallet -= amount;
  p.bank += amount;
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `🏦 Depositaste ${eco.formatCoins(amount)}.\nBanco: ${eco.formatCoins(p.bank)} | Efectivo: ${eco.formatCoins(p.wallet)}` },
    { quoted: msg }
  );
}

async function cmdWithdraw(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const amount = parseAmount(args[0], p.bank);
  if (!amount) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .ret <cantidad|todo>\nSaca dinero del banco para poder gastarlo." },
      { quoted: msg }
    );
  }
  if (amount > p.bank) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente en el banco. Tienes ${eco.formatCoins(p.bank)}.` }, { quoted: msg });
  }

  p.bank -= amount;
  p.wallet += amount;
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `💵 Retiraste ${eco.formatCoins(amount)}.\nEfectivo: ${eco.formatCoins(p.wallet)} | Banco: ${eco.formatCoins(p.bank)}` },
    { quoted: msg }
  );
}

async function cmdRegalar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const target = resolveTarget(msg, args);
  if (!target) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: .regalar @mención <cantidad>\nTambién podés responder a un mensaje suyo." },
      { quoted: msg }
    );
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No podés regalarte dinero a ti mismo." }, { quoted: msg });
  }

  // El monto puede venir como args[0] (si se usó número escrito) o args[1] (si se usó mención/respuesta)
  const amountArg = /^[0-9]+$/.test((args[0] || "").replace(/[^0-9]/g, "")) && !msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length
    ? args[1]
    : args[args.length - 1];
  const amount = parseAmount(amountArg, p.wallet);

  if (!amount) {
    return sock.sendMessage(from, { text: "📌 Uso: .regalar @mención <cantidad>" }, { quoted: msg });
  }
  if (amount > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }

  p.wallet -= amount;
  eco.saveProfile(num, p);
  eco.addWallet(target.number, amount);

  await sock.sendMessage(
    from,
    { text: `🎁 Le regalaste ${eco.formatCoins(amount)} a @${target.number}.`, mentions: [target.jid] },
    { quoted: msg }
  );
}

async function cmdRankCoins(sock, msg) {
  const from = msg.key.remoteJid;
  const top = eco.topByWallet(10);

  if (top.length === 0) {
    return sock.sendMessage(from, { text: "📊 Todavía nadie tiene saldo registrado." }, { quoted: msg });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((u, i) => {
    const tag = medals[i] || `${i + 1}.`;
    return `${tag} ${displayName(u.number, { name: u.name })} — ${eco.formatCoins(u.total)}`;
  });

  await sock.sendMessage(from, { text: `🏆 *RANKING DE RIQUEZA*\n\n${lines.join("\n")}` }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// Ingresos: daily, work, crimen, robar, pescar, minar
// ─────────────────────────────────────────────────────────────

async function cmdDaily(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const remaining = eco.checkCooldown(p, "daily", 24 * 60 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Ya reclamaste tu recompensa diaria. Vuelve en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const reward = randInt(200, 500);
  p.wallet += reward;
  p.xp += 20;
  eco.setCooldown(num, "daily");
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `🎁 *Recompensa diaria reclamada*\n+${eco.formatCoins(reward)}\n+20 XP\n\nEfectivo: ${eco.formatCoins(p.wallet)}` },
    { quoted: msg }
  );
}

const JOBS = [
  "repartiste pedidos en bicicleta",
  "arreglaste una cañería",
  "diste clases particulares",
  "programaste un bot para un cliente",
  "atendiste un local de comida",
  "hiciste de guardia de seguridad",
  "lavaste autos en la esquina",
  "ayudaste en una mudanza",
];

async function cmdWork(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const remaining = eco.checkCooldown(p, "work", 60 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Estás cansado del último trabajo. Podés volver a trabajar en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const job = JOBS[randInt(0, JOBS.length - 1)];
  const reward = randInt(80, 260);
  p.wallet += reward;
  p.xp += 10;
  eco.setCooldown(num, "work");
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `💼 Hoy ${job} y ganaste ${eco.formatCoins(reward)}.\n+10 XP\n\nEfectivo: ${eco.formatCoins(p.wallet)}` },
    { quoted: msg }
  );
}

async function cmdCrimen(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const remaining = eco.checkCooldown(p, "crimen", 45 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Estás escondido de la última vez. Podés intentar otro crimen en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  eco.setCooldown(num, "crimen");
  const success = Math.random() < 0.5;

  if (success) {
    const reward = randInt(150, 420);
    p.wallet += reward;
    p.xp += 15;
    eco.saveProfile(num, p);
    return sock.sendMessage(
      from,
      { text: `🕵️ El golpe salió perfecto. Ganaste ${eco.formatCoins(reward)}.\n+15 XP` },
      { quoted: msg }
    );
  }

  const fine = Math.min(p.wallet, randInt(100, 260));
  p.wallet -= fine;
  eco.saveProfile(num, p);
  await sock.sendMessage(
    from,
    { text: `🚨 Te atraparon con las manos en la masa. Pagaste una multa de ${eco.formatCoins(fine)}.` },
    { quoted: msg }
  );
}

async function cmdRobar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const target = resolveTarget(msg, args);
  if (!target) {
    return sock.sendMessage(from, { text: "📌 Uso: .robar @mención\nTambién podés responder a un mensaje suyo." }, { quoted: msg });
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No puedes robarte a ti mismo." }, { quoted: msg });
  }

  const remaining = eco.checkCooldown(p, "robar", 60 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Todavía te reconocen del último robo. Intenta de nuevo en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const victim = eco.getProfile(target.number);
  if (victim.wallet < 50) {
    return sock.sendMessage(from, { text: `⛔ @${target.number} no trae suficiente efectivo encima para valer la pena.`, mentions: [target.jid] }, { quoted: msg });
  }
  if (p.wallet < 30) {
    return sock.sendMessage(from, { text: "⛔ Necesitas al menos 🪙 30 en efectivo para intentar el robo (por si te atrapan)." }, { quoted: msg });
  }

  eco.setCooldown(num, "robar");
  const success = Math.random() < 0.4;

  if (success) {
    const stolen = Math.min(victim.wallet, Math.round(victim.wallet * (randInt(10, 30) / 100)));
    victim.wallet -= stolen;
    eco.saveProfile(target.number, victim);
    p.wallet += stolen;
    p.xp += 15;
    eco.saveProfile(num, p);
    return sock.sendMessage(
      from,
      { text: `🥷 Le robaste ${eco.formatCoins(stolen)} a @${target.number}.\n+15 XP`, mentions: [target.jid] },
      { quoted: msg }
    );
  }

  const fine = Math.min(p.wallet, randInt(50, 150));
  p.wallet -= fine;
  eco.saveProfile(num, p);
  await sock.sendMessage(
    from,
    { text: `🚨 @${target.number} te descubrió antes de tiempo. Pagaste ${eco.formatCoins(fine)} de multa.`, mentions: [target.jid] },
    { quoted: msg }
  );
}

const FISH = [
  { name: "una bota vieja", min: 0, max: 10 },
  { name: "una sardina", min: 20, max: 60 },
  { name: "una trucha", min: 60, max: 120 },
  { name: "un salmón enorme", min: 120, max: 220 },
];

async function cmdPescar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const remaining = eco.checkCooldown(p, "pescar", 8 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Tu equipo de pesca está guardado todavía. Vuelve en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const catchItem = FISH[randInt(0, FISH.length - 1)];
  const reward = randInt(catchItem.min, catchItem.max);
  p.wallet += reward;
  p.xp += 8;
  eco.setCooldown(num, "pescar");
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `🎣 Pescaste ${catchItem.name} y la vendiste por ${eco.formatCoins(reward)}.\n+8 XP` },
    { quoted: msg }
  );
}

const ORES = [
  { name: "piedra sin valor", min: 0, max: 15 },
  { name: "vetas de cobre", min: 30, max: 80 },
  { name: "vetas de plata", min: 80, max: 160 },
  { name: "un diamante en bruto", min: 160, max: 300 },
];

async function cmdMinar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const remaining = eco.checkCooldown(p, "minar", 10 * 60 * 1000);
  if (remaining) {
    return sock.sendMessage(from, { text: `⏳ Tu pico necesita descansar. Vuelve en ${eco.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const ore = ORES[randInt(0, ORES.length - 1)];
  const reward = randInt(ore.min, ore.max);
  p.wallet += reward;
  p.xp += 8;
  eco.setCooldown(num, "minar");
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    { text: `⛏️ Encontraste ${ore.name} y la vendiste por ${eco.formatCoins(reward)}.\n+8 XP` },
    { quoted: msg }
  );
}

// ─────────────────────────────────────────────────────────────
// Juegos de azar: casino, dado, flip, blackdice
// ─────────────────────────────────────────────────────────────

async function cmdCasino(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const bet = parseAmount(args[0], p.wallet);
  if (!bet) {
    return sock.sendMessage(from, { text: "📌 Uso: .casino <cantidad>\nApuesta en la tragamonedas: podés perderlo todo o ganar hasta 5x." }, { quoted: msg });
  }
  if (bet > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }

  const symbols = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];
  const roll = [0, 1, 2].map(() => symbols[randInt(0, symbols.length - 1)]);

  let multiplier = 0;
  if (roll[0] === roll[1] && roll[1] === roll[2]) {
    multiplier = roll[0] === "7️⃣" ? 5 : 3;
  } else if (roll[0] === roll[1] || roll[1] === roll[2] || roll[0] === roll[2]) {
    multiplier = 1.5;
  }

  const winnings = Math.round(bet * multiplier);
  p.wallet = p.wallet - bet + winnings;
  eco.saveProfile(num, p);

  const resultLine =
    multiplier === 0
      ? `Perdiste tu apuesta de ${eco.formatCoins(bet)}.`
      : `¡Ganaste ${eco.formatCoins(winnings)}! (x${multiplier})`;

  await sock.sendMessage(
    from,
    { text: `🎰 [ ${roll.join(" | ")} ]\n\n${resultLine}\n\nEfectivo: ${eco.formatCoins(p.wallet)}` },
    { quoted: msg }
  );
}

async function cmdDado(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const bet = parseAmount(args[0], p.wallet);
  if (!bet) {
    return sock.sendMessage(from, { text: "📌 Uso: .dado <cantidad>\nTiras un dado contra el bot: el que saque más alto gana." }, { quoted: msg });
  }
  if (bet > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }

  const you = randInt(1, 6);
  const bot = randInt(1, 6);

  let text = `🎲 Tiraste un *${you}*, el bot tiró un *${bot}*.\n\n`;
  if (you > bot) {
    p.wallet += bet;
    text += `¡Ganaste ${eco.formatCoins(bet)}!`;
  } else if (you < bot) {
    p.wallet -= bet;
    text += `Perdiste ${eco.formatCoins(bet)}.`;
  } else {
    text += `Empate, recuperas tu apuesta.`;
  }
  eco.saveProfile(num, p);
  text += `\n\nEfectivo: ${eco.formatCoins(p.wallet)}`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdFlip(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const choice = (args[0] || "").toLowerCase();
  const bet = parseAmount(args[1], p.wallet);

  if (!["cara", "cruz"].includes(choice) || !bet) {
    return sock.sendMessage(from, { text: "📌 Uso: .flip <cara|cruz> <cantidad>" }, { quoted: msg });
  }
  if (bet > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }

  const result = Math.random() < 0.5 ? "cara" : "cruz";
  const win = result === choice;

  p.wallet += win ? bet : -bet;
  eco.saveProfile(num, p);

  await sock.sendMessage(
    from,
    {
      text:
        `🪙 La moneda cayó en *${result}*.\n\n` +
        (win ? `¡Ganaste ${eco.formatCoins(bet)}!` : `Perdiste ${eco.formatCoins(bet)}.`) +
        `\n\nEfectivo: ${eco.formatCoins(p.wallet)}`,
    },
    { quoted: msg }
  );
}

async function cmdBlackdice(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const target = resolveTarget(msg, args);
  if (!target) {
    return sock.sendMessage(from, { text: "📌 Uso: .blackdice @mención <cantidad>\nRetas a alguien a una tirada de dados por dinero." }, { quoted: msg });
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No puedes retarte a ti mismo." }, { quoted: msg });
  }

  const amountArg = args.find((a) => /^[0-9]+$/.test(a.replace(/[^0-9]/g, "")));
  const bet = parseAmount(amountArg, p.wallet);
  if (!bet) {
    return sock.sendMessage(from, { text: "📌 Uso: .blackdice @mención <cantidad>" }, { quoted: msg });
  }

  const opponent = eco.getProfile(target.number);
  if (bet > p.wallet) {
    return sock.sendMessage(from, { text: `⛔ No tienes suficiente efectivo. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
  }
  if (bet > opponent.wallet) {
    return sock.sendMessage(from, { text: `⛔ @${target.number} no tiene suficiente efectivo para cubrir esa apuesta.`, mentions: [target.jid] }, { quoted: msg });
  }

  const rollA = randInt(1, 6);
  const rollB = randInt(1, 6);

  let resultText;
  if (rollA === rollB) {
    resultText = `Empate 🤝 (${rollA} vs ${rollB}). Nadie pierde nada.`;
  } else {
    const houseCut = Math.round(bet * 0.05); // 5% de comisión de la casa
    const pot = bet * 2 - houseCut;
    if (rollA > rollB) {
      p.wallet += bet - houseCut;
      opponent.wallet -= bet;
      resultText = `Tiraste *${rollA}* contra *${rollB}* de @${target.number}. ¡Ganaste ${eco.formatCoins(pot)}!`;
    } else {
      opponent.wallet += bet - houseCut;
      p.wallet -= bet;
      resultText = `@${target.number} tiró *${rollB}* contra tu *${rollA}*. Perdiste ${eco.formatCoins(bet)}.`;
    }
    eco.saveProfile(target.number, opponent);
  }

  eco.saveProfile(num, p);
  await sock.sendMessage(from, { text: `🎲⚔️ *BLACKDICE*\n\n${resultText}`, mentions: [target.jid] }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// Tienda RPG: intercambia monedas por XP o viceversa
// ─────────────────────────────────────────────────────────────

const XP_BUY_RATE = 20; // cuesta 20 monedas comprar 1 xp
const XP_SELL_RATE = 8; // vender 1 xp da 8 monedas

async function cmdTiendaRpg(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);

  const sub = (args[0] || "").toLowerCase();
  const amount = parseInt(args[1], 10);

  if (!["comprar", "vender"].includes(sub) || !amount || amount <= 0) {
    return sock.sendMessage(
      from,
      {
        text:
          `🏪 *TIENDA RPG*\n\n` +
          `▸ .tiendarpg comprar <cantidad> — cambia monedas por XP (🪙 ${XP_BUY_RATE} = 1 XP)\n` +
          `▸ .tiendarpg vender <cantidad> — cambia XP por monedas (1 XP = 🪙 ${XP_SELL_RATE})`,
      },
      { quoted: msg }
    );
  }

  if (sub === "comprar") {
    const cost = amount * XP_BUY_RATE;
    if (cost > p.wallet) {
      return sock.sendMessage(from, { text: `⛔ Necesitas ${eco.formatCoins(cost)} para comprar ${amount} XP. Tienes ${eco.formatCoins(p.wallet)}.` }, { quoted: msg });
    }
    p.wallet -= cost;
    p.xp += amount;
    eco.saveProfile(num, p);
    return sock.sendMessage(from, { text: `✅ Compraste ${amount} XP por ${eco.formatCoins(cost)}.` }, { quoted: msg });
  }

  // vender
  if (amount > p.xp) {
    return sock.sendMessage(from, { text: `⛔ No tienes ${amount} XP para vender. Tienes ${p.xp} XP.` }, { quoted: msg });
  }
  const income = amount * XP_SELL_RATE;
  p.xp -= amount;
  p.wallet += income;
  eco.saveProfile(num, p);
  await sock.sendMessage(from, { text: `✅ Vendiste ${amount} XP por ${eco.formatCoins(income)}.` }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// Niveles
// ─────────────────────────────────────────────────────────────

async function cmdRankNivel(sock, msg) {
  const from = msg.key.remoteJid;
  const top = eco.topByXp(10);

  if (top.length === 0) {
    return sock.sendMessage(from, { text: "📊 Todavía nadie tiene XP registrada." }, { quoted: msg });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((u, i) => {
    const info = eco.getLevelInfo(u.xp);
    const tag = medals[i] || `${i + 1}.`;
    return `${tag} ${displayName(u.number, { name: u.name })} — Nv. ${info.level} (${info.name}) · ${u.xp} XP`;
  });

  await sock.sendMessage(from, { text: `📈 *RANKING DE NIVELES*\n\n${lines.join("\n")}` }, { quoted: msg });
}

async function cmdMiNivel(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const p = eco.getProfile(num);
  const info = eco.getLevelInfo(p.xp);

  const progress = info.isMax
    ? "Nivel máximo alcanzado 🏅"
    : `${info.xpIntoLevel} / ${info.xpForNext} XP para *${info.nextName}*`;

  await sock.sendMessage(
    from,
    { text: `📊 *Tu nivel*\n\n▸ Nivel ${info.level} — ${info.name}\n▸ XP total: ${info.xp}\n▸ Progreso: ${progress}` },
    { quoted: msg }
  );
}

async function cmdVerNivel(sock, msg, args) {
  const from = msg.key.remoteJid;
  const target = resolveTarget(msg, args);
  if (!target) {
    return sock.sendMessage(from, { text: "📌 Uso: .vernivel @mención\nTambién podés responder a un mensaje suyo." }, { quoted: msg });
  }

  const p = eco.getProfile(target.number);
  const info = eco.getLevelInfo(p.xp);
  const progress = info.isMax
    ? "Nivel máximo alcanzado 🏅"
    : `${info.xpIntoLevel} / ${info.xpForNext} XP para *${info.nextName}*`;

  await sock.sendMessage(
    from,
    {
      text: `📊 *Nivel de @${target.number}*\n\n▸ Nivel ${info.level} — ${info.name}\n▸ XP total: ${info.xp}\n▸ Progreso: ${progress}`,
      mentions: [target.jid],
    },
    { quoted: msg }
  );
}

async function cmdNiveles(sock, msg) {
  const from = msg.key.remoteJid;
  const lines = eco.RANKS.map((r) => `▸ Nv. ${r.level} — *${r.name}* (${r.xpRequired} XP)`);
  await sock.sendMessage(from, { text: `🏅 *RANGOS DISPONIBLES*\n\n${lines.join("\n")}` }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .economy — menú con todos los comandos de economía
// ─────────────────────────────────────────────────────────────

async function cmdEconomyMenu(sock, msg) {
  const from = msg.key.remoteJid;

  const section = (emoji, title, lines) =>
    `┌ ${emoji} *${title}*\n` + lines.map((l) => `│ ${l}`).join("\n") + `\n└─────────────`;

  const cartera = section("👛", "ECONOMÍA — CARTERA", [
    "*.cartera* [@mención] — saldo disponible (efectivo + banco)",
    "*.dep* <cantidad|todo> — deposita dinero en el banco",
    "*.ret* <cantidad|todo> — retira dinero del banco",
    "*.regalar* @mención <cantidad> — transfiere dinero a otro usuario",
    "*.rankcoins* — ranking global de los más ricos",
  ]);

  const ingresos = section("💼", "ECONOMÍA — GANAR DINERO", [
    "*.daily* — recompensa diaria",
    "*.work* — trabaja para ganar dinero",
    "*.crimen* — intenta un golpe (puede salir mal)",
    "*.robar* @mención — intenta robarle a otro usuario",
    "*.pescar* — pesca y vende lo que saques",
    "*.minar* — extrae y vende recursos",
  ]);

  const juegos = section("🎲", "ECONOMÍA — JUEGOS", [
    "*.casino* <cantidad> — tragamonedas",
    "*.dado* <cantidad> — tirada de dado contra el bot",
    "*.flip* <cara|cruz> <cantidad> — lanzamiento de moneda",
    "*.blackdice* @mención <cantidad> — duelo de dados contra otro usuario",
  ]);

  const niveles = section("🏅", "ECONOMÍA — NIVELES", [
    "*.tiendarpg* comprar/vender <cantidad> — cambia monedas por XP o viceversa",
    "*.ranknivel* — ranking global por nivel/XP",
    "*.minivel* — tu nivel y progreso actual",
    "*.vernivel* @mención — nivel de otro usuario",
    "*.niveles* — lista completa de rangos",
  ]);

  const text =
    `🪙 *SISTEMA DE ECONOMÍA*\n\n${cartera}\n\n${ingresos}\n\n${juegos}\n\n${niveles}` +
    `\n\n_Tip: tu dinero también sirve para comprar personajes en *.gacha* → .wshop_`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

module.exports = {
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
};
