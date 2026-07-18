// ═════════════════════════════════════════════════════════════════════════
// commands/rpg.js
// Sistema RPG completo de "Elyndor" para Botifarra.
//
// TODOS los comandos de este sistema empiezan con el prefijo "rpg"
// (.rpgon, .rpgcrear, .rpgperfil, etc.) -- eso garantiza que NUNCA choquen
// con ningún comando ya existente del bot (ninguno de los comandos actuales
// usa ese prefijo, ver index.js).
//
// index.js solo necesita UNA línea nueva en el switch (dentro del `default`)
// que llame a routeRpgCommand(...) cuando el comando escrito empiece con
// "rpg". Todo el resto de la lógica vive acá adentro.
//
// .rpgon / .rpgoff activan o desactivan el sistema en el chat actual (grupo
// o privado). Mientras está apagado, el resto de comandos .rpg* no hacen
// nada (piden que se active con .rpgon primero).
// ═════════════════════════════════════════════════════════════════════════

const { jidToNumber, numberToJid, isParticipantAdmin } = require("../lib/utils");
const rpg = require("../lib/rpg");
const { askAI, extractJson } = require("../lib/aiClient");
const rpgAi = require("../lib/rpgAiCreator");
const customContent = require("../lib/customRpgContent");
const data = require("../lib/rpgData");

const PREFIX = "."; // solo para textos de ayuda

// ─────────────────────────────────────────────────────────────
// Helpers compartidos
// ─────────────────────────────────────────────────────────────

function senderNumber(sender) {
  return jidToNumber(sender);
}

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

function reply(sock, from, msg, text, mentions) {
  return sock.sendMessage(from, { text, mentions: mentions || [] }, { quoted: msg });
}

function itemLabel(itemId, qty) {
  const it = data.ITEMS[itemId];
  if (!it) return `${itemId} x${qty}`;
  const r = data.RARITY[it.rarity];
  return `${it.emoji} ${it.name} ${r ? r.emoji : ""} x${qty}`;
}

function hpBar(current, max, size = 10) {
  const ratio = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * size);
  return "🟩".repeat(filled) + "⬛".repeat(size - filled);
}

// Guardas comunes
function requireCharacter(number) {
  return rpg.hasCharacter(number);
}

const NO_CHAR_TEXT =
  `📜 Todavía no tienes personaje en Elyndor.\n` +
  `Crea uno con: *${PREFIX}rpgcrear <raza> <clase>*\n` +
  `Ejemplo: *${PREFIX}rpgcrear elfo mago*\n\n` +
  `Ve las razas con *${PREFIX}rpgrazas* y las clases con *${PREFIX}rpgclases*.`;

// ─────────────────────────────────────────────────────────────
// .rpgon / .rpgoff
// ─────────────────────────────────────────────────────────────

async function canToggle(sock, isGroup, from, sender, senderIsOwnerOrCo) {
  if (senderIsOwnerOrCo) return true;
  if (!isGroup) return true; // en privado, cualquiera controla su propio chat
  try {
    return await isParticipantAdmin(sock, from, sender);
  } catch {
    return false;
  }
}

async function cmdRpgOn(sock, msg, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  const allowed = await canToggle(sock, isGroup, from, sender, senderIsOwnerOrCo);
  if (!allowed) {
    return reply(sock, from, msg, "⛔ Solo un admin del grupo (o el owner del bot) puede activar el RPG acá.");
  }
  rpg.enabledChats.enable(from);
  return reply(
    sock,
    from,
    msg,
    `🗺️ *¡El sistema RPG de Elyndor ha sido activado en este chat!*\n\n` +
      `Empieza tu aventura con *${PREFIX}rpgcrear <raza> <clase>*\n` +
      `Mira todos los comandos con *${PREFIX}rpg*`
  );
}

async function cmdRpgOff(sock, msg, isGroup, sender, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  const allowed = await canToggle(sock, isGroup, from, sender, senderIsOwnerOrCo);
  if (!allowed) {
    return reply(sock, from, msg, "⛔ Solo un admin del grupo (o el owner del bot) puede desactivar el RPG acá.");
  }
  rpg.enabledChats.disable(from);
  return reply(sock, from, msg, `🛑 Sistema RPG desactivado en este chat. Los personajes NO se pierden, solo quedan pausados acá.`);
}

// ─────────────────────────────────────────────────────────────
// Ayuda / menú
// ─────────────────────────────────────────────────────────────

async function cmdRpgHelp(sock, msg) {
  const from = msg.key.remoteJid;
  const on = rpg.enabledChats.isEnabled(from);
  const text =
    `╭──────────────────────╮\n` +
    `   🗡️ *RPG DE ELYNDOR* 🗡️\n` +
    `╰──────────────────────╯\n` +
    `Estado en este chat: ${on ? "🟢 ACTIVADO" : "🔴 DESACTIVADO"} (*.rpgon* / *.rpgoff*)\n\n` +
    `┌ 👤 *PERSONAJE*\n` +
    `│ .rpgcrear <raza> <clase>\n│ .rpgperfil [@mención]\n│ .rpgstats\n│ .rpgsubir <atributo>\n` +
    `│ .rpgrazas · .rpgclases · .rpgdioses\n│ .rpgorar <dios>\n│ .rpgascender\n` +
    `└─────────────\n` +
    `┌ 🎒 *INVENTARIO*\n` +
    `│ .rpginventario\n│ .rpgequipar <item>\n│ .rpgdesequipar <slot>\n│ .rpgusar <item>\n│ .rpgtirar <item> [cant]\n` +
    `└─────────────\n` +
    `┌ 🌍 *MUNDO*\n` +
    `│ .rpgregiones\n│ .rpgviajar <región>\n│ .rpgexplorar\n│ .rpgcazar\n` +
    `└─────────────\n` +
    `┌ ⚔️ *COMBATE*\n` +
    `│ .rpgduelo @mención\n│ .rpgmazmorras\n│ .rpgmazmorra <nombre>\n│ .rpgrevivir\n` +
    `└─────────────\n` +
    `┌ 🪙 *ECONOMÍA*\n` +
    `│ .rpgtiendanpc · .rpgcomprarnpc <item>\n│ .rpgmercado · .rpgvender <item> <precio>\n` +
    `│ .rpgcomprar <id> · .rpgcancelarventa <id>\n` +
    `│ .rpgsubasta <item> <precio> <horas> · .rpgsubastas · .rpgpujar <id> <monto>\n` +
    `│ .rpgforjar <receta> · .rpgrecetas\n` +
    `└─────────────\n` +
    `┌ 📜 *MISIONES*\n` +
    `│ .rpgmisiones\n│ .rpgreclamar <id>\n│ .rpgreputacion\n` +
    `└─────────────\n` +
    `┌ 🛡️ *GREMIOS*\n` +
    `│ .rpggremio crear <nombre>\n│ .rpggremio invitar @mención\n│ .rpggremio salir\n│ .rpggremio info [nombre]\n│ .rpggremios\n` +
    `└─────────────\n` +
    `┌ 🏆 *RANKING*\n` +
    `│ .rpgranking <nivel|oro|pvp>\n` +
    `└─────────────\n` +
    `┌ 🛠️ *ADMIN (owner/co-owner)*\n` +
    `│ .rpgcrearclase <clave> | <desc>\n│ .rpgcrearraza <clave> | <desc>\n` +
    `│ .rpgmodclase <clave> | <desc>\n│ .rpgmodraza <clave> | <desc>\n` +
    `│ .rpgborrarclase <clave>\n│ .rpgborrarraza <clave>\n` +
    `│ .rpgadmin daroro|daritem|setnivel|reset @mención ...\n` +
    `└─────────────\n` +
    (
      `\n_Elyndor te espera, aventurero. Escribí *.rpgcrear* para empezar._`
    );
  return reply(sock, from, msg, text);
}

// ─────────────────────────────────────────────────────────────
// PERSONAJE
// ─────────────────────────────────────────────────────────────

async function cmdRpgCrear(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (requireCharacter(num)) {
    return reply(sock, from, msg, "⛔ Ya tienes un personaje en Elyndor. Usa *.rpgperfil* para verlo.");
  }
  const raceKey = (args[0] || "").toLowerCase();
  const classKey = (args[1] || "").toLowerCase();
  const race = data.RACES[raceKey];
  const cls = data.CLASSES[classKey];

  if (!race || !cls || cls.tier !== "inicial") {
    return reply(
      sock,
      from,
      msg,
      `📌 Uso: *.rpgcrear <raza> <clase>*\n` +
        `Ejemplo: *.rpgcrear elfo mago*\n\n` +
        `Razas: ${Object.keys(data.RACES).join(", ")}\n` +
        `Clases iniciales: ${Object.values(data.CLASSES).filter((c) => c.tier === "inicial").map((c) => Object.keys(data.CLASSES).find((k) => data.CLASSES[k] === c)).join(", ")}`
    );
  }

  const profile = rpg.createCharacter(num, msg.pushName || `+${num}`, raceKey, classKey);
  rpg.refreshQuests(num);
  const d = rpg.computeDerived(profile);

  const text =
    `✨ *¡Un nuevo héroe nace en Elyndor!* ✨\n\n` +
    `${race.emoji} *${race.name}* — ${cls.emoji} *${cls.name}*\n` +
    `_${race.desc}_\n_${cls.desc}_\n\n` +
    `❤️ Vida: ${d.maxHp}  |  🔵 Maná: ${d.maxMana}\n` +
    `⚔️ Ataque: ${d.atk}  |  🛡️ Defensa: ${d.def}\n\n` +
    `Empezaste en *🏰 Valdorien* con ${rpg.formatGold(profile.gold)} y equipo básico.\n` +
    `Usa *.rpgperfil* para ver tu ficha completa, o *.rpgexplorar* para tu primera aventura.`;
  return reply(sock, from, msg, text);
}

async function cmdRpgPerfil(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const target = resolveTarget(msg, args);
  const num = target ? target.number : senderNumber(sender);
  if (!requireCharacter(num)) {
    return reply(sock, from, msg, target ? "⛔ Esa persona no tiene personaje en Elyndor." : NO_CHAR_TEXT);
  }
  if (!target) rpg.touchName(num, msg.pushName || null);
  const p = rpg.getProfile(num);
  const race = data.RACES[p.race];
  const cls = data.CLASSES[p.class];
  const god = p.god ? data.GODS[p.god] : null;
  const d = rpg.computeDerived(p);
  const region = data.REGIONS[p.region];
  const next = rpg.xpThreshold(p.level + 1);

  const text =
    `📜 *Ficha de ${p.name}*\n\n` +
    `${race.emoji} ${race.name} — ${cls.emoji} ${cls.name}\n` +
    `${p.alive ? "🟢 Con vida" : "💀 CAÍDO (usa .rpgrevivir)"}\n` +
    `⭐ Nivel ${p.level}  |  XP: ${p.xp}/${p.level >= rpg.MAX_LEVEL ? "MAX" : next}\n` +
    `${hpBar(p.hpCurrent, d.maxHp)} ${Math.round(p.hpCurrent)}/${d.maxHp} HP\n\n` +
    `💪 Fue ${p.attrs.fue}  🏹 Des ${p.attrs.des}  🩸 Con ${p.attrs.con}\n` +
    `🧠 Int ${p.attrs.int}  🦉 Sab ${p.attrs.sab}  🎭 Car ${p.attrs.car}\n` +
    `${p.freePoints > 0 ? `✨ Puntos libres: ${p.freePoints} (usa *.rpgsubir <atributo>*)\n` : ""}\n` +
    `⚔️ Atk ${d.atk}  🛡️ Def ${d.def}  🔮 Mag ${d.mag}  🎯 Crit ${d.crit}%\n\n` +
    `${region.emoji} Región: ${region.name}\n` +
    `${god ? `${god.emoji} Devoto de ${god.name}` : "🚫 Sin dios elegido (usa .rpgorar <dios>)"}\n` +
    `⚜️ Oro: ${rpg.formatGold(p.gold)}\n` +
    `${p.guild ? `🛡️ Gremio: ${p.guild}` : ""}\n\n` +
    `🗡️ Monstruos: ${p.stats.monstersKilled}  🏰 Mazmorras: ${p.stats.dungeonsCleared}  ⚔️ PvP: ${p.stats.pvpWins}V/${p.stats.pvpLosses}D  💀 Muertes: ${p.stats.deaths}`;

  return reply(sock, from, msg, text, target ? [target.jid] : []);
}

async function cmdRpgStats(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  const d = rpg.computeDerived(p);
  const w = rpg.currentWeight(p);
  const mw = rpg.maxWeight(p);
  const text =
    `📊 *Estadísticas de combate — ${p.name}*\n\n` +
    `⚔️ Ataque físico: ${d.atk}\n🔮 Poder mágico: ${d.mag}\n🛡️ Defensa: ${d.def}\n🎯 Crítico: ${d.crit}%\n` +
    `❤️ Vida máxima: ${d.maxHp}\n🔵 Maná máximo: ${d.maxMana}\n\n` +
    `🎒 Peso: ${w}/${mw}\n` +
    `${p.freePoints > 0 ? `\n✨ Tienes ${p.freePoints} puntos libres. Usa *.rpgsubir <fue|des|con|int|sab|car>*` : ""}`;
  return reply(sock, from, msg, text);
}

async function cmdRpgSubir(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const attr = (args[0] || "").toLowerCase();
  if (!data.ATTRS.includes(attr)) {
    return reply(sock, from, msg, `📌 Uso: *.rpgsubir <atributo>*\nAtributos: ${data.ATTRS.map((a) => `${a} (${data.ATTR_NAMES[a]})`).join(", ")}`);
  }
  const res = rpg.assignAttrPoint(num, attr);
  if (!res.ok) {
    if (res.reason === "sin_puntos") return reply(sock, from, msg, "⛔ No tienes puntos de habilidad libres. Sube de nivel para ganar más.");
    return reply(sock, from, msg, "⛔ No se pudo asignar el punto.");
  }
  return reply(sock, from, msg, `✅ +1 en *${data.ATTR_NAMES[attr]}*. Ahora tienes ${res.profile.attrs[attr]}. Puntos libres restantes: ${res.profile.freePoints}.`);
}

async function cmdRpgRazas(sock, msg) {
  const from = msg.key.remoteJid;
  const lines = Object.entries(data.RACES).map(([key, r]) => `${r.emoji} *${r.name}* (\`${key}\`)\n_${r.desc}_\n▸ ${r.passive}`);
  return reply(sock, from, msg, `🧬 *Razas de Elyndor*\n\n${lines.join("\n\n")}`);
}

async function cmdRpgClases(sock, msg) {
  const from = msg.key.remoteJid;
  const iniciales = Object.entries(data.CLASSES).filter(([, c]) => c.tier === "inicial");
  const avanzadas = Object.entries(data.CLASSES).filter(([, c]) => c.tier === "avanzada");
  const line = ([key, c]) => `${c.emoji} *${c.name}* (\`${key}\`)\n_${c.desc}_\n▸ Habilidades: ${c.skills.join(", ")}`;
  const text =
    `🎓 *Clases iniciales* (elegibles con .rpgcrear)\n\n${iniciales.map(line).join("\n\n")}\n\n` +
    `🌟 *Clases avanzadas* (desde nivel 15, con .rpgascender)\n\n${avanzadas.map(line).join("\n\n")}`;
  return reply(sock, from, msg, text);
}

async function cmdRpgDioses(sock, msg) {
  const from = msg.key.remoteJid;
  const lines = Object.entries(data.GODS).map(
    ([key, g]) =>
      `${g.emoji} *${g.name}* (\`${key}\`) — _${g.alignment}_\n` +
      `Dominio: ${g.domain}\n▸ Bendición: ${g.blessing}\n▸ Maldición: ${g.curse}\n▸ Misión de fe: ${g.mission}`
  );
  return reply(sock, from, msg, `🛐 *Dioses de Elyndor*\n\n${lines.join("\n\n")}\n\nElige uno con *.rpgorar <dios>*`);
}

async function cmdRpgOrar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  const godKey = (args[0] || "").toLowerCase();
  const god = data.GODS[godKey];
  if (!god) {
    return reply(sock, from, msg, `📌 Uso: *.rpgorar <dios>*\nDioses: ${Object.keys(data.GODS).join(", ")}\nVe detalles con *.rpgdioses*`);
  }
  const remaining = rpg.checkCooldown(p, "orar", 12 * 60 * 60 * 1000);
  if (remaining && p.god === godKey) {
    return reply(sock, from, msg, `🙏 Ya oraste hoy. Podrás volver a orar en ${rpg.formatCooldown(remaining)}.`);
  }
  const wasNewGod = p.god !== godKey;
  p.god = godKey;
  p.godFavor[godKey] = (p.godFavor[godKey] || 0) + 10;
  rpg.saveProfile(num, p);
  rpg.setCooldown(num, "orar");
  rpg.incrementQuestProgress(num, "pray", 1);
  const bonusGold = 15;
  rpg.addGold(num, bonusGold);

  return reply(
    sock,
    from,
    msg,
    `${god.emoji} *${god.name} escucha tu plegaria...*\n\n` +
      (wasNewGod ? `Ahora eres devoto de ${god.name}.\n` : "") +
      `Favor divino: ${p.godFavor[godKey]}\n` +
      `Bendición activa: _${god.blessing}_\n` +
      `Recibiste ${rpg.formatGold(bonusGold)} como ofrenda.`
  );
}

async function cmdRpgAscender(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  const cls = data.CLASSES[p.class];
  if (cls.tier === "avanzada") return reply(sock, from, msg, "✅ Ya tienes una clase avanzada.");
  if (p.level < 15) return reply(sock, from, msg, `⛔ Necesitas ser nivel 15 para ascender. Eres nivel ${p.level}.`);
  const advanced = cls.advancesTo;
  const advCls = data.CLASSES[advanced];
  p.class = advanced;
  rpg.saveProfile(num, p);
  const d = rpg.computeDerived(p);
  return reply(
    sock,
    from,
    msg,
    `🌟 *¡${p.name} asciende a ${advCls.emoji} ${advCls.name}!* 🌟\n\n` +
      `_${advCls.desc}_\nNuevas habilidades: ${advCls.skills.join(", ")}\n\n` +
      `❤️ Vida: ${d.maxHp}  🔵 Maná: ${d.maxMana}  ⚔️ Atk: ${d.atk}`
  );
}

// ─────────────────────────────────────────────────────────────
// INVENTARIO
// ─────────────────────────────────────────────────────────────

async function cmdRpgInventario(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  const eq = p.equipment;
  const slotLine = (slot, label) => `${label}: ${eq[slot] ? itemLabel(eq[slot], 1) : "_vacío_"}`;

  const invLines =
    p.inventory.length === 0
      ? ["_Inventario vacío_"]
      : p.inventory.map((s) => itemLabel(s.id, s.qty));

  const text =
    `🎒 *Inventario de ${p.name}* (${rpg.currentWeight(p)}/${rpg.maxWeight(p)} peso)\n\n` +
    `*Equipado:*\n${slotLine("weapon", "🗡️ Arma")}\n${slotLine("armor", "🛡️ Armadura")}\n${slotLine("accessory", "💍 Accesorio")}\n${slotLine("relic", "🔱 Reliquia")}\n\n` +
    `*Objetos:*\n${invLines.join("\n")}\n\n` +
    `Usa *.rpgequipar <item>*, *.rpgusar <item>* o *.rpgtirar <item>*.`;
  return reply(sock, from, msg, text);
}

function findItemKeyByNameOrId(query) {
  const q = query.toLowerCase().trim();
  if (data.ITEMS[q]) return q;
  return Object.keys(data.ITEMS).find((k) => data.ITEMS[k].name.toLowerCase() === q) || null;
}

async function cmdRpgEquipar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const itemId = findItemKeyByNameOrId(args.join(" "));
  if (!itemId) return reply(sock, from, msg, "📌 Uso: *.rpgequipar <item>*\nVe tu inventario con *.rpginventario*.");
  const res = rpg.equipItem(num, itemId);
  if (!res.ok) {
    const map = { no_en_inventario: "No tienes ese item en tu inventario.", no_equipable: "Ese item no se puede equipar.", item_invalido: "Item inválido." };
    return reply(sock, from, msg, `⛔ ${map[res.reason] || "No se pudo equipar."}`);
  }
  return reply(sock, from, msg, `✅ Equipaste ${itemLabel(itemId, 1)} en la ranura *${res.slot}*.`);
}

async function cmdRpgDesequipar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const slot = (args[0] || "").toLowerCase();
  const res = rpg.unequipSlot(num, slot);
  if (!res.ok) {
    return reply(sock, from, msg, "📌 Uso: *.rpgdesequipar <weapon|armor|accessory|relic>*");
  }
  return reply(sock, from, msg, `✅ Desequipaste la ranura *${slot}*.`);
}

async function cmdRpgUsar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const itemId = findItemKeyByNameOrId(args.join(" "));
  const p = rpg.getProfile(num);
  const stack = itemId ? rpg.findStack(p, itemId) : null;
  const it = itemId ? data.ITEMS[itemId] : null;

  if (!it || it.type !== "consumable" || !stack) {
    return reply(sock, from, msg, "📌 Uso: *.rpgusar <item>*\nSolo se pueden usar consumibles que tengas en tu inventario.");
  }
  const d = rpg.computeDerived(p);
  let text = `${it.emoji} Usaste *${it.name}*.\n`;
  if (it.heal) {
    p.hpCurrent = Math.min(d.maxHp, p.hpCurrent + it.heal);
    text += `❤️ Recuperaste ${it.heal} de vida. (${Math.round(p.hpCurrent)}/${d.maxHp})\n`;
  }
  if (it.manaRestore) {
    p.manaCurrent = Math.min(d.maxMana, p.manaCurrent + it.manaRestore);
    text += `🔵 Recuperaste ${it.manaRestore} de maná. (${Math.round(p.manaCurrent)}/${d.maxMana})\n`;
  }
  if (it.cureStatus) text += `🍃 Te curaste de estados alterados.\n`;
  if (it.reviveFull && !p.alive) {
    p.alive = true;
    p.hpCurrent = d.maxHp;
    p.manaCurrent = d.maxMana;
    text += `🔥 ¡Reviviste con toda tu vida y maná!\n`;
  }
  rpg.removeItem(p, itemId, 1);
  rpg.saveProfile(num, p);
  return reply(sock, from, msg, text.trim());
}

async function cmdRpgTirar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const qtyArg = args[args.length - 1];
  const hasQty = /^[0-9]+$/.test(qtyArg || "");
  const nameArgs = hasQty ? args.slice(0, -1) : args;
  const qty = hasQty ? parseInt(qtyArg, 10) : 1;
  const itemId = findItemKeyByNameOrId(nameArgs.join(" "));
  if (!itemId) return reply(sock, from, msg, "📌 Uso: *.rpgtirar <item> [cantidad]*");
  const p = rpg.getProfile(num);
  if (!rpg.removeItem(p, itemId, qty)) return reply(sock, from, msg, "⛔ No tienes esa cantidad de ese item.");
  rpg.saveProfile(num, p);
  return reply(sock, from, msg, `🗑️ Descartaste ${itemLabel(itemId, qty)}.`);
}

// ─────────────────────────────────────────────────────────────
// MUNDO
// ─────────────────────────────────────────────────────────────

async function cmdRpgRegiones(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  const p = requireCharacter(num) ? rpg.getProfile(num) : null;
  const lines = Object.entries(data.REGIONS).map(
    ([key, r]) =>
      `${r.emoji} *${r.name}* (\`${key}\`)${p && p.region === key ? " 📍 (aquí)" : ""}\n_${r.desc}_\n▸ Nivel mín: ${r.minLevel} | Costo viaje: ${r.travelCost === 0 ? "gratis" : rpg.formatGold(r.travelCost)}`
  );
  return reply(sock, from, msg, `🗺️ *Regiones de Elyndor*\n\n${lines.join("\n\n")}\n\nViaja con *.rpgviajar <región>*`);
}

async function cmdRpgViajar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const regionKey = (args[0] || "").toLowerCase();
  if (!data.REGIONS[regionKey]) {
    return reply(sock, from, msg, `📌 Uso: *.rpgviajar <región>*\nRegiones: ${Object.keys(data.REGIONS).join(", ")}`);
  }
  const res = rpg.travel(num, regionKey);
  if (!res.ok) {
    const msgs = {
      ya_ahi: "Ya estás en esa región.",
      nivel_bajo: `Necesitas nivel ${res.need} para entrar ahí.`,
      cooldown: `Debes esperar ${rpg.formatCooldown(res.remaining)} para volver a viajar.`,
      sin_oro: `Necesitas ${rpg.formatGold(res.need)} para el viaje.`,
    };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo viajar."}`);
  }
  return reply(sock, from, msg, `${res.region.emoji} Llegaste a *${res.region.name}*.\n_${res.region.desc}_`);
}

async function cmdRpgExplorar(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  if (!p.alive) return reply(sock, from, msg, "💀 Estás caído. Usa *.rpgrevivir* antes de explorar.");
  const remaining = rpg.checkCooldown(p, "explorar", 6 * 60 * 1000);
  if (remaining) return reply(sock, from, msg, `⏳ Debes esperar ${rpg.formatCooldown(remaining)} para volver a explorar.`);
  rpg.setCooldown(num, "explorar");
  rpg.incrementQuestProgress(num, "explore", 1);

  const roll = Math.random();
  if (roll < 0.4) {
    // combate contra monstruo de la región
    return handleEncounterCombat(sock, from, msg, num, "explorar");
  } else if (roll < 0.65) {
    const gold = Math.floor(Math.random() * 40) + 10;
    rpg.addGold(num, gold);
    return reply(sock, from, msg, `🔎 Explorando *${data.REGIONS[p.region].name}*...\n💰 Encontraste un cofre olvidado con ${rpg.formatGold(gold)}!`);
  } else if (roll < 0.85) {
    const materials = ["cuero_lobo", "mineral_hierro", "esencia_arcana"];
    const mat = materials[Math.floor(Math.random() * materials.length)];
    const p2 = rpg.getProfile(num);
    rpg.addItem(p2, mat, 1);
    rpg.saveProfile(num, p2);
    return reply(sock, from, msg, `🔎 Explorando *${data.REGIONS[p.region].name}*...\n📦 Encontraste ${itemLabel(mat, 1)}.`);
  } else {
    const d = rpg.computeDerived(p);
    const dmg = Math.round(d.maxHp * 0.1);
    const p2 = rpg.getProfile(num);
    p2.hpCurrent = Math.max(0, p2.hpCurrent - dmg);
    rpg.saveProfile(num, p2);
    let extra = "";
    if (p2.hpCurrent <= 0) {
      rpg.applyDeath(num);
      extra = "\n💀 *¡Has caído! Usa .rpgrevivir para volver.*";
    }
    return reply(sock, from, msg, `🔎 Explorando *${data.REGIONS[p.region].name}*...\n🪤 ¡Caíste en una trampa! Perdiste ${dmg} de vida.${extra}`);
  }
}

async function cmdRpgCazar(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  if (!p.alive) return reply(sock, from, msg, "💀 Estás caído. Usa *.rpgrevivir* antes de cazar.");
  const remaining = rpg.checkCooldown(p, "cazar", 4 * 60 * 1000);
  if (remaining) return reply(sock, from, msg, `⏳ Debes esperar ${rpg.formatCooldown(remaining)} para volver a cazar.`);
  rpg.setCooldown(num, "cazar");
  return handleEncounterCombat(sock, from, msg, num, "cazar");
}

async function handleEncounterCombat(sock, from, msg, num, source) {
  const p = rpg.getProfile(num);
  const pool = data.monstersForLevel(p.level);
  const monster = pool[Math.floor(Math.random() * pool.length)];
  const a = rpg.makeCombatantFromProfile(p);
  const b = rpg.makeCombatantFromMonster(monster);
  const battle = rpg.runBattle(a, b);

  p.hpCurrent = Math.max(0, Math.round(battle.finalHpA));
  let text = battle.log.join("\n") + "\n\n";

  if (battle.aWon) {
    p.stats.monstersKilled += 1;
    rpg.saveProfile(num, p);
    incrementKillsAndMaybeDrop(num, monster);
    const xpInfo = rpg.addXp(num, monster.xp);
    rpg.addGold(num, monster.gold);
    text += `🎁 Ganaste ${monster.xp} XP y ${rpg.formatGold(monster.gold)}.`;
    if (xpInfo.leveledUp > 0) text += `\n🎉 *¡Subiste a nivel ${xpInfo.profile.level}!* (+${xpInfo.leveledUp * 3} puntos libres)`;
  } else {
    rpg.saveProfile(num, p);
    if (p.hpCurrent <= 0) {
      const d = rpg.applyDeath(num);
      text += `💀 *¡Has caído en combate!* Perdiste ${rpg.formatGold(d.goldLost)}.\nUsa *.rpgrevivir* para volver a levantarte.`;
    } else {
      text += `😮‍💨 Sobreviviste, pero el monstruo huyó con la victoria.`;
    }
  }
  return reply(sock, from, msg, text);
}

function incrementKillsAndMaybeDrop(num, monster) {
  rpg.incrementQuestProgress(num, "kills", 1);
  if (Math.random() < 0.15) {
    const materials = ["cuero_lobo", "mineral_hierro", "esencia_arcana", "escama_infernal"];
    const mat = materials[Math.floor(Math.random() * materials.length)];
    const p = rpg.getProfile(num);
    rpg.addItem(p, mat, 1);
    rpg.saveProfile(num, p);
  }
}

// ─────────────────────────────────────────────────────────────
// COMBATE PvP
// ─────────────────────────────────────────────────────────────

async function cmdRpgDuelo(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const target = resolveTarget(msg, args);
  if (!target) return reply(sock, from, msg, "📌 Uso: *.rpgduelo @mención*\nTambién podés responder a su mensaje.");
  if (target.number === num) return reply(sock, from, msg, "⛔ No puedes duelarte a ti mismo.");
  if (!requireCharacter(target.number)) return reply(sock, from, msg, "⛔ Esa persona no tiene personaje en Elyndor.");

  const p1 = rpg.getProfile(num);
  const p2 = rpg.getProfile(target.number);
  if (!p1.alive) return reply(sock, from, msg, "💀 Estás caído. Usa *.rpgrevivir* primero.");
  if (!p2.alive) return reply(sock, from, msg, "⛔ Tu rival está caído en este momento.");

  const remaining = rpg.checkCooldown(p1, "duelo", 5 * 60 * 1000);
  if (remaining) return reply(sock, from, msg, `⏳ Debes esperar ${rpg.formatCooldown(remaining)} para volver a duelar.`);
  rpg.setCooldown(num, "duelo");

  const a = rpg.makeCombatantFromProfile(p1);
  const b = rpg.makeCombatantFromProfile(p2, p2.name);
  const battle = rpg.runBattle(a, b);

  // El PvP no mata de verdad: se queda en 1 HP el que pierde.
  p1.hpCurrent = battle.aWon ? Math.max(1, Math.round(battle.finalHpA)) : 1;
  p2.hpCurrent = battle.bWon ? Math.max(1, Math.round(battle.finalHpB)) : 1;

  let goldReward = 0;
  if (battle.aWon) {
    p1.stats.pvpWins += 1;
    p2.stats.pvpLosses += 1;
    goldReward = Math.round(10 + p2.level * 2);
    p1.gold += goldReward;
  } else if (battle.bWon) {
    p2.stats.pvpWins += 1;
    p1.stats.pvpLosses += 1;
    goldReward = Math.round(10 + p1.level * 2);
    p2.gold += goldReward;
  }
  rpg.saveProfile(num, p1);
  rpg.saveProfile(target.number, p2);
  rpg.incrementQuestProgress(num, "duel", 1);
  rpg.incrementQuestProgress(target.number, "duel", 1);

  const winnerText = battle.aWon
    ? `🏆 *${p1.name}* vence y se lleva ${rpg.formatGold(goldReward)}.`
    : battle.bWon
    ? `🏆 *${p2.name}* vence y se lleva ${rpg.formatGold(goldReward)}.`
    : `🤝 Duelo empatado, nadie se lleva oro.`;

  const text = battle.log.join("\n") + "\n\n" + winnerText;
  return reply(sock, from, msg, text, [target.jid]);
}

// ─────────────────────────────────────────────────────────────
// MAZMORRAS
// ─────────────────────────────────────────────────────────────

async function cmdRpgMazmorras(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  const p = requireCharacter(num) ? rpg.getProfile(num) : null;
  const lines = Object.entries(data.DUNGEONS).map(([key, dgeon]) => {
    let cdText = "";
    if (p) {
      const remaining = rpg.checkCooldown(p, `dungeon:${key}`, dgeon.cooldownMs);
      cdText = remaining ? ` — ⏳ ${rpg.formatCooldown(remaining)}` : " — ✅ disponible";
    }
    return `${dgeon.emoji} *${dgeon.name}* (\`${key}\`)\nNivel mín: ${dgeon.minLevel} | Pisos: ${dgeon.floors} | Jefe: ${dgeon.boss.emoji} ${dgeon.boss.name}${cdText}`;
  });
  return reply(sock, from, msg, `🏰 *Mazmorras de Elyndor*\n\n${lines.join("\n\n")}\n\nEntra con *.rpgmazmorra <nombre>*`);
}

async function cmdRpgMazmorra(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const key = (args[0] || "").toLowerCase();
  if (!data.DUNGEONS[key]) {
    return reply(sock, from, msg, `📌 Uso: *.rpgmazmorra <nombre>*\nMazmorras: ${Object.keys(data.DUNGEONS).join(", ")}`);
  }
  const p = rpg.getProfile(num);
  if (!p.alive) return reply(sock, from, msg, "💀 Estás caído. Usa *.rpgrevivir* antes de entrar a una mazmorra.");

  const res = rpg.runDungeon(num, key);
  if (!res.ok) {
    const msgs = {
      nivel_bajo: `Necesitas nivel ${res.need} para esta mazmorra.`,
      cooldown: `Esta mazmorra está en enfriamiento por ${rpg.formatCooldown(res.remaining)}.`,
      muerto: "Estás caído, revive primero.",
      invalida: "Mazmorra inválida.",
    };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo entrar a la mazmorra."}`);
  }

  let text = res.log.join("\n") + "\n\n";
  if (res.survived) {
    text += `🏆 *¡Mazmorra completada!*\n💰 Ganaste ${res.totalXp} XP y ${rpg.formatGold(res.totalGold)}.`;
    if (res.droppedItem) text += `\n🎁 Botín: ${itemLabel(res.droppedItem, 1)}`;
    if (res.leveledUp > 0) text += `\n🎉 *¡Subiste de nivel!*`;
  } else if (res.deathInfo) {
    text += `💀 *¡Caíste dentro de la mazmorra!* Perdiste ${rpg.formatGold(res.deathInfo.goldLost)}.\nUsa *.rpgrevivir* para volver.`;
  } else {
    text += `😮‍💨 No lograste completarla esta vez, pero sobreviviste.`;
  }
  return reply(sock, from, msg, text);
}

// ─────────────────────────────────────────────────────────────
// MUERTE / RESURRECCIÓN
// ─────────────────────────────────────────────────────────────

async function cmdRpgRevivir(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  if (p.alive) return reply(sock, from, msg, "✅ Ya estás con vida.");
  const cost = rpg.resurrectCost(p);
  const res = rpg.resurrect(num);
  if (!res.ok) {
    if (res.reason === "sin_oro") return reply(sock, from, msg, `⛔ Necesitas ${rpg.formatGold(cost)} para revivir. Tienes ${rpg.formatGold(p.gold)}.`);
    return reply(sock, from, msg, "⛔ No se pudo revivir.");
  }
  return reply(sock, from, msg, `✨ *${p.name} vuelve a la vida* pagando ${rpg.formatGold(res.cost)} a los sacerdotes de Elyndor.\n❤️ Vida recuperada al 50%.`);
}

// ─────────────────────────────────────────────────────────────
// ECONOMÍA: tienda NPC
// ─────────────────────────────────────────────────────────────

async function cmdRpgTiendaNpc(sock, msg) {
  const from = msg.key.remoteJid;
  const lines = data.NPC_SHOP.map((id) => {
    const it = data.ITEMS[id];
    return `${it.emoji} *${it.name}* — ${rpg.formatGold(it.price)} (\`${id}\`)`;
  });
  return reply(sock, from, msg, `🏪 *Tienda NPC de Valdorien*\n\n${lines.join("\n")}\n\nCompra con *.rpgcomprarnpc <item> [cantidad]*`);
}

async function cmdRpgComprarNpc(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const qtyArg = args[args.length - 1];
  const hasQty = /^[0-9]+$/.test(qtyArg || "") && args.length > 1;
  const nameArgs = hasQty ? args.slice(0, -1) : args;
  const qty = hasQty ? Math.max(1, parseInt(qtyArg, 10)) : 1;
  const itemId = findItemKeyByNameOrId(nameArgs.join(" "));

  if (!itemId || !data.NPC_SHOP.includes(itemId)) {
    return reply(sock, from, msg, "📌 Uso: *.rpgcomprarnpc <item> [cantidad]*\nVe la tienda con *.rpgtiendanpc*.");
  }
  const it = data.ITEMS[itemId];
  const total = it.price * qty;
  const p = rpg.getProfile(num);
  if (p.gold < total) return reply(sock, from, msg, `⛔ Necesitas ${rpg.formatGold(total)}. Tienes ${rpg.formatGold(p.gold)}.`);
  if (rpg.currentWeight(p) + it.weight * qty > rpg.maxWeight(p)) return reply(sock, from, msg, "⛔ No tienes espacio suficiente en el inventario.");

  p.gold -= total;
  rpg.addItem(p, itemId, qty);
  rpg.saveProfile(num, p);
  return reply(sock, from, msg, `✅ Compraste ${itemLabel(itemId, qty)} por ${rpg.formatGold(total)}.`);
}

// ─────────────────────────────────────────────────────────────
// ECONOMÍA: mercado global entre jugadores
// ─────────────────────────────────────────────────────────────

async function cmdRpgMercado(sock, msg) {
  const from = msg.key.remoteJid;
  const market = rpg.getMarket();
  if (market.listings.length === 0) return reply(sock, from, msg, "🏬 El mercado global está vacío por ahora. ¡Sé el primero con *.rpgvender*!");
  const lines = market.listings
    .slice(-25)
    .map((l) => `#${l.id} — ${itemLabel(l.itemId, l.qty)} — ${rpg.formatGold(l.price)} (vendedor: +${l.seller})`);
  return reply(sock, from, msg, `🏬 *Mercado global de Elyndor*\n\n${lines.join("\n")}\n\nCompra con *.rpgcomprar <id>*`);
}

async function cmdRpgVender(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const priceArg = args[args.length - 1];
  const price = parseInt((priceArg || "").replace(/[^0-9]/g, ""), 10);
  if (!price || price <= 0) {
    return reply(sock, from, msg, "📌 Uso: *.rpgvender <item> <precio>*\nEjemplo: *.rpgvender espada_acero 200*");
  }
  const nameArgs = args.slice(0, -1);
  const itemId = findItemKeyByNameOrId(nameArgs.join(" "));
  if (!itemId) return reply(sock, from, msg, "⛔ Item inválido.");

  const res = rpg.listItemOnMarket(num, itemId, 1, price);
  if (!res.ok) return reply(sock, from, msg, "⛔ No tienes ese item en tu inventario.");
  return reply(sock, from, msg, `✅ Publicaste ${itemLabel(itemId, 1)} en el mercado por ${rpg.formatGold(price)} (id #${res.listing.id}).`);
}

async function cmdRpgComprar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const id = parseInt(args[0], 10);
  if (!id) return reply(sock, from, msg, "📌 Uso: *.rpgcomprar <id>*\nVe el mercado con *.rpgmercado*.");
  const res = rpg.buyFromMarket(num, id);
  if (!res.ok) {
    const msgs = { no_existe: "Esa publicación no existe.", propio: "No puedes comprar tu propia publicación.", sin_oro: "No tienes suficiente oro." };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo comprar."}`);
  }
  return reply(sock, from, msg, `✅ Compraste ${itemLabel(res.listing.itemId, res.listing.qty)} por ${rpg.formatGold(res.listing.price)}.`);
}

async function cmdRpgCancelarVenta(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const id = parseInt(args[0], 10);
  if (!id) return reply(sock, from, msg, "📌 Uso: *.rpgcancelarventa <id>*");
  const res = rpg.cancelMarketListing(num, id);
  if (!res.ok) return reply(sock, from, msg, "⛔ No se pudo cancelar (no existe o no es tuya).");
  return reply(sock, from, msg, "✅ Publicación cancelada, el item volvió a tu inventario.");
}

// ─────────────────────────────────────────────────────────────
// ECONOMÍA: subastas
// ─────────────────────────────────────────────────────────────

async function cmdRpgSubasta(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const hoursArg = args[args.length - 1];
  const priceArg = args[args.length - 2];
  const hours = parseInt(hoursArg, 10);
  const price = parseInt((priceArg || "").replace(/[^0-9]/g, ""), 10);
  if (!hours || hours <= 0 || hours > 72 || !price || price <= 0) {
    return reply(sock, from, msg, "📌 Uso: *.rpgsubasta <item> <precio_inicial> <horas (1-72)>*");
  }
  const nameArgs = args.slice(0, -2);
  const itemId = findItemKeyByNameOrId(nameArgs.join(" "));
  if (!itemId) return reply(sock, from, msg, "⛔ Item inválido.");

  const res = rpg.createAuction(num, itemId, 1, price, hours);
  if (!res.ok) return reply(sock, from, msg, "⛔ No tienes ese item en tu inventario.");
  return reply(sock, from, msg, `🔨 Subasta creada: ${itemLabel(itemId, 1)}, puja inicial ${rpg.formatGold(price)}, dura ${hours}h (id #${res.auction.id}).`);
}

async function cmdRpgSubastas(sock, msg) {
  const from = msg.key.remoteJid;
  rpg.settleExpiredAuctions();
  const auctions = rpg.getAuctions();
  const active = auctions.list.filter((a) => !a.closed);
  if (active.length === 0) return reply(sock, from, msg, "🔨 No hay subastas activas ahora mismo. ¡Crea una con *.rpgsubasta*!");
  const lines = active.map((a) => {
    const remaining = Math.max(0, a.endsAt - Date.now());
    return `#${a.id} — ${itemLabel(a.itemId, a.qty)} — puja actual: ${rpg.formatGold(a.currentBid)}${a.bidder ? ` (+${a.bidder})` : ""} — termina en ${rpg.formatCooldown(remaining)}`;
  });
  return reply(sock, from, msg, `🔨 *Subastas activas*\n\n${lines.join("\n")}\n\nPuja con *.rpgpujar <id> <monto>*`);
}

async function cmdRpgPujar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const id = parseInt(args[0], 10);
  const amount = parseInt((args[1] || "").replace(/[^0-9]/g, ""), 10);
  if (!id || !amount) return reply(sock, from, msg, "📌 Uso: *.rpgpujar <id> <monto>*");
  rpg.settleExpiredAuctions();
  const res = rpg.bidAuction(num, id, amount);
  if (!res.ok) {
    const msgs = { no_existe: "Subasta inválida.", finalizada: "Esa subasta ya terminó.", propio: "No puedes pujar tu propia subasta.", puja_baja: "Tu puja debe ser mayor a la actual.", sin_oro: "No tienes suficiente oro." };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo pujar."}`);
  }
  return reply(sock, from, msg, `✅ Pujaste ${rpg.formatGold(amount)} por la subasta #${id}.`);
}

// ─────────────────────────────────────────────────────────────
// ECONOMÍA: forja / crafteo
// ─────────────────────────────────────────────────────────────

async function cmdRpgRecetas(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  const p = requireCharacter(num) ? rpg.getProfile(num) : null;
  const lines = Object.entries(data.RECIPES).map(([key, r]) => {
    const result = data.ITEMS[r.result];
    const mats = Object.entries(r.materials).map(([m, q]) => `${data.ITEMS[m].name} x${q}`).join(", ");
    const lockedTxt = p && p.level < r.craftLevel ? ` 🔒(nivel ${r.craftLevel})` : "";
    return `${result.emoji} *${result.name}* x${r.qty} (\`${key}\`)${lockedTxt}\nMateriales: ${mats} + ${rpg.formatGold(r.gold)}`;
  });
  return reply(sock, from, msg, `🔨 *Recetas de forja/alquimia*\n\n${lines.join("\n\n")}\n\nForja con *.rpgforjar <receta>*`);
}

async function cmdRpgForjar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const key = (args[0] || "").toLowerCase();
  if (!data.RECIPES[key]) return reply(sock, from, msg, `📌 Uso: *.rpgforjar <receta>*\nVe recetas con *.rpgrecetas*.`);
  const res = rpg.craftItem(num, key);
  if (!res.ok) {
    const msgs = {
      nivel_bajo: `Necesitas nivel ${res.need} para esta receta.`,
      sin_oro: `Necesitas ${rpg.formatGold(res.need)}.`,
      sin_materiales: `Te falta ${data.ITEMS[res.missing]?.name || res.missing}.`,
    };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo forjar."}`);
  }
  const result = data.ITEMS[res.recipe.result];
  return reply(sock, from, msg, `🔨 ¡Forjaste ${itemLabel(res.recipe.result, res.recipe.qty)}! ${result.emoji}`);
}

// ─────────────────────────────────────────────────────────────
// MISIONES
// ─────────────────────────────────────────────────────────────

async function cmdRpgMisiones(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  rpg.refreshQuests(num);
  const p = rpg.getProfile(num);
  const line = (q) => `${q.done ? (q.claimed ? "✅" : "🎁") : "▫️"} *${q.id}* — ${q.desc} (${q.progress}/${q.target}) — 🎁 ${q.xp}xp/${rpg.formatGold(q.gold)}`;
  const epics = Object.entries(data.EPIC_QUESTS)
    .filter(([key]) => !p.quests.epicCompleted.includes(key))
    .map(([key, e]) => `🌟 *${e.name}* (\`${key}\`)\n_${e.desc}_\nRecompensa: ${e.reward.xp}xp, ${rpg.formatGold(e.reward.gold)}, ${data.ITEMS[e.reward.item].name}`);

  const text =
    `📜 *Misiones de ${p.name}*\n\n` +
    `*Diarias:*\n${p.quests.daily.map(line).join("\n")}\n\n` +
    `*Semanales:*\n${p.quests.weekly.map(line).join("\n")}\n\n` +
    (epics.length ? `*Épicas disponibles:*\n${epics.join("\n\n")}\n\n` : "") +
    `Reclama recompensas con *.rpgreclamar <id>*`;
  return reply(sock, from, msg, text);
}

async function cmdRpgReclamar(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const questId = (args[0] || "").toLowerCase();
  const res = rpg.claimQuest(num, questId);
  if (!res.ok) {
    const msgs = { no_encontrada: "No tienes esa misión pendiente.", incompleta: "Todavía no completaste esa misión." };
    return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo reclamar."}`);
  }
  return reply(sock, from, msg, `🎁 Reclamaste *${res.quest.desc}*: +${res.quest.xp} XP, +${rpg.formatGold(res.quest.gold)}.`);
}

async function cmdRpgReputacion(sock, msg, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const p = rpg.getProfile(num);
  const entries = Object.entries(p.reputation);
  if (entries.length === 0) return reply(sock, from, msg, "🏵️ Todavía no tienes reputación en ninguna región. ¡Completa mazmorras para ganarla!");
  const lines = entries.map(([key, val]) => `${data.REGIONS[key]?.emoji || "🌍"} ${data.REGIONS[key]?.name || key}: ${val} pts`);
  return reply(sock, from, msg, `🏵️ *Reputación regional de ${p.name}*\n\n${lines.join("\n")}`);
}

// ─────────────────────────────────────────────────────────────
// GREMIOS
// ─────────────────────────────────────────────────────────────

async function cmdRpgGremio(sock, msg, args, sender) {
  const from = msg.key.remoteJid;
  const num = senderNumber(sender);
  if (!requireCharacter(num)) return reply(sock, from, msg, NO_CHAR_TEXT);
  const sub = (args[0] || "").toLowerCase();

  if (sub === "crear") {
    const name = args.slice(1).join(" ").trim();
    if (!name) return reply(sock, from, msg, "📌 Uso: *.rpggremio crear <nombre>* (costo: 200 EC)");
    const res = rpg.createGuild(num, name);
    if (!res.ok) {
      const msgs = { ya_en_gremio: "Ya perteneces a un gremio.", nombre_tomado: "Ese nombre ya está en uso.", sin_oro: "Necesitas 200 EC para fundar un gremio." };
      return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo crear el gremio."}`);
    }
    return reply(sock, from, msg, `🛡️ *¡Gremio "${res.guild.name}" fundado!* Invita miembros con *.rpggremio invitar @mención*.`);
  }

  if (sub === "invitar") {
    const target = resolveTarget(msg, args.slice(1));
    if (!target) return reply(sock, from, msg, "📌 Uso: *.rpggremio invitar @mención*");
    const res = rpg.inviteToGuild(num, target.number);
    if (!res.ok) {
      const msgs = { sin_gremio: "No perteneces a ningún gremio.", no_lider: "Solo el líder puede invitar.", objetivo_sin_personaje: "Esa persona no tiene personaje en Elyndor.", objetivo_ya_en_gremio: "Esa persona ya está en un gremio.", gremio_lleno: "Tu gremio ya está lleno (máx 20)." };
      return reply(sock, from, msg, `⛔ ${msgs[res.reason] || "No se pudo invitar."}`);
    }
    return reply(sock, from, msg, `✅ @${target.number} se unió a *${res.guild.name}*.`, [target.jid]);
  }

  if (sub === "salir") {
    const res = rpg.leaveGuild(num);
    if (!res.ok) return reply(sock, from, msg, "⛔ No perteneces a ningún gremio.");
    return reply(sock, from, msg, "👋 Saliste de tu gremio.");
  }

  if (sub === "info") {
    const p = rpg.getProfile(num);
    const key = args.slice(1).join(" ").trim().toLowerCase() || p.guild;
    if (!key) return reply(sock, from, msg, "📌 Uso: *.rpggremio info [nombre]*");
    const guilds = rpg.getGuilds();
    const guild = guilds[key];
    if (!guild) return reply(sock, from, msg, "⛔ Ese gremio no existe.");
    return reply(sock, from, msg, `🛡️ *${guild.name}*\nLíder: +${guild.owner}\nMiembros: ${guild.members.length}/20`);
  }

  return reply(sock, from, msg, "📌 Uso: *.rpggremio crear|invitar|salir|info* ...");
}

async function cmdRpgGremios(sock, msg) {
  const from = msg.key.remoteJid;
  const top = rpg.guildRanking(10);
  if (top.length === 0) return reply(sock, from, msg, "🛡️ Todavía no existe ningún gremio. ¡Funda el primero con *.rpggremio crear <nombre>*!");
  const lines = top.map((g, i) => `${i + 1}. *${g.name}* — ${g.memberCount} miembros`);
  return reply(sock, from, msg, `🏆 *Ranking de gremios*\n\n${lines.join("\n")}`);
}

// ─────────────────────────────────────────────────────────────
// RANKING
// ─────────────────────────────────────────────────────────────

async function cmdRpgRanking(sock, msg, args) {
  const from = msg.key.remoteJid;
  const type = (args[0] || "nivel").toLowerCase();
  if (type === "oro") {
    const top = rpg.rankingByGold(10);
    const lines = top.map((p, i) => `${i + 1}. ${p.name} — ${rpg.formatGold(p.gold)}`);
    return reply(sock, from, msg, `🏆 *Ranking por oro*\n\n${lines.join("\n") || "_sin datos_"}`);
  }
  if (type === "pvp") {
    const top = rpg.rankingByPvp(10);
    const lines = top.map((p, i) => `${i + 1}. ${p.name} — ${p.wins}V / ${p.losses}D`);
    return reply(sock, from, msg, `🏆 *Ranking PvP*\n\n${lines.join("\n") || "_sin datos_"}`);
  }
  const top = rpg.rankingByLevel(10);
  const lines = top.map((p, i) => `${i + 1}. ${p.name} — Nivel ${p.level} (${p.xp} xp)`);
  return reply(sock, from, msg, `🏆 *Ranking por nivel*\n\n${lines.join("\n") || "_sin datos_"}\n\nOtros: *.rpgranking oro* / *.rpgranking pvp*`);
}

// ─────────────────────────────────────────────────────────────
// ADMIN (owner / co-owner del BOT)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// CREACIÓN DE CONTENIDO CON IA (owner / co-owner del BOT)
// ─────────────────────────────────────────────────────────────

// .rpgcrearclase <clave> | <breve descripción de cómo funciona>
// Le pide a la IA (Anthropic) que diseñe una clase inicial + su evolución
// avanzada a partir de la descripción, y las agrega al juego al instante.
async function cmdRpgCrearClase(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");

  const full = args.join(" ");
  const [slugRaw, ...descParts] = full.split("|");
  const slug = (slugRaw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const description = descParts.join("|").trim();

  if (!slug || !description) {
    return reply(
      sock,
      from,
      msg,
      `📌 Uso: *.rpgcrearclase <clave> | <breve descripción de cómo funciona>*\n` +
        `Ejemplo: *.rpgcrearclase vampiro | Clase cuerpo a cuerpo que drena vida y se fortalece de noche*`
    );
  }

  if (customContent.hasClassKey(slug) || customContent.hasClassKey(`${slug}_asc`)) {
    return reply(sock, from, msg, `⚠️ Ya existe una clase con la clave \`${slug}\`. Elige otra.`);
  }

  await reply(sock, from, msg, "🧠 Generando clase con IA, un momento...");

  try {
    const raw = await askAI({
      system: rpgAi.CLASS_SYSTEM_PROMPT,
      prompt: rpgAi.buildClassPrompt(slug, description),
    });
    const json = extractJson(raw);
    const { inicial, avanzada } = rpgAi.validateClassPair(slug, json);
    customContent.addCustomClassPair(slug, inicial, avanzada, { rawDescription: description });

    return reply(
      sock,
      from,
      msg,
      `✅ *Nueva clase: ${inicial.emoji} ${inicial.name}*\n` +
        `_${inicial.desc}_\n` +
        `▸ Atributos: ${Object.entries(inicial.baseAttrs)
          .map(([k, v]) => `${k.toUpperCase()} +${v}`)
          .join(", ")}\n` +
        `▸ Habilidades: ${inicial.skills.join(", ")}\n\n` +
        `🌟 Al llegar a nivel 15 con *.rpgascender* evoluciona a *${avanzada.emoji} ${avanzada.name}*.\n\n` +
        `Ya disponible: *.rpgcrear <raza> ${slug}*`
    );
  } catch (err) {
    console.error("Error en .rpgcrearclase:", err);
    return reply(sock, from, msg, `❌ No se pudo generar la clase: ${err.message}`);
  }
}

// .rpgcrearraza <clave> | <breve descripción de cómo funciona>
async function cmdRpgCrearRaza(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");

  const full = args.join(" ");
  const [slugRaw, ...descParts] = full.split("|");
  const slug = (slugRaw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const description = descParts.join("|").trim();

  if (!slug || !description) {
    return reply(
      sock,
      from,
      msg,
      `📌 Uso: *.rpgcrearraza <clave> | <breve descripción de cómo funciona>*\n` +
        `Ejemplo: *.rpgcrearraza nagaru | Raza serpiente de los pantanos, resistente al veneno y ágil en el agua*`
    );
  }

  if (customContent.hasRaceKey(slug)) {
    return reply(sock, from, msg, `⚠️ Ya existe una raza con la clave \`${slug}\`. Elige otra.`);
  }

  await reply(sock, from, msg, "🧠 Generando raza con IA, un momento...");

  try {
    const raw = await askAI({
      system: rpgAi.RACE_SYSTEM_PROMPT,
      prompt: rpgAi.buildRacePrompt(slug, description),
    });
    const json = extractJson(raw);
    const race = rpgAi.validateRace(slug, json);
    customContent.addCustomRace(slug, race);

    return reply(
      sock,
      from,
      msg,
      `✅ *Nueva raza: ${race.emoji} ${race.name}*\n` +
        `_${race.desc}_\n` +
        `▸ Bonos: ${Object.entries(race.bonus)
          .map(([k, v]) => `${k.toUpperCase()} +${v}`)
          .join(", ")}\n` +
        `▸ Pasiva: ${race.passive}\n\n` +
        `Ya disponible: *.rpgcrear ${slug} <clase>*`
    );
  } catch (err) {
    console.error("Error en .rpgcrearraza:", err);
    return reply(sock, from, msg, `❌ No se pudo generar la raza: ${err.message}`);
  }
}

// .rpgborrarclase <clave> — quita una clase creada por IA (y su avanzada).
async function cmdRpgBorrarClase(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");
  const slug = (args[0] || "").trim().toLowerCase();
  if (!slug) return reply(sock, from, msg, "📌 Uso: *.rpgborrarclase <clave>*");
  const ok = customContent.removeCustomClassPair(slug);
  return reply(
    sock,
    from,
    msg,
    ok
      ? `🗑️ Clase \`${slug}\` (y su evolución) eliminada.\n_Nota: si alguien ya la tenía elegida, mejor reasignale clase con .rpgadmin._`
      : `⚠️ No existe una clase creada por IA con esa clave (las clases fijas del juego no se pueden borrar, pero se pueden modificar con *.rpgmodclase*).`
  );
}

// .rpgborrarraza <clave> — quita una raza creada por IA.
async function cmdRpgBorrarRaza(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");
  const slug = (args[0] || "").trim().toLowerCase();
  if (!slug) return reply(sock, from, msg, "📌 Uso: *.rpgborrarraza <clave>*");
  const ok = customContent.removeCustomRace(slug);
  return reply(
    sock,
    from,
    msg,
    ok
      ? `🗑️ Raza \`${slug}\` eliminada.`
      : `⚠️ No existe una raza creada por IA con esa clave (las razas fijas del juego no se pueden borrar, pero se pueden modificar con *.rpgmodraza*).`
  );
}

// .rpgmodclase <clave> | <nueva descripción de cómo funciona>
// Regenera con IA una clase YA EXISTENTE (fija del juego o creada por IA),
// conservando su clave interna y su lugar en el árbol de clases (advancesTo
// / requires), pero con sabor, atributos, multiplicadores y habilidades
// totalmente nuevos según la nueva descripción.
async function cmdRpgModClase(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");

  const full = args.join(" ");
  const [slugRaw, ...descParts] = full.split("|");
  const slug = (slugRaw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const description = descParts.join("|").trim();

  if (!slug || !description) {
    return reply(
      sock,
      from,
      msg,
      `📌 Uso: *.rpgmodclase <clave> | <nueva descripción de cómo funciona>*\n` +
        `Ejemplo: *.rpgmodclase guerrero | Ahora pelea con dos armas y sangra a sus enemigos*\n\n` +
        `Funciona con clases fijas del juego (guerrero, mago, etc.) y con clases creadas por IA.`
    );
  }

  const current = data.CLASSES[slug];
  if (!current) {
    return reply(sock, from, msg, `⚠️ No existe ninguna clase con la clave \`${slug}\`.`);
  }
  if (current.tier !== "inicial") {
    return reply(
      sock,
      from,
      msg,
      `⚠️ \`${slug}\` es una clase avanzada, no la inicial. Modificá la clase base (la que evoluciona hacia ella) y su ` +
        `evolución se regenera junto con ella.`
    );
  }

  const isCustom = customContent.isCustomClass(slug);
  const advancedKey = isCustom ? customContent.getCustomClassMeta()[slug].advancedKey : current.advancesTo;

  if (!advancedKey || !data.CLASSES[advancedKey]) {
    return reply(sock, from, msg, `⚠️ No se encontró la evolución avanzada de \`${slug}\`; no se puede regenerar el par con seguridad.`);
  }

  await reply(sock, from, msg, "🧠 Regenerando clase con IA, un momento...");

  try {
    const raw = await askAI({
      system: rpgAi.CLASS_SYSTEM_PROMPT,
      prompt: rpgAi.buildClassModPrompt(slug, description),
    });
    const json = extractJson(raw);
    const { inicial, avanzada } = rpgAi.validateClassPair(slug, json, advancedKey);

    if (isCustom) {
      customContent.addCustomClassPair(slug, inicial, avanzada, { rawDescription: description, modifiedAt: new Date().toISOString() });
    } else {
      customContent.setClassOverride(slug, advancedKey, inicial, avanzada, { rawDescription: description });
    }

    return reply(
      sock,
      from,
      msg,
      `✅ *Clase actualizada: ${inicial.emoji} ${inicial.name}*\n` +
        `_${inicial.desc}_\n` +
        `▸ Atributos: ${Object.entries(inicial.baseAttrs)
          .map(([k, v]) => `${k.toUpperCase()} +${v}`)
          .join(", ")}\n` +
        `▸ Habilidades: ${inicial.skills.join(", ")}\n\n` +
        `🌟 Evolución (nivel 15): *${avanzada.emoji} ${avanzada.name}*\n\n` +
        `⚠️ Los jugadores que ya tenían esta clase quedan con las estadísticas nuevas de inmediato.`
    );
  } catch (err) {
    console.error("Error en .rpgmodclase:", err);
    return reply(sock, from, msg, `❌ No se pudo regenerar la clase: ${err.message}`);
  }
}

// .rpgmodraza <clave> | <nueva descripción de cómo funciona>
// Regenera con IA una raza YA EXISTENTE (fija del juego o creada por IA).
async function cmdRpgModRaza(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");

  const full = args.join(" ");
  const [slugRaw, ...descParts] = full.split("|");
  const slug = (slugRaw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const description = descParts.join("|").trim();

  if (!slug || !description) {
    return reply(
      sock,
      from,
      msg,
      `📌 Uso: *.rpgmodraza <clave> | <nueva descripción de cómo funciona>*\n` +
        `Ejemplo: *.rpgmodraza elfo | Ahora son cazadores del desierto resistentes al calor*\n\n` +
        `Funciona con razas fijas del juego (humano, elfo, etc.) y con razas creadas por IA.`
    );
  }

  if (!data.RACES[slug]) {
    return reply(sock, from, msg, `⚠️ No existe ninguna raza con la clave \`${slug}\`.`);
  }

  await reply(sock, from, msg, "🧠 Regenerando raza con IA, un momento...");

  try {
    const raw = await askAI({
      system: rpgAi.RACE_SYSTEM_PROMPT,
      prompt: rpgAi.buildRaceModPrompt(slug, description),
    });
    const json = extractJson(raw);
    const race = rpgAi.validateRace(slug, json);

    if (customContent.isCustomRace(slug)) {
      customContent.addCustomRace(slug, race);
    } else {
      customContent.setRaceOverride(slug, race, { rawDescription: description });
    }

    return reply(
      sock,
      from,
      msg,
      `✅ *Raza actualizada: ${race.emoji} ${race.name}*\n` +
        `_${race.desc}_\n` +
        `▸ Bonos: ${Object.entries(race.bonus)
          .map(([k, v]) => `${k.toUpperCase()} +${v}`)
          .join(", ")}\n` +
        `▸ Pasiva: ${race.passive}\n\n` +
        `⚠️ Los jugadores que ya tenían esta raza quedan con las estadísticas nuevas de inmediato.`
    );
  } catch (err) {
    console.error("Error en .rpgmodraza:", err);
    return reply(sock, from, msg, `❌ No se pudo regenerar la raza: ${err.message}`);
  }
}

async function cmdRpgAdmin(sock, msg, args, senderIsOwnerOrCo) {
  const from = msg.key.remoteJid;
  if (!senderIsOwnerOrCo) return reply(sock, from, msg, "⛔ Comando exclusivo del owner/co-owner del bot.");
  const sub = (args[0] || "").toLowerCase();

  if (sub === "darota" || sub === "daroro") {
    const target = resolveTarget(msg, args.slice(1));
    const amount = parseInt(args[args.length - 1], 10);
    if (!target || !amount) return reply(sock, from, msg, "📌 Uso: *.rpgadmin daroro @mención <cantidad>*");
    if (!requireCharacter(target.number)) return reply(sock, from, msg, "⛔ Esa persona no tiene personaje.");
    rpg.addGold(target.number, amount);
    return reply(sock, from, msg, `✅ Diste ${rpg.formatGold(amount)} a @${target.number}.`, [target.jid]);
  }

  if (sub === "daritem") {
    const target = resolveTarget(msg, args.slice(1));
    const itemId = findItemKeyByNameOrId(args[args.length - 1]);
    if (!target || !itemId) return reply(sock, from, msg, "📌 Uso: *.rpgadmin daritem @mención <item>*");
    if (!requireCharacter(target.number)) return reply(sock, from, msg, "⛔ Esa persona no tiene personaje.");
    const p = rpg.getProfile(target.number);
    rpg.addItem(p, itemId, 1);
    rpg.saveProfile(target.number, p);
    return reply(sock, from, msg, `✅ Diste ${itemLabel(itemId, 1)} a @${target.number}.`, [target.jid]);
  }

  if (sub === "setnivel") {
    const target = resolveTarget(msg, args.slice(1));
    const level = parseInt(args[args.length - 1], 10);
    if (!target || !level || level < 1 || level > rpg.MAX_LEVEL) return reply(sock, from, msg, "📌 Uso: *.rpgadmin setnivel @mención <nivel>*");
    if (!requireCharacter(target.number)) return reply(sock, from, msg, "⛔ Esa persona no tiene personaje.");
    const p = rpg.getProfile(target.number);
    p.level = level;
    p.xp = rpg.xpThreshold(level);
    rpg.saveProfile(target.number, p);
    rpg.healToFull(target.number);
    return reply(sock, from, msg, `✅ @${target.number} ahora es nivel ${level}.`, [target.jid]);
  }

  if (sub === "reset") {
    const target = resolveTarget(msg, args.slice(1));
    if (!target) return reply(sock, from, msg, "📌 Uso: *.rpgadmin reset @mención*");
    const all = require("../lib/db").load("rpg", {});
    delete all[target.number];
    require("../lib/db").save("rpg", all);
    return reply(sock, from, msg, `♻️ Se reinició el personaje de @${target.number}.`, [target.jid]);
  }

  return reply(sock, from, msg, "📌 Uso: *.rpgadmin daroro|daritem|setnivel|reset* @mención ...");
}

// ─────────────────────────────────────────────────────────────
// Router único (llamado desde index.js)
// ─────────────────────────────────────────────────────────────

async function routeRpgCommand(sock, msg, args, sender, isGroup, senderIsOwnerOrCo, command) {
  const from = msg.key.remoteJid;
  const sub = command.slice(3); // saca el prefijo "rpg"

  // Estos dos comandos funcionan siempre, activado o no.
  if (sub === "on") return cmdRpgOn(sock, msg, isGroup, sender, senderIsOwnerOrCo);
  if (sub === "off") return cmdRpgOff(sock, msg, isGroup, sender, senderIsOwnerOrCo);
  if (sub === "") return cmdRpgHelp(sock, msg);

  // Creación/borrado de contenido con IA: son comandos globales del owner,
  // no dependen de que el RPG esté activado en este chat en particular.
  if (sub === "crearclase") return cmdRpgCrearClase(sock, msg, args, senderIsOwnerOrCo);
  if (sub === "crearraza") return cmdRpgCrearRaza(sock, msg, args, senderIsOwnerOrCo);
  if (sub === "modclase") return cmdRpgModClase(sock, msg, args, senderIsOwnerOrCo);
  if (sub === "modraza") return cmdRpgModRaza(sock, msg, args, senderIsOwnerOrCo);
  if (sub === "borrarclase") return cmdRpgBorrarClase(sock, msg, args, senderIsOwnerOrCo);
  if (sub === "borrarraza") return cmdRpgBorrarRaza(sock, msg, args, senderIsOwnerOrCo);

  // Todo lo demás requiere que el RPG esté activado en este chat.
  if (!rpg.enabledChats.isEnabled(from)) {
    return reply(
      sock,
      from,
      msg,
      `🔴 El sistema RPG está desactivado en este chat.\nActívalo con *.rpgon* (requiere ser admin del grupo o owner del bot).`
    );
  }

  switch (sub) {
    case "crear":
      return cmdRpgCrear(sock, msg, args, sender);
    case "perfil":
      return cmdRpgPerfil(sock, msg, args, sender);
    case "stats":
      return cmdRpgStats(sock, msg, sender);
    case "subir":
      return cmdRpgSubir(sock, msg, args, sender);
    case "razas":
      return cmdRpgRazas(sock, msg);
    case "clases":
      return cmdRpgClases(sock, msg);
    case "dioses":
      return cmdRpgDioses(sock, msg);
    case "orar":
      return cmdRpgOrar(sock, msg, args, sender);
    case "ascender":
      return cmdRpgAscender(sock, msg, sender);

    case "inventario":
    case "inv":
      return cmdRpgInventario(sock, msg, sender);
    case "equipar":
      return cmdRpgEquipar(sock, msg, args, sender);
    case "desequipar":
      return cmdRpgDesequipar(sock, msg, args, sender);
    case "usar":
      return cmdRpgUsar(sock, msg, args, sender);
    case "tirar":
      return cmdRpgTirar(sock, msg, args, sender);

    case "regiones":
      return cmdRpgRegiones(sock, msg, sender);
    case "viajar":
      return cmdRpgViajar(sock, msg, args, sender);
    case "explorar":
      return cmdRpgExplorar(sock, msg, sender);
    case "cazar":
      return cmdRpgCazar(sock, msg, sender);

    case "duelo":
      return cmdRpgDuelo(sock, msg, args, sender);
    case "mazmorras":
      return cmdRpgMazmorras(sock, msg, sender);
    case "mazmorra":
      return cmdRpgMazmorra(sock, msg, args, sender);
    case "revivir":
      return cmdRpgRevivir(sock, msg, sender);

    case "tiendanpc":
      return cmdRpgTiendaNpc(sock, msg);
    case "comprarnpc":
      return cmdRpgComprarNpc(sock, msg, args, sender);
    case "mercado":
      return cmdRpgMercado(sock, msg);
    case "vender":
      return cmdRpgVender(sock, msg, args, sender);
    case "comprar":
      return cmdRpgComprar(sock, msg, args, sender);
    case "cancelarventa":
      return cmdRpgCancelarVenta(sock, msg, args, sender);
    case "subasta":
      return cmdRpgSubasta(sock, msg, args, sender);
    case "subastas":
      return cmdRpgSubastas(sock, msg);
    case "pujar":
      return cmdRpgPujar(sock, msg, args, sender);
    case "forjar":
      return cmdRpgForjar(sock, msg, args, sender);
    case "recetas":
      return cmdRpgRecetas(sock, msg, sender);

    case "misiones":
      return cmdRpgMisiones(sock, msg, sender);
    case "reclamar":
      return cmdRpgReclamar(sock, msg, args, sender);
    case "reputacion":
      return cmdRpgReputacion(sock, msg, sender);

    case "gremio":
      return cmdRpgGremio(sock, msg, args, sender);
    case "gremios":
      return cmdRpgGremios(sock, msg);

    case "ranking":
      return cmdRpgRanking(sock, msg, args);

    case "admin":
      return cmdRpgAdmin(sock, msg, args, senderIsOwnerOrCo);

    case "menu":
    case "help":
      return cmdRpgHelp(sock, msg);

    default:
      return reply(sock, from, msg, `❓ Comando RPG desconocido: *.rpg${sub}*.\nEscribí *.rpg* para ver todos los comandos disponibles.`);
  }
}

module.exports = { routeRpgCommand };
