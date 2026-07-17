// commands/pat.js
const { sendReactionGif } = require("../lib/reactionGifs");

module.exports = async function cmdPat(sock, msg) {
  await sendReactionGif(sock, msg, "pat", "{sender} le dio cariñito a {target} 🥺");
};
