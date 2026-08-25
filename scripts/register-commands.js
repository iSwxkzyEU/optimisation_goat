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

// Argument "village" (requis) pour /optimise.
var villageOption = {
  type: 3, // STRING
  name: "village",
  description: "Targeted village ID (e.g. 41707)",
  required: true,
};

// Argument "village" OPTIONNEL pour /launch_* : vide => menu de recherche
// (catégorie -> village -> plan), sinon tir direct sur cet ID.
var villageOptionLaunch = {
  type: 3, // STRING
  name: "village",
  description: "Village ID (optional — leave empty to browse by category)",
  required: false,
};

// PUT groupé : la liste ci-dessous REMPLACE toutes les commandes existantes.
var commands = [
  {
    // Associe un pseudo EN JEU à son compte Discord : indispensable quand les
    // deux noms diffèrent, sinon le bot ne sait pas qui pinguer.
    name: "link",
    description: "Link your in-game name to your Discord account (so the bot can ping you)",
    options: [{
      type: 3, // STRING
      name: "player",
      description: "Your in-game name, exactly as it appears in the nuke table",
      required: true,
    }],
  },
  {
    name: "unlink",
    description: "Remove an in-game name from your Discord account (all of them if empty)",
    options: [{
      type: 3, // STRING
      name: "player",
      description: "In-game name to unlink (leave empty to remove them all)",
      required: false,
    }],
  },
  {
    // Ouvre un modal (cible + table d'attaque) puis poste une grille de
    // disponibilités HEURE DU JEU (06:00 -> 00:00) que chaque joueur coche.
    name: "plan",
    description: "Plan an attack: paste the table, players vote their GAME TIME availability",
  },
  {
    // Menu catégorie -> village -> plan, puis tableau OPTIMISÉ (synchro).
    name: "id_syncro",
    description: "Browse a village and show its SYNCRO (optimized) launch table",
  },
  {
    // Idem mais tableau BRUT (same time, sans optimisation).
    name: "id_same_time",
    description: "Browse a village and show its SAME-TIME (raw) launch table",
  },
  {
    // Annonce de tir : menu (ou ID direct) + récap + ping + tableau OPTIMISÉ.
    name: "launch_syncro",
    description: "Announce a strike (ping) with the SYNCRO (optimized) table",
    options: [villageOptionLaunch],
  },
  {
    // Annonce de tir : menu (ou ID direct) + récap + ping + tableau BRUT.
    name: "launch_same_time",
    description: "Announce a strike (ping) with the SAME-TIME (raw) table",
    options: [villageOptionLaunch],
  },
  {
    name: "optimise",
    description: "Optimize a nuke within a max fire window (omit seconds for raw times)",
    options: [
      villageOption,
      {
        type: 4, // INTEGER
        name: "seconds",
        description: "Max fire window in seconds (omit to show the raw, unoptimized times)",
        required: false,
        min_value: 0,
        max_value: 60,
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
      console.log("✅ Commandes /link, /unlink, /plan, /id_syncro, /id_same_time, " +
        "/launch_syncro, /launch_same_time et /optimise enregistrées " +
        (GUILD_ID ? "sur le serveur " + GUILD_ID : "globalement") + ".");
      console.log(body);
    });
  })
  .catch(function (e) {
    console.error("Erreur réseau :", e.message);
    process.exit(1);
  });
