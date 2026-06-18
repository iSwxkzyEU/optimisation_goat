/* ============================================================
   Enregistre la slash-command /id auprès de Discord.
   À lancer UNE FOIS en local (et à relancer si on change la commande) :

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npm run register

   Optionnel : DISCORD_GUILD_ID=... pour un enregistrement INSTANTANÉ
   sur ton serveur (sinon l'enregistrement global peut prendre ~1h).
   Les variables peuvent aussi être mises dans un fichier .env à la racine.
   ============================================================ */

"use strict";

var fs = require("fs");
var path = require("path");

// Mini-chargeur .env (pas de dépendance) : KEY=VALUE par ligne.
(function loadEnv() {
  try {
    var p = path.join(__dirname, "..", ".env");
    fs.readFileSync(p, "utf8").split("\n").forEach(function (line) {
      var m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    });
  } catch (e) { /* pas de .env, on lit les env système */ }
})();

var APP_ID = process.env.DISCORD_APP_ID;
var BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
var GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Manque DISCORD_APP_ID et/ou DISCORD_BOT_TOKEN (env ou .env).");
  process.exit(1);
}

var command = {
  name: "id",
  description: "Show the optimized launch table of the nuke targeting a village",
  options: [
    {
      type: 3, // STRING
      name: "village",
      description: "Targeted village ID (e.g. 41707)",
      required: true,
    },
  ],
};

var url = GUILD_ID
  ? "https://discord.com/api/v10/applications/" + APP_ID + "/guilds/" + GUILD_ID + "/commands"
  : "https://discord.com/api/v10/applications/" + APP_ID + "/commands";

fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bot " + BOT_TOKEN,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(command),
})
  .then(function (res) {
    return res.text().then(function (body) {
      if (!res.ok) {
        console.error("Échec (" + res.status + ") :", body);
        process.exit(1);
      }
      console.log("✅ Commande /id enregistrée " + (GUILD_ID ? "sur le serveur " + GUILD_ID : "globalement") + ".");
      console.log(body);
    });
  })
  .catch(function (e) {
    console.error("Erreur réseau :", e.message);
    process.exit(1);
  });
