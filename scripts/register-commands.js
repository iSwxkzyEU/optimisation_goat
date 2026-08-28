/* ============================================================
   Enregistre les slash-commands du bot auprès de Discord.

   Il n'y en a plus que DEUX, volontairement :
     /id_same_time — le point d'entrée unique. Tout part de là :
                     catégorie -> village -> plan -> aperçu, puis les
                     boutons 📢 Post / ⚙️ Setup / 📁 Create channel /
                     ✅ Ready check / 🚀 Launch, et 🔄 pour basculer
                     entre le tableau SAME-TIME et le tableau OPTIMISÉ.
     /link         — associe un pseudo EN JEU à un compte Discord.
                     Impossible à faire par bouton (c'est un réglage
                     personnel, pas une action de tir), d'où la 2ᵉ commande.
                     `remove: true` sert aussi à délier.

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

// PUT groupé : la liste ci-dessous REMPLACE toutes les commandes existantes.
// Toute commande absente d'ici DISPARAÎT de Discord au prochain `npm run
// register` — c'est ainsi qu'on a retiré /unlink, /plan, /id_syncro,
// /launch_syncro, /launch_same_time et /optimise.
var commands = [
  {
    // LE point d'entrée : catégorie -> village -> plan -> aperçu privé, puis
    // tout se fait aux boutons (publier, éditer, salon, ready check, tir).
    name: "id_same_time",
    description: "Browse a village and show its launch table (everything else is a button)",
  },
  {
    // Associe un pseudo EN JEU à son compte Discord : indispensable quand les
    // deux noms diffèrent, sinon le bot ne sait pas qui pinguer.
    name: "link",
    description: "Link your in-game name to your Discord account (so the bot can ping you)",
    options: [
      {
        type: 3, // STRING
        name: "player",
        description: "Your in-game name, exactly as it appears in the nuke table",
        required: false,
      },
      {
        // Remplace l'ancienne commande /unlink : un lien fautif doit rester
        // effaçable, sinon le bot pinguerait toujours la mauvaise personne.
        type: 5, // BOOLEAN
        name: "remove",
        description: "Unlink instead of linking (leave the name empty to unlink them all)",
        required: false,
      },
    ],
  },
];

var url = GUILD_ID
  ? "https://discord.com/api/v10/applications/" + APP_ID + "/guilds/" + GUILD_ID + "/commands"
  : "https://discord.com/api/v10/applications/" + APP_ID + "/commands";

fetch(url, {
  method: "PUT", // remplace l'ensemble des commandes par la liste `commands`
  headers: {
    Authorization: "Bot " + BOT_TOKEN,
    "Content-Type": "application/json",
    // User-Agent conforme : sans lui, le pare-feu de Discord peut bloquer les
    // routes /applications & /guilds avec un trompeur 403 "internal network
    // error" (code 40333), alors que /users/@me passe. À garder.
    "User-Agent": "DiscordBot (https://vercel.app, 1.0)",
  },
  body: JSON.stringify(commands),
})
  .then(function (res) {
    return res.text().then(function (body) {
      if (!res.ok) {
        console.error("Échec (" + res.status + ") :", body);
        process.exit(1);
      }
      console.log("✅ Commandes /id_same_time et /link enregistrées " +
        (GUILD_ID ? "sur le serveur " + GUILD_ID : "globalement") + ".");
      console.log("   Toutes les autres (/unlink, /plan, /id_syncro, /launch_syncro, " +
        "/launch_same_time, /optimise) ont été retirées.");
      console.log(body);
    });
  })
  .catch(function (e) {
    console.error("Erreur réseau :", e.message);
    process.exit(1);
  });
