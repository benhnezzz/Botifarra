function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

// .ping — reporte de estado del bot: latencia, tiempo de procesamiento y uptime
module.exports = async function cmdPing(sock, msg) {
  const from = msg.key.remoteJid;
  const start = Date.now();

  const messageTimestamp = Number(msg.messageTimestamp) * 1000;
  const latency = messageTimestamp ? start - messageTimestamp : null;

  const uptime = formatUptime(process.uptime());
  const processingTime = Date.now() - start;

  const text =
    `ESTADO DEL SISTEMA\n` +
    `────────────────────\n` +
    `Latencia: ${latency !== null ? `${latency} ms` : "N/A"}\n` +
    `Procesamiento: ${processingTime} ms\n` +
    `Uptime: ${uptime}\n` +
    `────────────────────`;

  await sock.sendMessage(from, { text }, { quoted: msg });
};
