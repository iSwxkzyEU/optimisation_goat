/* ============================================================
   BOT DISCORD — endpoint serverless (Vercel).
   Slash-command /id <village> : retrouve la nuke dont la CIBLE
   (target) est ce village, l'optimise avec la MÊME logique que
   le site (js/optimizer.js), et colle le tableau ASCII.
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

function buildNukeMessage(nuke, village) {
  var result = optimizer.optimize(nuke.participants || []);
  if (!result.rows.length) {
    return "⚠️ Nuke `" + village + "` has no readable participants. Please check it on the site.";
  }
  var table = renderTable(result.rows);

  var header = "**TARGET " + (nuke.target || village) + "**";
  if (nuke.target_player) header += " — " + nuke.target_player;
  if (nuke.side) header += " (" + nuke.side + ")";
  if (result.impactTime) header += " · armies impact " + result.impactTime;
  if (result.capTime) header += " · caps " + result.capTime;
  header += " · send window +" + result.launchWindow + "s";

  var body = header + "\n```ansi\n" + table + "\n```";

  // Garde-fou : limite Discord = 2000 caractères.
  if (body.length > 2000) {
    body = "**TARGET " + (nuke.target || village) + "**\n```ansi\n" + table + "\n```";
    if (body.length > 2000) {
      return "⚠️ This nuke's table is too large to display here (Discord 2000-char limit). Open it on the site.";
    }
  }
  return body;
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

      if (body.type === INTERACTION.COMMAND && body.data && body.data.name === "id") {
        var opts = body.data.options || [];
        var villageOpt = opts.find(function (o) { return o.name === "village"; });
        var village = villageOpt ? String(villageOpt.value).trim() : "";

        if (!village) {
          reply(res, "Please provide a village ID, e.g. `/id 41707`.", true);
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
            reply(res, buildNukeMessage(nuke, village), false);
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
