/* ============================================================
   BOT DISCORD — endpoint serverless (Vercel).
   Slash-commands (retrouvent la nuke dont la CIBLE = ce village,
   même logique que le site via js/optimizer.js) :
     /id <village>                  : tableau optimisé (budget ±8s)
     /optimise <village> [seconds]  : optimisé avec un budget ±seconds ;
                                      sans seconds -> temps BRUTS non optimisés.
   Si la nuke n'existe pas → message anglais "à créer sur le site".

   Discord envoie une requête signée (Ed25519) qu'il FAUT vérifier,
   sinon Discord refuse l'endpoint. On lit le corps BRUT (sans
   toucher req.body, sinon Vercel le consomme) pour la vérif.
   ============================================================ */

"use strict";

var nacl = require("tweetnacl");
var optimizer = require("../js/optimizer.js");
var renderTable = require("../lib/render-table.js").renderTable;

// Clé Supabase anon = publique (déjà dans le front). Surchargée par les env si présentes.
var SUPABASE_URL = process.env.SUPABASE_URL || "https://hmhpsojjzpncibydbgqi.supabase.co";
var SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtaHBzb2pqenBuY2lieWRiZ3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4Mzk1MzgsImV4cCI6MjA5NjQxNTUzOH0.gesERetirlCoL_O3MTerFFLVq3sDslqsmqnd-NGNgN0";

// Clé publique Discord (non secrète) : sert à vérifier les signatures.
// Valeur par défaut = celle de l'app, surchargée par l'env si présente.
var DISCORD_PUBLIC_KEY =
  process.env.DISCORD_PUBLIC_KEY ||
  "fabb1ef7f21800fb6c766c00db6dc1259fcac647ae6c49711ee993a587afb9ea";

// Types d'interaction / réponse Discord
var INTERACTION = { PING: 1, COMMAND: 2 };
var REPLY = { PONG: 1, MESSAGE: 4 };
var EPHEMERAL = 64; // message visible seulement par l'utilisateur (flag)

// --- Corps brut : on lit le flux nous-mêmes (NE PAS lire req.body avant) ---
function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signature, timestamp) {
  if (!DISCORD_PUBLIC_KEY || !signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody.toString("utf8")),
      Buffer.from(signature, "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex")
    );
  } catch (e) {
    return false;
  }
}

// Récupère la 1ʳᵉ nuke dont target = village (PostgREST). null si aucune.
function fetchNukeByTarget(village) {
  var url =
    SUPABASE_URL.replace(/\/$/, "") +
    "/rest/v1/nukes?select=*&limit=1&target=eq." +
    encodeURIComponent(village);
  return fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
  })
    .then(function (res) {
      if (!res.ok) throw new Error("Supabase " + res.status);
      return res.json();
    })
    .then(function (rows) { return (rows && rows[0]) || null; });
}

function reply(res, content, ephemeral) {
  res.status(200).json({
    type: REPLY.MESSAGE,
    data: { content: content, flags: ephemeral ? EPHEMERAL : 0 },
  });
}

// Réponse publique qui PING une liste d'utilisateurs. allowed_mentions avec
// parse:[] => seuls les IDs listés pinguent (jamais @everyone/@here par erreur).
function replyWithMentions(res, content, userIds) {
  res.status(200).json({
    type: REPLY.MESSAGE,
    data: {
      content: content,
      allowed_mentions: { parse: [], users: (userIds || []).slice(0, 100) },
    },
  });
}

// Résout des noms Discord -> mentions <@id> via l'API du serveur (recherche de
// membres). Nécessite DISCORD_BOT_TOKEN (env) + bot présent dans le serveur.
// Match EXACT (pseudo serveur, nom global, ou username) pour ne pas pinguer le
// mauvais membre ; tout nom non résolu retombe en texte "@nom" (pas de ping).
function resolveMentions(guildId, names) {
  var token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token || !names.length) {
    return Promise.resolve(names.map(function (n) {
      return { name: n, text: "@" + n, id: null };
    }));
  }
  return Promise.all(names.map(function (name) {
    var url = "https://discord.com/api/v10/guilds/" + guildId +
      "/members/search?limit=5&query=" + encodeURIComponent(name);
    return fetch(url, { headers: { Authorization: "Bot " + token } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (members) {
        var lc = name.toLowerCase();
        var hit = (members || []).find(function (m) {
          var u = m.user || {};
          return (m.nick && m.nick.toLowerCase() === lc) ||
                 (u.global_name && u.global_name.toLowerCase() === lc) ||
                 (u.username && u.username.toLowerCase() === lc);
        });
        var id = hit && hit.user && hit.user.id;
        return id
          ? { name: name, text: "<@" + id + ">", id: id }
          : { name: name, text: "@" + name, id: null };
      })
      .catch(function () { return { name: name, text: "@" + name, id: null }; });
  }));
}

// Tronque un corps Discord à 2000 caractères en gardant le bloc table.
function fitDiscord(richHeader, plainHeader, table) {
  var body = richHeader + "\n```ansi\n" + table + "\n```";
  if (body.length <= 2000) return body;
  body = plainHeader + "\n```ansi\n" + table + "\n```";
  if (body.length <= 2000) return body;
  return "⚠️ This nuke's table is too large to display here (Discord 2000-char limit). Open it on the site.";
}

// Tableau OPTIMISÉ. maxAdj = budget ±s (undefined => défaut 8).
function buildNukeMessage(nuke, village, maxAdj) {
  var result = optimizer.optimize(nuke.participants || [], maxAdj);
  if (!result.rows.length) {
    return "⚠️ Nuke `" + village + "` has no readable participants. Please check it on the site.";
  }
  var table = renderTable(result.rows);

  var header = "**TARGET " + (nuke.target || village) + "**";
  if (nuke.target_player) header += " — " + nuke.target_player;
  if (nuke.side) header += " (" + nuke.side + ")";
  header += " · fire window " + result.fireWindow + "s (max " + result.maxWindow + "s)";
  header += result.impactSpread ? " · impacts spread " + result.impactSpread + "s" : " · perfectly synced";
  header += "\n*Fire @ = fire when the group countdown hits this (caps +" + result.capGap + "s later)*";

  var plain = "**TARGET " + (nuke.target || village) + "** · fire window " + result.fireWindow + "s";
  return fitDiscord(header, plain, table);
}

// Tableau BRUT (non optimisé) : /optimise <id> sans secondes.
function buildRawMessage(nuke, village) {
  var rows = optimizer.rawList(nuke.participants || []);
  if (!rows.length) {
    return "⚠️ Nuke `" + village + "` has no readable participants. Please check it on the site.";
  }
  var table = renderTable(rows);
  var header = "**TARGET " + (nuke.target || village) + "** · RAW times (not optimized)";
  if (nuke.target_player) header += " — " + nuke.target_player;
  return fitDiscord(header, "**TARGET " + (nuke.target || village) + "** · RAW", table);
}

// Annonce de tir (en anglais) : récap cible + side, appel des joueurs de la
// nuke, tir imminent, demande de mettre "+" si prêt. /launch <id>.
// `resolved` = sortie de resolveMentions() : [{ name, text:"<@id>"|"@nom", id }].
function buildLaunchMessage(nuke, village, resolved) {
  var target = nuke.target || village;
  var head = "🎯 **Target:** " + target + (nuke.target_player ? " — " + nuke.target_player : "") +
    "\n🛡️ **Side:** " + (nuke.side || "—");
  var foot = "🚀 The strike on **" + target + "** is imminent — please react with **+** if you are ready.";

  var mentions = (resolved || []).map(function (r) { return r.text; }).join(" ");
  var body = head + "\n\n" + (mentions || "@ everyone in this nuke") + "\n\n" + foot;
  if (body.length <= 2000) return body;

  // Trop de joueurs pour tenir : on garde l'essentiel sans la liste des mentions.
  return head + "\n\n@ everyone in this nuke\n\n" + foot;
}

function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  readRawBody(req)
    .then(function (rawBody) {
      var signature = req.headers["x-signature-ed25519"];
      var timestamp = req.headers["x-signature-timestamp"];

      if (!verifySignature(rawBody, signature, timestamp)) {
        res.status(401).send("invalid request signature");
        return;
      }

      var body;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch (e) {
        res.status(400).send("bad json");
        return;
      }

      // Handshake Discord
      if (body.type === INTERACTION.PING) {
        res.status(200).json({ type: REPLY.PONG });
        return;
      }

      var cmd = body.type === INTERACTION.COMMAND && body.data ? body.data.name : null;
      if (cmd === "id" || cmd === "optimise" || cmd === "launch") {
        var opts = body.data.options || [];
        var villageOpt = opts.find(function (o) { return o.name === "village"; });
        var village = villageOpt ? String(villageOpt.value).trim() : "";
        var secondsOpt = opts.find(function (o) { return o.name === "seconds"; });
        var seconds = secondsOpt != null ? parseInt(secondsOpt.value, 10) : null;

        if (!village) {
          reply(res, "Please provide a village ID, e.g. `/" + cmd + " 41707`.", true);
          return;
        }
        if (cmd === "optimise" && seconds != null && (isNaN(seconds) || seconds < 0)) {
          reply(res, "Seconds must be 0 or more, e.g. `/optimise 41707 8` (omit it for raw times).", true);
          return;
        }

        return fetchNukeByTarget(village)
          .then(function (nuke) {
            if (!nuke) {
              reply(
                res,
                "❌ No nuke found for village `" + village +
                  "`. This nuke has not been created yet — please create it on the site first.",
                true
              );
              return;
            }
            // /launch => annonce de tir : on résout les noms (= noms Discord)
            // en mentions <@id> pour PINGER réellement, puis on répond.
            if (cmd === "launch") {
              var names = (nuke.participants || [])
                .map(function (p) { return (p.name || "").toString().trim(); })
                .filter(function (n) { return n; });
              return resolveMentions(body.guild_id, names).then(function (resolved) {
                var ids = resolved
                  .map(function (r) { return r.id; })
                  .filter(function (id) { return id; });
                replyWithMentions(res, buildLaunchMessage(nuke, village, resolved), ids);
              });
            }
            // /optimise <id> sans secondes => temps bruts ; sinon optimisé ±seconds.
            // /id => optimisé avec le budget par défaut (±8).
            var msg = (cmd === "optimise" && seconds == null)
              ? buildRawMessage(nuke, village)
              : buildNukeMessage(nuke, village, cmd === "optimise" ? seconds : undefined);
            reply(res, msg, false);
          })
          .catch(function () {
            reply(res, "⚠️ Could not reach the database. Please try again in a moment.", true);
          });
      }

      // Commande inconnue
      reply(res, "Unknown command.", true);
    })
    .catch(function () {
      res.status(400).send("bad request");
    });
}

module.exports = handler;
// Vercel : ne PAS parser le corps automatiquement (on a besoin du brut
// pour vérifier la signature Ed25519). Le getter req.body reste de toute
// façon paresseux tant qu'on n'y touche pas — ceci est une double sécurité.
module.exports.config = { api: { bodyParser: false } };
