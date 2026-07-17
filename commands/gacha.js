const { jidToNumber, numberToJid, isOwner } = require("../lib/utils");
const eco = require("../lib/economy");
const gacha = require("../lib/gacha");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function senderNumber(sender) {
  return jidToNumber(sender);
}

function touchProfile(msg, sender) {
  const num = senderNumber(sender);
  eco.getProfile(num, msg.pushName || null);
  return num;
}

function displayName(number) {
  const p = eco.getProfile(number);
  return p?.name ? p.name : `+${number}`;
}

// Detecta @mención o respuesta a un mensaje (no toma números escritos a mano,
// para no confundirlos con IDs de personaje en estos comandos).
function resolveMention(msg) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

  if (mentioned && mentioned.length > 0) {
    return { jid: mentioned[0], number: jidToNumber(mentioned[0]) };
  }
  if (quotedParticipant) {
    return { jid: quotedParticipant, number: jidToNumber(quotedParticipant) };
  }
  return null;
}

// Un ID de instancia son 6 caracteres alfanuméricos (ver gacha.genInstanceId)
const INSTANCE_ID_RE = /^[A-Za-z0-9]{6}$/;

function extractInstanceIds(args) {
  return args.filter((a) => INSTANCE_ID_RE.test(a));
}

function characterCard(character, { header = "", footer = "" } = {}) {
  return (
    `${header}` +
    `✨ *${character.name}*\n` +
    `📺 Serie: _${character.series}_\n` +
    `${gacha.genderLabel(character.gender)}   ${gacha.rarityEmoji(character.rarityKey)} ${character.rarity}\n` +
    `${gacha.starBar(character.stars)}\n\n` +
    `${gacha.statsBlock(character.stats)}\n` +
    `💰 Valor base: ${gacha.formatCoinsPlain(character.baseValue)}\n` +
    `${footer}`
  );
}

// ─────────────────────────────────────────────────────────────
// .rw — tirar un waifu/husband aleatorio
// ─────────────────────────────────────────────────────────────

async function cmdRw(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const profile = gacha.getProfile(num);

  const remaining = gacha.checkCooldown(profile, "rw", gacha.RW_COOLDOWN_MS);
  if (remaining) {
    return sock.sendMessage(
      from,
      { text: `⏳ Todavía no puedes tirar de nuevo. Espera ${gacha.formatCooldown(remaining)}.` },
      { quoted: msg }
    );
  }

  const character = gacha.weightedRandomCharacter();
  gacha.setPendingRoll(from, {
    charId: character.id,
    rolledBy: num,
    expiresAt: Date.now() + gacha.ROLL_EXPIRES_MS,
  });
  gacha.setCooldown(num, "rw");

  const text = characterCard(character, {
    header: `🎴 *¡Nuevo personaje disponible!*\n\n`,
    footer: `\n⏱️ Usa *.clain ${character.name.split(" ")[0]}* dentro de 90s para reclamarlo (cualquiera en el chat puede hacerlo).`,
  });

  await sock.sendMessage(from, { text }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .clain — reclamar el último personaje tirado en el chat
// ─────────────────────────────────────────────────────────────

async function cmdClain(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const pending = gacha.getPendingRoll(from);
  if (!pending) {
    return sock.sendMessage(
      from,
      { text: "❌ No hay ningún personaje disponible para reclamar aquí. Usa *.rw* primero." },
      { quoted: msg }
    );
  }

  if (args.length === 0) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: *.clain <nombre del personaje>* — mira la tarjeta que soltó *.rw* y escribe su nombre." },
      { quoted: msg }
    );
  }

  const character = gacha.getCharacterById(pending.charId);
  const query = args.join(" ").toLowerCase();
  if (!character || !character.name.toLowerCase().includes(query)) {
    return sock.sendMessage(from, { text: "❌ Ese no es el nombre del personaje disponible. Revisa bien e intenta otra vez." }, { quoted: msg });
  }

  const profile = gacha.getProfile(num);
  const remaining = gacha.checkCooldown(profile, "clain", gacha.CLAIM_COOLDOWN_MS);
  if (remaining) {
    return sock.sendMessage(
      from,
      { text: `⏳ Ya reclamaste un personaje hace poco. Espera ${gacha.formatCooldown(remaining)} para volver a reclamar.` },
      { quoted: msg }
    );
  }

  const instance = gacha.grantCharacter(num, character.id);
  gacha.setCooldown(num, "clain");
  gacha.clearPendingRoll(from);

  const text = characterCard(character, {
    header: `🎉 *¡${msg.pushName || "Alguien"} reclamó un personaje!*\n\n`,
    footer: `\n🆔 ID de tu nueva ficha: *${instance.instanceId}*\n(usalo en .harem, .sell, .givechar, .trade, etc.)`,
  });

  await sock.sendMessage(from, { text }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .harem — ver personajes reclamados
// ─────────────────────────────────────────────────────────────

async function cmdHarem(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const target = resolveMention(msg);
  const num = target ? target.number : touchProfile(msg, sender);

  const instances = gacha.getOwnedInstances(num);
  if (instances.length === 0) {
    return sock.sendMessage(
      from,
      { text: `📭 ${target ? "Esa persona no tiene" : "No tienes"} personajes reclamados todavía. Usa *.rw* y *.clain* para conseguir uno.` },
      { quoted: msg, mentions: target ? [target.jid] : [] }
    );
  }

  const rarityRank = { mitica: 5, legendaria: 4, epica: 3, rara: 2, comun: 1 };
  const enriched = instances
    .map((inst) => ({ inst, char: gacha.getCharacterById(inst.charId) }))
    .filter((e) => e.char)
    .sort((a, b) => {
      const r = rarityRank[b.char.rarityKey] - rarityRank[a.char.rarityKey];
      if (r !== 0) return r;
      return gacha.instanceValue(b.inst, b.char) - gacha.instanceValue(a.inst, a.char);
    });

  const totalValue = enriched.reduce((sum, e) => sum + gacha.instanceValue(e.inst, e.char), 0);
  const shown = enriched.slice(0, 15);

  const lines = shown.map(
    (e) =>
      `${gacha.rarityEmoji(e.char.rarityKey)} \`${e.inst.instanceId}\` — *${e.char.name}* (${gacha.starBar(e.char.stars)}) · ${gacha.formatCoinsPlain(
        gacha.instanceValue(e.inst, e.char)
      )}`
  );

  let text =
    `🎭 *Harem de ${target ? displayName(num) : "ti"}* (${instances.length} personaje${instances.length === 1 ? "" : "s"})\n\n` +
    lines.join("\n") +
    `\n\n💰 Valor total: ${gacha.formatCoinsPlain(totalValue)}`;

  if (enriched.length > shown.length) {
    text += `\n\n_...y ${enriched.length - shown.length} más._`;
  }

  await sock.sendMessage(from, { text, mentions: target ? [target.jid] : [] }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .delchar — eliminar un personaje reclamado
// ─────────────────────────────────────────────────────────────

async function cmdDelChar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const id = (args[0] || "").toUpperCase();
  if (!INSTANCE_ID_RE.test(id)) {
    return sock.sendMessage(from, { text: "📌 Uso: *.delchar <ID>* — revisa el ID en *.harem*.\n⚠️ Esto es irreversible." }, { quoted: msg });
  }

  const inst = gacha.findOwnedInstance(num, id);
  if (!inst) {
    return sock.sendMessage(from, { text: "❌ No tienes ningún personaje con ese ID." }, { quoted: msg });
  }
  if (gacha.isListed(id)) {
    return sock.sendMessage(from, { text: "⛔ Ese personaje está publicado en *.wshop*. Retíralo primero (no hay comando de retiro: espera a que se venda o contacta al owner)." }, { quoted: msg });
  }

  const character = gacha.getCharacterById(inst.charId);
  gacha.removeInstance(num, id);

  await sock.sendMessage(from, { text: `🗑️ Eliminaste a *${character ? character.name : id}* de tu harem.` }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .sell / .wshop / .buyc — mercado
// ─────────────────────────────────────────────────────────────

async function cmdSell(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const id = (args[0] || "").toUpperCase();
  const price = parseInt((args[1] || "").replace(/[^0-9]/g, ""), 10);

  if (!INSTANCE_ID_RE.test(id) || !price || price <= 0) {
    return sock.sendMessage(from, { text: "📌 Uso: *.sell <ID> <precio>* — pública un personaje en *.wshop*." }, { quoted: msg });
  }

  const inst = gacha.findOwnedInstance(num, id);
  if (!inst) {
    return sock.sendMessage(from, { text: "❌ No tienes ningún personaje con ese ID." }, { quoted: msg });
  }
  if (gacha.isListed(id)) {
    return sock.sendMessage(from, { text: "⚠️ Ese personaje ya está en venta." }, { quoted: msg });
  }

  const listing = gacha.createListing(num, id, price);
  const character = gacha.getCharacterById(inst.charId);

  await sock.sendMessage(
    from,
    {
      text:
        `🏷️ Publicaste a *${character ? character.name : id}* por ${gacha.formatCoinsPlain(price)}.\n` +
        `🆔 ID de publicación: *${listing.listingId}* (usalo con .buyc para venderlo desde otro chat, o que alguien lo compre con eso).`,
    },
    { quoted: msg }
  );
}

async function cmdWshop(sock, msg) {
  const from = msg.key.remoteJid;
  const market = gacha.getMarket();

  if (market.length === 0) {
    return sock.sendMessage(from, { text: "🛒 No hay personajes en venta ahora mismo. Publica el tuyo con *.sell <ID> <precio>*." }, { quoted: msg });
  }

  const enriched = market
    .map((listing) => {
      const found = gacha.findInstanceAnywhere(listing.instanceId);
      const character = found ? gacha.getCharacterById(found.instance.charId) : null;
      return { listing, character };
    })
    .filter((e) => e.character)
    .sort((a, b) => a.listing.price - b.listing.price);

  const shown = enriched.slice(0, 15);
  const lines = shown.map(
    (e) =>
      `${gacha.rarityEmoji(e.character.rarityKey)} \`${e.listing.listingId}\` — *${e.character.name}* (${gacha.starBar(e.character.stars)}) · ${gacha.formatCoinsPlain(
        e.listing.price
      )} · vende ${displayName(e.listing.sellerNumber)}`
  );

  let text = `🛒 *Tienda de personajes*\n\n${lines.join("\n")}`;
  if (enriched.length > shown.length) {
    text += `\n\n_...y ${enriched.length - shown.length} más._`;
  }
  text += `\n\n📌 Compra con *.buyc <ID de publicación>*`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdBuyc(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const buyer = touchProfile(msg, sender);

  const listingId = (args[0] || "").toUpperCase();
  if (!INSTANCE_ID_RE.test(listingId)) {
    return sock.sendMessage(from, { text: "📌 Uso: *.buyc <ID de publicación>* — mira los IDs en *.wshop*." }, { quoted: msg });
  }

  const listing = gacha.findListing(listingId);
  if (!listing) {
    return sock.sendMessage(from, { text: "❌ Esa publicación ya no existe (puede que la hayan comprado)." }, { quoted: msg });
  }
  if (listing.sellerNumber === buyer) {
    return sock.sendMessage(from, { text: "⛔ No puedes comprar tu propio personaje." }, { quoted: msg });
  }

  const buyerProfile = eco.getProfile(buyer);
  if (buyerProfile.wallet < listing.price) {
    return sock.sendMessage(
      from,
      { text: `⛔ No tienes suficiente efectivo. Necesitas ${gacha.formatCoinsPlain(listing.price)} y tienes ${eco.formatCoins(buyerProfile.wallet)}.` },
      { quoted: msg }
    );
  }

  const found = gacha.findInstanceAnywhere(listing.instanceId);
  if (!found) {
    gacha.removeListing(listingId);
    return sock.sendMessage(from, { text: "❌ Ese personaje ya no existe. Se canceló la publicación." }, { quoted: msg });
  }

  eco.addWallet(buyer, -listing.price);
  eco.addWallet(listing.sellerNumber, listing.price);
  gacha.transferInstance(listing.sellerNumber, buyer, listing.instanceId);
  gacha.removeListing(listingId);

  const character = gacha.getCharacterById(found.instance.charId);
  await sock.sendMessage(
    from,
    { text: `✅ Compraste a *${character ? character.name : listing.instanceId}* por ${gacha.formatCoinsPlain(listing.price)}. ¡Ya está en tu *.harem*!` },
    { quoted: msg }
  );
}

// ─────────────────────────────────────────────────────────────
// .givechar / .giveall — regalos
// ─────────────────────────────────────────────────────────────

async function cmdGiveChar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const target = resolveMention(msg);
  const [id] = extractInstanceIds(args);

  if (!target || !id) {
    return sock.sendMessage(from, { text: "📌 Uso: *.givechar @mención <ID>* — respondé a la persona o mencionala." }, { quoted: msg });
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No puedes regalarte un personaje a ti mismo." }, { quoted: msg });
  }

  const inst = gacha.findOwnedInstance(num, id);
  if (!inst) {
    return sock.sendMessage(from, { text: "❌ No tienes ningún personaje con ese ID." }, { quoted: msg });
  }
  if (gacha.isListed(id)) {
    return sock.sendMessage(from, { text: "⛔ Ese personaje está publicado en *.wshop*, no se puede regalar mientras tanto." }, { quoted: msg });
  }

  gacha.transferInstance(num, target.number, id);
  const character = gacha.getCharacterById(inst.charId);

  await sock.sendMessage(
    from,
    { text: `🎁 Le regalaste a *${character ? character.name : id}* a @${target.number}.`, mentions: [target.jid] },
    { quoted: msg }
  );
}

async function cmdGiveAll(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const target = resolveMention(msg);
  if (!target) {
    return sock.sendMessage(from, { text: "📌 Uso: *.giveall @mención confirmar* — regala TODO tu harem." }, { quoted: msg });
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No puedes regalarte tu harem a ti mismo." }, { quoted: msg });
  }

  const instances = gacha.getOwnedInstances(num);
  if (instances.length === 0) {
    return sock.sendMessage(from, { text: "📭 No tienes personajes para regalar." }, { quoted: msg });
  }

  if (!args.map((a) => a.toLowerCase()).includes("confirmar")) {
    return sock.sendMessage(
      from,
      {
        text:
          `⚠️ Estás por regalar *${instances.length} personaje(s)* completos a @${target.number}. Esto no se puede deshacer.\n` +
          `Si estás seguro, repite el comando agregando *confirmar* al final: *.giveall @mención confirmar*`,
        mentions: [target.jid],
      },
      { quoted: msg }
    );
  }

  const moved = gacha.transferAll(num, target.number);
  await sock.sendMessage(
    from,
    { text: `🎁 Le regalaste tu harem completo (${moved} personajes) a @${target.number}.`, mentions: [target.jid] },
    { quoted: msg }
  );
}

// ─────────────────────────────────────────────────────────────
// .trade — intercambio de personajes entre dos usuarios
// ─────────────────────────────────────────────────────────────

const TRADE_EXPIRES_MS = 10 * 60 * 1000;

async function cmdTrade(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);
  const sub = (args[0] || "").toLowerCase();

  if (sub === "aceptar" || sub === "rechazar") {
    const trade = gacha.getPendingTrade(num);
    if (!trade || Date.now() - trade.createdAt > TRADE_EXPIRES_MS) {
      gacha.clearPendingTrade(num);
      return sock.sendMessage(from, { text: "❌ No tienes ninguna propuesta de intercambio pendiente." }, { quoted: msg });
    }

    if (sub === "rechazar") {
      gacha.clearPendingTrade(num);
      return sock.sendMessage(from, { text: "🚫 Rechazaste el intercambio." }, { quoted: msg });
    }

    // Revalidar que ambas fichas sigan existiendo con sus dueños originales
    const mine = gacha.findOwnedInstance(trade.fromNumber, trade.myInstanceId);
    const theirs = gacha.findOwnedInstance(num, trade.theirInstanceId);
    if (!mine || !theirs) {
      gacha.clearPendingTrade(num);
      return sock.sendMessage(from, { text: "❌ Ese intercambio ya no es válido (alguna ficha cambió de dueño)." }, { quoted: msg });
    }

    gacha.transferInstance(trade.fromNumber, num, trade.myInstanceId);
    gacha.transferInstance(num, trade.fromNumber, trade.theirInstanceId);
    gacha.clearPendingTrade(num);

    const charA = gacha.getCharacterById(mine.charId);
    const charB = gacha.getCharacterById(theirs.charId);
    return sock.sendMessage(
      from,
      { text: `🔄 ¡Intercambio completado! ${charA ? charA.name : trade.myInstanceId} ↔️ ${charB ? charB.name : trade.theirInstanceId}` },
      { quoted: msg }
    );
  }

  // Propuesta nueva
  const target = resolveMention(msg);
  const ids = extractInstanceIds(args);

  if (!target || ids.length < 2) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: *.trade @mención <tu ID> <su ID>* — propone un intercambio.\nLa otra persona confirma con *.trade aceptar* o *.trade rechazar*." },
      { quoted: msg }
    );
  }
  if (target.number === num) {
    return sock.sendMessage(from, { text: "⛔ No puedes hacer trade contigo mismo." }, { quoted: msg });
  }

  const [myId, theirId] = ids;
  const mine = gacha.findOwnedInstance(num, myId);
  const theirs = gacha.findOwnedInstance(target.number, theirId);

  if (!mine) {
    return sock.sendMessage(from, { text: "❌ El primer ID debe ser un personaje TUYO." }, { quoted: msg });
  }
  if (!theirs) {
    return sock.sendMessage(from, { text: "❌ El segundo ID debe ser un personaje de la persona mencionada." }, { quoted: msg });
  }
  if (gacha.isListed(myId) || gacha.isListed(theirId)) {
    return sock.sendMessage(from, { text: "⛔ Una de las fichas está publicada en *.wshop*, retírala del mercado antes de intercambiar." }, { quoted: msg });
  }

  gacha.setPendingTrade(target.number, {
    fromNumber: num,
    myInstanceId: myId.toUpperCase(),
    theirInstanceId: theirId.toUpperCase(),
    createdAt: Date.now(),
  });

  const charA = gacha.getCharacterById(mine.charId);
  const charB = gacha.getCharacterById(theirs.charId);

  await sock.sendMessage(
    from,
    {
      text:
        `🔄 *Propuesta de intercambio*\n@${num} ofrece *${charA.name}* a cambio de *${charB.name}* de @${target.number}.\n\n` +
        `@${target.number}, responde con *.trade aceptar* o *.trade rechazar* (expira en 10 min).`,
      mentions: [target.jid, numberToJid(num)],
    },
    { quoted: msg }
  );
}

// ─────────────────────────────────────────────────────────────
// .votar / .wtop
// ─────────────────────────────────────────────────────────────

async function cmdVotar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = touchProfile(msg, sender);

  const id = (args[0] || "").toUpperCase();
  if (!INSTANCE_ID_RE.test(id)) {
    return sock.sendMessage(from, { text: "📌 Uso: *.votar <ID>* — vota por un personaje reclamado para subir su valor." }, { quoted: msg });
  }

  const found = gacha.findInstanceAnywhere(id);
  if (!found) {
    return sock.sendMessage(from, { text: "❌ No existe ningún personaje reclamado con ese ID." }, { quoted: msg });
  }

  const last = gacha.lastVoteFor(num, id);
  if (last && Date.now() - last < gacha.VOTE_COOLDOWN_MS) {
    const remaining = gacha.VOTE_COOLDOWN_MS - (Date.now() - last);
    return sock.sendMessage(from, { text: `⏳ Ya votaste por ese personaje. Puedes volver a votarlo en ${gacha.formatCooldown(remaining)}.` }, { quoted: msg });
  }

  const instance = gacha.addVote(num, found.owner, id);
  const character = gacha.getCharacterById(instance.charId);

  await sock.sendMessage(
    from,
    {
      text: `👍 Votaste por *${character.name}* (dueño: ${displayName(found.owner)}).\nNuevo valor: ${gacha.formatCoinsPlain(gacha.instanceValue(instance, character))}`,
    },
    { quoted: msg }
  );
}

async function cmdWtop(sock, msg) {
  const from = msg.key.remoteJid;

  const claimsFile = gacha.getAllClaims();
  const rows = [];
  for (const [owner, instances] of Object.entries(claimsFile)) {
    for (const inst of instances) {
      const character = gacha.getCharacterById(inst.charId);
      if (!character) continue;
      rows.push({ owner, inst, character, value: gacha.instanceValue(inst, character) });
    }
  }

  if (rows.length === 0) {
    return sock.sendMessage(from, { text: "📭 Todavía no hay personajes reclamados por nadie." }, { quoted: msg });
  }

  rows.sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 10);

  const lines = top.map(
    (r, i) =>
      `${i + 1}. ${gacha.rarityEmoji(r.character.rarityKey)} *${r.character.name}* — ${gacha.formatCoinsPlain(r.value)} · dueño: ${displayName(r.owner)}`
  );

  await sock.sendMessage(from, { text: `🏆 *Top personajes por valor*\n\n${lines.join("\n")}` }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .newchar — el owner crea personajes nuevos para el pool
// ─────────────────────────────────────────────────────────────

function normalizeRarity(raw) {
  const clean = (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // saca tildes: épica -> epica
  if (["comun", "común"].includes(clean)) return "comun";
  if (clean === "rara") return "rara";
  if (clean === "epica") return "epica";
  if (clean === "legendaria") return "legendaria";
  if (["mitica", "mítica"].includes(clean)) return "mitica";
  return null;
}

async function cmdNewChar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;

  if (!isOwner(sender)) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede crear personajes nuevos." }, { quoted: msg });
  }

  const raw = args.join(" ");
  const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);

  if (parts.length < 4) {
    return sock.sendMessage(
      from,
      {
        text:
          "📌 Uso: *.newchar Nombre | Serie | waifu o husband | rareza*\n" +
          "Rarezas válidas: comun, rara, epica, legendaria, mitica\n\n" +
          "Ejemplo:\n.newchar Akane Fujiwara | Academia Sombraluz | waifu | epica",
      },
      { quoted: msg }
    );
  }

  const [name, series, genderRaw, rarityRaw] = parts;
  const genderClean = genderRaw.toLowerCase();
  const gender = genderClean.startsWith("h") ? "husband" : "waifu";
  const rarityKey = normalizeRarity(rarityRaw);

  if (!rarityKey) {
    return sock.sendMessage(from, { text: "❌ Rareza inválida. Usa: comun, rara, epica, legendaria o mitica." }, { quoted: msg });
  }

  const character = gacha.createCharacter({ name, series, gender, rarityKey });

  const text = characterCard(character, {
    header: `✅ *Personaje agregado al pool*\n\n`,
    footer: `\n🆔 ID de personaje base: *${character.id}* (ya puede salir en .rw)`,
  });

  await sock.sendMessage(from, { text }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .gacha — menú de comandos del sistema de gacha
// ─────────────────────────────────────────────────────────────

async function cmdGachaMenu(sock, msg, sender) {
  const from = msg.key.remoteJid;

  const section = (emoji, title, lines) =>
    `┌ ${emoji} *${title}*\n` + lines.map((l) => `│ ${l}`).join("\n") + `\n└─────────────`;

  const jugar = section("🎴", "GACHA — JUGAR", [
    "*.rw* — tira un waifu/husband aleatorio (cooldown 3 min)",
    "*.clain* <nombre> — reclama el personaje recién tirado (90s)",
    "*.harem* [@mención] — ver personajes reclamados",
    "*.delchar* <ID> — elimina un personaje de tu harem",
  ]);

  const mercado = section("💱", "GACHA — MERCADO", [
    "*.sell* <ID> <precio> — pon un personaje en venta",
    "*.wshop* — ver los personajes en venta",
    "*.buyc* <ID de publicación> — compra un personaje publicado",
  ]);

  const social = section("🤝", "GACHA — SOCIAL", [
    "*.givechar* @mención <ID> — regala un personaje",
    "*.giveall* @mención confirmar — regala TODO tu harem",
    "*.trade* @mención <tu ID> <su ID> — propone un intercambio",
    "*.trade aceptar* / *.trade rechazar* — responde a una propuesta",
  ]);

  const ranking = section("🏆", "GACHA — RANKING", [
    "*.votar* <ID> — vota por un personaje (sube su valor, 1 vez cada 12h)",
    "*.wtop* — top 10 de personajes con mayor valor",
  ]);

  let text = `🧩 *SISTEMA GACHA*\n\n${jugar}\n\n${mercado}\n\n${social}\n\n${ranking}`;

  if (isOwner(sender)) {
    const owner = section("👑", "GACHA — OWNER", [
      "*.newchar Nombre | Serie | waifu/husband | rareza* — crea un personaje nuevo",
      "*.claimpj <ID>* — reclama directo cualquier personaje del pool (ej: c051x)",
    ]);
    text += `\n\n${owner}`;
  }

  await sock.sendMessage(from, { text }, { quoted: msg });
}

// ─────────────────────────────────────────────────────────────
// .claimpj — el owner reclama directamente cualquier personaje del pool
// ─────────────────────────────────────────────────────────────

async function cmdClaimPj(sock, msg, args, sender) {
  const from = msg.key.remoteJid;

  if (!isOwner(sender)) {
    return sock.sendMessage(from, { text: "⛔ Solo el owner puede usar este comando." }, { quoted: msg });
  }

  const num = touchProfile(msg, sender);
  const id = (args[0] || "").toLowerCase();

  if (!id) {
    return sock.sendMessage(
      from,
      { text: "📌 Uso: *.claimpj <ID de personaje>* — ej: .claimpj c051x\nLos IDs base son c001–c050, los creados con .newchar terminan en 'x'." },
      { quoted: msg }
    );
  }

  const character = gacha.getCharacterById(id);
  if (!character) {
    return sock.sendMessage(from, { text: `❌ No existe ningún personaje en el pool con el ID *${id}*.` }, { quoted: msg });
  }

  const instance = gacha.grantCharacter(num, character.id);

  const text = characterCard(character, {
    header: `👑 *Reclamo directo de owner*\n\n`,
    footer: `\n🆔 ID de tu nueva ficha: *${instance.instanceId}*`,
  });

  await sock.sendMessage(from, { text }, { quoted: msg });
}

module.exports = {
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
  cmdGachaMenu,
};
