// commands/kiss.js
const { sendReactionGif } = require("../lib/reactionGifs");

module.exports = async function cmdKiss(sock, msg) {
  await sendReactionGif(sock, msg, "kiss", "{sender} besó a {target} 😘");
};
