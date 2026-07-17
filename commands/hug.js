// commands/hug.js
const { sendReactionGif } = require("../lib/reactionGifs");

module.exports = async function cmdHug(sock, msg) {
  await sendReactionGif(sock, msg, "hug", "{sender} abrazó a {target} 🤗");
};
