/* ============================================================
   BOT DISCORD — endpoint serverless (Vercel).
   Même logique de calcul que le site (js/optimizer.js).

   Slash-commands :
     /id_syncro                     : menu catégorie -> village -> plan,
                                      puis tableau OPTIMISÉ (synchro).
     /id_same_time                  : idem mais tableau BRUT (same time).
     /launch_syncro [village]       : récap + PING des joueurs + tableau
                                      optimisé. Sans argument -> même menu de
                                      recherche que /id_* (catégorie -> village
                                      -> plan), puis tir. Choix du plan si >1.
     /launch_same_time [village]    : idem mais tableau brut (same time).
     /optimise <village> [seconds]  : plan principal, optimisé ±seconds ;
                                      sans seconds -> temps BRUTS.

   "syncro" = temps optimisés (synchronisation des impacts).
   "same time" = temps bruts, chacun tire à sa marche (pas d'optimisation).
   Un village peut avoir plusieurs PLANS (variantes) ; le bot propose de
   choisir le plan 1/2/3… ou "tous" (pour /id_*).
   Si la nuke n'existe pas → message anglais "à créer sur le site".

   Discord envoie une requête signée (Ed25519) qu'il FAUT vérifier,
   sinon Discord refuse l'endpoint. On lit le corps BRUT (sans
   toucher req.body, sinon Vercel le consomme) pour la vérif.
   Les composants (menus) et followups passent par le même endpoint.
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
var INTERACTION = { PING: 1, COMMAND: 2, COMPONENT: 3 };
var REPLY = { PONG: 1, MESSAGE: 4, UPDATE: 7 };
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

// GET PostgREST générique (renvoie le JSON décodé). `path` = ce qui suit /rest/v1/.
function sbGet(path) {
  var url = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path;
  return fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
  }).then(function (res) {
    if (!res.ok) throw new Error("Supabase " + res.status);
    return res.json();
  });
}

// Récupère la 1ʳᵉ nuke dont target = village. null si aucune.
function fetchNukeByTarget(village) {
  return sbGet("nukes?select=*&limit=1&target=eq." + encodeURIComponent(village))
    .then(function (rows) { return (rows && rows[0]) || null; });
}

// Récupère une nuke par son id (clé primaire). null si aucune.
function fetchNukeById(id) {
  return sbGet("nukes?select=*&limit=1&id=eq." + encodeURIComponent(id))
    .then(function (rows) { return (rows && rows[0]) || null; });
}

// Liste les catégories (Moldavie, Germany, …) triées par position.
function fetchCategories() {
  return sbGet("categories?select=id,name,position&order=position.asc");
}

// Liste les nukes d'une catégorie (id, target, joueur ciblé), triées par target.
function fetchNukesByCategory(categoryId) {
  return sbGet(
    "nukes?select=id,target,target_player&order=target.asc&category_id=eq." +
      encodeURIComponent(categoryId)
  );
}

function reply(res, content, ephemeral) {
  res.status(200).json({
    type: REPLY.MESSAGE,
    data: { content: content, flags: ephemeral ? EPHEMERAL : 0 },
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

// --- Composants (menus déroulants) -------------------------------------
// Répond à Discord avec un type donné (MESSAGE = nouveau message,
// UPDATE = édite le message du composant cliqué).
function respond(res, replyType, data) {
  res.status(200).json({ type: replyType, data: data });
}

// Action row (type 1) contenant les composants passés en arguments.
function row() {
  return { type: 1, components: Array.prototype.slice.call(arguments) };
}

// Menu déroulant string (type 3). 25 options max côté Discord.
function selectMenu(customId, placeholder, options) {
  return { type: 3, custom_id: customId, placeholder: placeholder, options: options };
}

// --- Variantes (plusieurs PLANS par village) ----------------------------
// Liste des variantes d'une LIGNE Supabase (snake_case). Rétro-compat : si la
// colonne "variants" est absente/vide, on reconstruit une variante unique
// depuis les colonnes de la ligne (side/participants).
function variantsOf(row) {
  if (Array.isArray(row.variants) && row.variants.length) {
    return row.variants.map(function (v) {
      return { label: v.label || "", side: v.side || "", participants: v.participants || [] };
    });
  }
  return [{ label: "", side: row.side || "", participants: row.participants || [] }];
}

// Nom d'un plan : son label, sinon "Plan N".
function planName(v, i) { return (v && v.label) ? v.label : "Plan " + (i + 1); }
// Étiquette pour l'en-tête d'un tableau : vide s'il n'y a qu'un seul plan.
function variantTag(v, i, total) { return total > 1 ? planName(v, i) : ""; }

// Pseudos des participants d'un plan (pour les mentions de /launch_*).
function participantNames(v) {
  return ((v && v.participants) || [])
    .map(function (p) { return (p.name || "").toString().trim(); })
    .filter(function (n) { return n; });
}

function dbError(res) {
  reply(res, "⚠️ Could not reach the database. Please try again.", true);
}

// Description d'un plan sous l'option du menu : la liste des joueurs (noms),
// précédée du side. Limitée à 100 car. (limite Discord) : si ça déborde, on
// coupe et on ajoute "+N" pour les joueurs non listés.
function planDesc(v) {
  var prefix = v.side ? v.side + " · " : "";
  var names = (v.participants || [])
    .map(function (p) { return (p.name || p.id || "?").toString().trim(); })
    .filter(function (n) { return n; });
  if (!names.length) return (prefix + "no players").slice(0, 100);

  var full = prefix + names.join(", ");
  if (full.length <= 100) return full;

  // Trop long : on empile les noms tant que ça tient (en gardant la place pour "+N").
  var out = prefix, count = 0;
  for (var i = 0; i < names.length; i++) {
    var piece = (count ? ", " : "") + names[i];
    var moreTag = " +" + (names.length - count - 1);
    if ((out + piece + moreTag).length > 100) break;
    out += piece; count++;
  }
  if (count === 0) return (prefix + names[0]).slice(0, 99) + "…"; // 1er nom déjà trop long
  if (count < names.length) out += " +" + (names.length - count);
  return out.slice(0, 100);
}

// 1ʳᵉ étape (/id_* ou /launch_*) : choisir une catégorie. mode = "syncro"|"raw".
// kind = préfixe du custom_id : "idc" (affiche un tableau) ou "lc" (lance/ping).
function categoryMenuData(categories, mode, kind) {
  kind = kind || "idc";
  if (!categories || !categories.length) {
    return { content: "No categories yet. Create them on the site first." };
  }
  var options = categories.slice(0, 25).map(function (c) {
    return { label: String(c.name).slice(0, 100), value: String(c.id) };
  });
  return {
    content: "**Pick a category** to see its villages:",
    components: [row(selectMenu(kind + ":" + mode, "Choose a category", options))],
  };
}

// 2ᵉ étape : choisir un village. kind = "idn" (tableau) ou "ln" (lance/ping).
function villageMenuData(categoryName, nukes, mode, kind) {
  kind = kind || "idn";
  if (!nukes || !nukes.length) {
    return { content: "No nukes in **" + categoryName + "** yet.", components: [] };
  }
  var options = nukes.slice(0, 25).map(function (n) {
    var label = n.target_player ? n.target_player + " — " + n.target : String(n.target || n.id);
    return {
      label: label.slice(0, 100),
      value: String(n.id),
      description: ("Target ID " + (n.target || "?")).slice(0, 100),
    };
  });
  var content = "**" + categoryName + "** — choose a village:";
  if (nukes.length > 25) content += "\n*(showing first 25 of " + nukes.length + ")*";
  return { content: content, components: [row(selectMenu(kind + ":" + mode, "Choose a village", options))] };
}

// 3ᵉ étape (si >1 plan) : choisir un plan, ou TOUS pour tout afficher.
function variantMenuData(nuke, variants, mode) {
  var options = variants.slice(0, 24).map(function (v, i) {
    return { label: planName(v, i).slice(0, 100), value: String(i), description: planDesc(v) };
  });
  options.push({ label: "🌐 All plans", value: "all", description: "Show every plan, one message each" });
  return {
    content: "**TARGET " + (nuke.target || "?") + "** has " + variants.length +
      " plans — choose one (or all):",
    components: [row(selectMenu("idv:" + mode + ":" + nuke.id, "Choose a plan", options))],
  };
}

// /launch_* avec plusieurs plans : choisir LE plan à lancer (pas de "tous").
// Pas de flag ici : éphémère posé par l'appelant (réponse initiale) ou hérité
// du message éphémère quand on l'affiche via UPDATE (le ping final reste public).
function launchVariantMenuData(nuke, variants, mode) {
  var options = variants.slice(0, 25).map(function (v, i) {
    return { label: planName(v, i).slice(0, 100), value: String(i), description: planDesc(v) };
  });
  return {
    content: "**TARGET " + (nuke.target || "?") + "** has " + variants.length +
      " plans — which one do you launch?",
    components: [row(selectMenu("lv:" + mode + ":" + nuke.id, "Choose the plan to launch", options))],
  };
}

// Gère un clic sur un menu déroulant (interaction de type COMPONENT).
// custom_id = "<kind>:<mode>[:<villageId>]". value = sélection.
function handleComponent(res, body) {
  var data = body.data || {};
  var parts = (data.custom_id || "").split(":");
  var kind = parts[0];
  var mode = parts[1] === "raw" ? "raw" : "syncro";
  var value = (data.values || [])[0];
  var appId = body.application_id;
  var token = body.token;

  // Catégorie → liste des villages.
  if (kind === "idc") {
    return Promise.all([fetchCategories(), fetchNukesByCategory(value)])
      .then(function (arr) {
        var cats = arr[0] || [], nukes = arr[1] || [];
        var cat = cats.find(function (c) { return String(c.id) === String(value); });
        respond(res, REPLY.UPDATE, villageMenuData(cat ? cat.name : "Category", nukes, mode));
      })
      .catch(function () { dbError(res); });
  }

  // Village → tableau (1 plan) ou menu de plans (>1).
  if (kind === "idn") {
    return fetchNukeById(value).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      if (variants.length <= 1) {
        respond(res, REPLY.MESSAGE, { content: variantTableMessage(nuke, variants[0], mode) });
        return;
      }
      respond(res, REPLY.UPDATE, variantMenuData(nuke, variants, mode));
    }).catch(function () { dbError(res); });
  }

  // Plan choisi (ou TOUS) → tableau(x).
  if (kind === "idv") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      if (value === "all") {
        // TOUS les plans : un message PAR plan (avec couleur). Le 1ᵉʳ part en
        // réponse, les suivants en followups maintenus en vie par waitUntil
        // (sinon la lambda Vercel gèle après la réponse et les perd).
        var msgs = variants.map(function (v, i) {
          return variantTableMessage(nuke, v, mode, { tag: variantTag(v, i, variants.length) });
        });
        respond(res, REPLY.MESSAGE, { content: msgs[0] });
        var rest = msgs.slice(1);
        if (!rest.length) return;
        var task = rest.reduce(function (chain, m) {
          return chain.then(function () { return followup(appId, token, m); });
        }, Promise.resolve());
        if (vercelWaitUntil(task)) return; // Vercel garde la fonction vivante
        return task;                       // fallback : on retourne la promesse
      }
      var idx = parseInt(value, 10); if (isNaN(idx)) idx = 0;
      var v = variants[idx] || variants[0];
      respond(res, REPLY.MESSAGE, {
        content: variantTableMessage(nuke, v, mode, { tag: variantTag(v, idx, variants.length) }),
      });
    }).catch(function () { dbError(res); });
  }

  // [LAUNCH] Catégorie → liste des villages (on édite le menu éphémère).
  if (kind === "lc") {
    return Promise.all([fetchCategories(), fetchNukesByCategory(value)])
      .then(function (arr) {
        var cats = arr[0] || [], nukes = arr[1] || [];
        var cat = cats.find(function (c) { return String(c.id) === String(value); });
        respond(res, REPLY.UPDATE, villageMenuData(cat ? cat.name : "Category", nukes, mode, "ln"));
      })
      .catch(function () { dbError(res); });
  }

  // [LAUNCH] Village → ping direct (1 plan) ou menu de plan (>1).
  if (kind === "ln") {
    return fetchNukeById(value).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      if (variants.length > 1) {
        respond(res, REPLY.UPDATE, launchVariantMenuData(nuke, variants, mode));
        return;
      }
      var v = variants[0];
      return resolveMentions(body.guild_id, participantNames(v)).then(function (resolved) {
        return launchResponse(res, appId, token, nuke, v, mode, resolved, "");
      });
    }).catch(function () { dbError(res); });
  }

  // Plan à lancer (/launch_* multi-plans) → ping public + tableau.
  if (kind === "lv") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      var idx = parseInt(value, 10); if (isNaN(idx)) idx = 0;
      var v = variants[idx] || variants[0];
      return resolveMentions(body.guild_id, participantNames(v)).then(function (resolved) {
        return launchResponse(res, appId, token, nuke, v, mode, resolved, variantTag(v, idx, variants.length));
      });
    }).catch(function () { dbError(res); });
  }

  reply(res, "Unknown interaction.", true);
}

// Tronque un corps Discord à 2000 caractères en gardant le bloc table.
function fitDiscord(richHeader, plainHeader, table) {
  var body = richHeader + "\n```ansi\n" + table + "\n```";
  if (body.length <= 2000) return body;
  body = plainHeader + "\n```ansi\n" + table + "\n```";
  if (body.length <= 2000) return body;
  return "⚠️ This nuke's table is too large to display here (Discord 2000-char limit). Open it on the site.";
}

function emptyTableMsg(target) {
  return "⚠️ Nuke `" + target + "` has no readable participants. Please check it on the site.";
}

// Tableau d'un PLAN. mode "syncro" (optimisé) ou "raw" (brut, non optimisé).
// opts.maxAdj = budget ±s pour /optimise ; opts.tag = libellé du plan ("Plan 2").
function variantTableMessage(row, variant, mode, opts) {
  opts = opts || {};
  var target = row.target || opts.village || "";
  var participants = (variant && variant.participants) || [];
  var side = variant && variant.side;
  var tag = opts.tag ? " · " + opts.tag : "";
  var noColor = !!opts.plain; // "All plans" : tableaux sans couleur pour tenir en 2000 car.

  if (mode === "raw") {
    var rawRows = optimizer.rawList(participants);
    if (!rawRows.length) return emptyTableMsg(target);
    var rawHeader = "**TARGET " + target + "**" +
      (row.target_player ? " — " + row.target_player : "") +
      (side ? " (" + side + ")" : "") + tag + " · SAME TIME — everyone fires together (not optimized)";
    // Pas de colonne "Fire @" : tout le monde tire en même temps.
    return fitDiscord(rawHeader, "**TARGET " + target + "** · SAME TIME",
      renderTable(rawRows, { hideFire: true, noColor: noColor }));
  }

  var result = optimizer.optimize(participants, opts.maxAdj);
  if (!result.rows.length) return emptyTableMsg(target);
  var header = "**TARGET " + target + "**" +
    (row.target_player ? " — " + row.target_player : "") +
    (side ? " (" + side + ")" : "") + tag +
    " · fire window " + result.fireWindow + "s (max " + result.maxWindow + "s)";
  header += result.impactSpread ? " · impacts spread " + result.impactSpread + "s" : " · perfectly synced";
  header += "\n*Fire @ = fire when the group countdown hits this (caps +" + result.capGap + "s later)*";
  var plain = "**TARGET " + target + "** · fire window " + result.fireWindow + "s";
  return fitDiscord(header, plain, renderTable(result.rows, { noColor: noColor }));
}

// Récap de tir (SANS tableau) : cible, side, mentions, GIF. tag = nom du plan.
// `resolved` = sortie de resolveMentions() : [{ name, text:"<@id>"|"@nom", id }].
function buildLaunchPing(row, variant, resolved, tag) {
  var target = row.target || "";
  var head = "🎯 **Target:** " + target + (row.target_player ? " — " + row.target_player : "") +
    "\n🛡️ **Side:** " + ((variant && variant.side) || "—") + (tag ? "  ·  " + tag : "");
  var foot = "🚀 The strike on **" + target + "** is imminent — please react with **+** if you are ready." +
    "\nhttps://media.giphy.com/media/zK5EHMbtwfW1O/giphy.gif";
  var mentions = (resolved || []).map(function (r) { return r.text; }).join(" ");
  var body = head + "\n\n" + (mentions || "@ everyone in this nuke") + "\n\n" + foot;
  if (body.length <= 2000) return body;
  // Trop de joueurs pour tenir : on garde l'essentiel sans la liste des mentions.
  return head + "\n\n@ everyone in this nuke\n\n" + foot;
}

// Message de suivi (followup) via le webhook de l'interaction (valable 15 min,
// pas besoin du bot token). Échec silencieux : un followup raté n'a pas à
// casser la réponse principale déjà envoyée. User-Agent conforme par sécurité.
function followup(appId, token, content) {
  if (!appId || !token || !content) return Promise.resolve();
  var url = "https://discord.com/api/v10/webhooks/" + appId + "/" + token;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://optimisation-goat.vercel.app, 1.0)",
    },
    body: JSON.stringify({ content: content }),
  }).then(function () {}, function () {});
}

// Sur Vercel, la fonction peut "geler" juste après la réponse → les followups
// envoyés ensuite sont perdus. waitUntil prolonge sa vie jusqu'à résolution de
// la promesse. On lit le contexte natif Vercel (sans dépendance) ; false si absent.
function vercelWaitUntil(promise) {
  try {
    var holder = globalThis[Symbol.for("@vercel/request-context")];
    var ctx = holder && typeof holder.get === "function" ? holder.get() : null;
    if (ctx && typeof ctx.waitUntil === "function") { ctx.waitUntil(promise); return true; }
  } catch (e) { /* contexte indisponible */ }
  return false;
}

// Réponse à un /launch_* : récap qui PING + le tableau (mode choisi). Si tout
// tient en 2000 car. → un seul message ; sinon le tableau part en followup.
function launchResponse(res, appId, token, row, variant, mode, resolved, tag) {
  var ping = buildLaunchPing(row, variant, resolved, tag);
  var table = variantTableMessage(row, variant, mode, { tag: tag });
  var ids = (resolved || []).map(function (r) { return r.id; }).filter(function (id) { return id; });
  var allowed = { parse: [], users: ids.slice(0, 100) };
  var combined = ping + "\n" + table;
  if (combined.length <= 2000) {
    res.status(200).json({ type: REPLY.MESSAGE, data: { content: combined, allowed_mentions: allowed } });
    return Promise.resolve();
  }
  res.status(200).json({ type: REPLY.MESSAGE, data: { content: ping, allowed_mentions: allowed } });
  return followup(appId, token, table);
}

function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // On RETOURNE la chaîne : Vercel attend la promesse, donc la fonction reste
  // vivante jusqu'à ce que les followups (table de /launch_*, "all" de /id_*)
  // soient envoyés — sinon la lambda peut geler juste après res.json().
  return readRawBody(req)
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

      // Clic sur un menu déroulant (catégorie / village / plan)
      if (body.type === INTERACTION.COMPONENT) {
        return handleComponent(res, body);
      }

      var cmd = body.type === INTERACTION.COMMAND && body.data ? body.data.name : null;
      var MODE = {
        id_syncro: "syncro", id_same_time: "raw",
        launch_syncro: "syncro", launch_same_time: "raw",
      };

      // /id_syncro | /id_same_time => menu catégorie -> village -> plan -> tableau.
      if (cmd === "id_syncro" || cmd === "id_same_time") {
        return fetchCategories()
          .then(function (cats) { respond(res, REPLY.MESSAGE, categoryMenuData(cats, MODE[cmd])); })
          .catch(function () { dbError(res); });
      }

      // /launch_syncro | /launch_same_time <village> => ping (+ menu de plan si >1).
      if (cmd === "launch_syncro" || cmd === "launch_same_time") {
        var lmode = MODE[cmd];
        var lopts = body.data.options || [];
        var lvOpt = lopts.find(function (o) { return o.name === "village"; });
        var lvillage = lvOpt ? String(lvOpt.value).trim() : "";
        // Sans argument => menu de recherche (éphémère) : catégorie -> village -> ping.
        if (!lvillage) {
          return fetchCategories().then(function (cats) {
            var data = categoryMenuData(cats, lmode, "lc");
            data.flags = EPHEMERAL;
            respond(res, REPLY.MESSAGE, data);
          }).catch(function () { dbError(res); });
        }
        return fetchNukeByTarget(lvillage).then(function (nuke) {
          if (!nuke) {
            reply(res, "❌ No nuke found for village `" + lvillage +
              "`. This nuke has not been created yet — please create it on the site first.", true);
            return;
          }
          var variants = variantsOf(nuke);
          if (variants.length > 1) {
            var menu = launchVariantMenuData(nuke, variants, lmode);
            menu.flags = EPHEMERAL; // réponse initiale : menu visible par toi seul
            respond(res, REPLY.MESSAGE, menu);
            return;
          }
          var v = variants[0];
          return resolveMentions(body.guild_id, participantNames(v)).then(function (resolved) {
            return launchResponse(res, body.application_id, body.token, nuke, v, lmode, resolved, "");
          });
        }).catch(function () { dbError(res); });
      }

      // /optimise <village> [seconds] => plan principal (variante 1).
      // Sans secondes => temps BRUTS ; avec => optimisé avec budget ±seconds.
      if (cmd === "optimise") {
        var oopts = body.data.options || [];
        var ovOpt = oopts.find(function (o) { return o.name === "village"; });
        var ovillage = ovOpt ? String(ovOpt.value).trim() : "";
        var secOpt = oopts.find(function (o) { return o.name === "seconds"; });
        var seconds = secOpt != null ? parseInt(secOpt.value, 10) : null;
        if (!ovillage) {
          reply(res, "Please provide a village ID, e.g. `/optimise 41707`.", true);
          return;
        }
        if (seconds != null && (isNaN(seconds) || seconds < 0)) {
          reply(res, "Seconds must be 0 or more, e.g. `/optimise 41707 8` (omit it for raw times).", true);
          return;
        }
        return fetchNukeByTarget(ovillage).then(function (nuke) {
          if (!nuke) {
            reply(res, "❌ No nuke found for village `" + ovillage +
              "`. This nuke has not been created yet — please create it on the site first.", true);
            return;
          }
          var v = variantsOf(nuke)[0];
          var msg = seconds == null
            ? variantTableMessage(nuke, v, "raw")
            : variantTableMessage(nuke, v, "syncro", { maxAdj: seconds });
          reply(res, msg, false);
        }).catch(function () { dbError(res); });
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
