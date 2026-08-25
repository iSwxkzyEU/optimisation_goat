/* ============================================================
   BOT DISCORD — endpoint serverless (Vercel).
   Même logique de calcul que le site (js/optimizer.js).

   Slash-commands :
     /plan                          : modal (cible + table d'attaque) -> extrait
                                      les joueurs (SHOOTERS), crée/réutilise un
                                      salon PRIVÉ "nuke-<cible>" (accès aux seuls
                                      joueurs de l'attaque) et y poste une grille
                                      de créneaux HEURE DU JEU (06:00 -> 00:00) ;
                                      chaque joueur coche ses dispos, le bot
                                      affiche en direct le meilleur créneau commun.
                                      (Nécessite que le bot ait « Gérer les salons »
                                      + « Gérer les rôles » ; sinon repli sur le
                                      salon courant.)
     /id_syncro                     : menu catégorie -> village -> APERÇU privé
                                      du tableau OPTIMISÉ (synchro), avec trois
                                      boutons : 📢 Post table (publie le tableau
                                      pour tout le monde), ⚙️ Setup (change le
                                      side / les formations, retire ou ajoute un
                                      joueur) et 🚀 Launch (publie + ping + un
                                      message de formation par joueur).
     /id_same_time                  : idem mais tableau BRUT (same time).
     /launch_syncro [village]       : récap + PING des joueurs + tableau
                                      optimisé + un message de formation par
                                      joueur. Sans argument -> même menu de
                                      recherche que /id_* (catégorie -> village
                                      -> plan), puis tir. Choix du plan si >1.
     /launch_same_time [village]    : idem mais tableau brut (same time).

   PUBLICATION : Discord force l'éphémère sur toute réponse à un message
   éphémère (nos menus). Les boutons 📢 / 🚀 postent donc via le BOT
   (POST /channels/{id}/messages) : c'est ça qui rend le tableau visible de
   toute la guilde. Il faut DISCORD_BOT_TOKEN + « Envoyer des messages ».
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
var INTERACTION = { PING: 1, COMMAND: 2, COMPONENT: 3, MODAL_SUBMIT: 5 };
// DEFERRED (5) = "le bot réfléchit…" : on ACK tout de suite (limite 3 s) puis on
// remplit le message via editOriginal() une fois le travail (salon + plan) fait.
// DEFERRED_UPDATE (6) = même chose mais pour un CLIC sur un composant : on garde
// le message tel quel le temps du travail, puis on l'édite (editOriginal).
var REPLY = { PONG: 1, MESSAGE: 4, DEFERRED: 5, DEFERRED_UPDATE: 6, UPDATE: 7, MODAL: 9 };
var EPHEMERAL = 64; // message visible seulement par l'utilisateur (flag)

// Sides et types de formation du site (cf. js/store.js).
var SIDES = ["RIGHT", "LEFT", "FRONT", "BACK"];
var FORM_TYPES = ["50", "90", "110", "Barrack"];

// Cadence d'envoi des messages "1 joueur = 1 message" : Discord limite un salon
// à ~5 messages / 5 s, donc on espace d'un peu plus d'une seconde.
var POST_GAP_MS = 1100;
var MAX_PLAYER_PINGS = 30; // garde-fou (durée de la lambda)
var MAX_ATTACH_BYTES = 8 * 1024 * 1024; // au-delà, on remet le lien en clair

// --- Appel "je suis prêt" sur le message de tir --------------------------
// Le message PORTE son propre état : la liste des prêts et celle des joueurs
// attendus sont écrites dedans, sous forme de mentions. Un clic relit ces deux
// lignes, y déplace le joueur et ré-affiche le message. Aucune table à gérer,
// et ça marche encore des jours plus tard (pas d'expiration).
var READY_TAG = "✅ **Ready";
var WAIT_TAG = "⏳ **Waiting";
var ALL_READY = "🔥 **Everyone is ready — GO!**";

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

// DELETE PostgREST (pas de corps : PostgREST n'en attend pas).
function sbDelete(path) {
  var url = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path;
  return fetch(url, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) { throw new Error("Supabase " + res.status + " " + t); });
    }
    return null;
  });
}

// Écriture PostgREST générique (POST/PATCH/…). `extra` = en-têtes additionnels
// (ex. Prefer: return=representation / resolution=merge-duplicates). Renvoie le
// JSON décodé, ou null si la réponse est vide (204 / return=minimal).
function sbWrite(method, path, payload, extra) {
  var url = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path;
  var headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: "Bearer " + SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (extra) Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
  return fetch(url, { method: method, headers: headers, body: JSON.stringify(payload) })
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error("Supabase " + res.status + " " + t); });
      }
      return res.status === 204 ? null : res.json().catch(function () { return null; });
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

// Fichiers de formation uploadés sur le site : une ligne par fichier
// (side = RIGHT/LEFT/FRONT/BACK, type = 50/90/110/Barrack, url = lien public).
// Jamais bloquant : en cas d'erreur on renvoie une liste vide.
function fetchFormationFiles() {
  return sbGet("formations?select=side,type,name,url")
    .catch(function () { return []; });
}

// Liste des types de formation : les 4 d'origine + tous ceux qui existent en
// base (la colonne "type" est libre, on peut en ajouter depuis le site).
function formTypesOf(files) {
  var out = [], seen = {};
  function push(t) {
    t = String(t == null ? "" : t).trim();
    var k = t.toLowerCase();
    if (!t || seen[k]) return;
    seen[k] = true;
    out.push(t);
  }
  FORM_TYPES.forEach(push);
  (files || []).forEach(function (f) { push(f && f.type); });
  return out;
}

// Type de formation d'une ligne de joueur. D'abord le NOM EXACT d'un type
// connu (y compris ceux ajoutés sur le site), sinon on le devine depuis le
// texte ("90 form", "F110NOCAPS", "Barrack"). null sinon.
// Miroir de formTypeOf() du site (js/app.js) : même règle des deux côtés.
function formTypeOf(formation, files) {
  var s = String(formation || "").trim();
  if (!s) return null;
  var hit = formTypesOf(files).find(function (t) {
    return t.toLowerCase() === s.toLowerCase();
  });
  if (hit) return hit;
  var lc = s.toLowerCase();
  if (/barrack/.test(lc)) return "Barrack";
  var m = lc.match(/(110|90|50)/);
  return m ? m[1] : null;
}

// Fichier de formation d'un joueur. On regarde d'abord le NOM EXACT du fichier
// ("50 - Centre") : c'est ce qui permet d'avoir plusieurs 50 sur un même côté
// et de donner le bon à chacun. Sinon on retombe sur le 1ᵉʳ fichier du type
// deviné ("50"). null si rien ne colle. Miroir de formationFileFor() du site.
function pickFormationFile(files, side, formation) {
  var want = String(formation || "").trim().toLowerCase();
  if (!want) return null;
  var s = String(side || "").toUpperCase();
  function onSide(f) { return f && f.url && String(f.side || "").toUpperCase() === s; }

  var named = (files || []).find(function (f) {
    return onSide(f) && String(f.name || "").trim().toLowerCase() === want;
  });
  if (named) return named;

  var type = formTypeOf(formation, files);
  if (!type) return null;
  var t = type.toLowerCase();
  var hit = (files || []).find(function (f) {
    return onSide(f) && String(f.type || "").toLowerCase() === t;
  });
  return hit || null;
}

// Étiquette COURTE pour la colonne "Form" du tableau ASCII : un nom de fichier
// ("50 - Centre") ferait exploser la largeur de la colonne, on n'y met donc que
// le type. Les noms courts (types maison comme "Siege") passent tels quels.
function shortFormation(formation) {
  var s = String(formation == null ? "" : formation).trim();
  if (s.length <= 8) return s;
  var lc = s.toLowerCase();
  if (/barrack/.test(lc)) return "Barrack";
  var m = lc.match(/(110|90|50)/);
  return m ? m[1] : s.slice(0, 8);
}

// --- Brouillons de tir (bouton "Setup" du bot) --------------------------
// Un brouillon = une COPIE de travail d'un plan : side / formations / joueurs
// modifiables depuis Discord SANS toucher au plan enregistré sur le site.
// Il vit le temps de la préparation ; le bouton Launch le publie.
function createDraft(draft) {
  return sbWrite("POST", "nuke_drafts", draft, { Prefer: "return=representation" })
    .then(function (rows) { return (rows && rows[0]) || null; });
}
function fetchDraft(id) {
  return sbGet("nuke_drafts?select=*&limit=1&id=eq." + encodeURIComponent(id))
    .then(function (rows) { return (rows && rows[0]) || null; });
}
// Dernier brouillon d'un village pour un mode donné : c'est lui qu'on rouvre
// quand on reclique ⚙️ Setup, pour ne PAS avoir à tout refaire à chaque tir
// (même compo, mêmes formations, mêmes joueurs exclus). null s'il n'y en a pas.
function findDraft(nukeId, mode) {
  return sbGet("nuke_drafts?select=*&limit=1&order=created_at.desc" +
    "&nuke_id=eq." + encodeURIComponent(nukeId) +
    "&mode=eq." + encodeURIComponent(mode))
    .then(function (rows) { return (rows && rows[0]) || null; });
}
// PATCH + return=representation : une seule requête pour écrire ET relire.
function patchDraft(id, patch) {
  return sbWrite("PATCH", "nuke_drafts?id=eq." + encodeURIComponent(id), patch,
    { Prefer: "return=representation" })
    .then(function (rows) { return (rows && rows[0]) || null; });
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

// Appel REST authentifié au bot (token Bot). `path` commence par "/". Renvoie le
// JSON décodé (null si 204). Rejette si pas de token ou si Discord répond en
// erreur (ex. permission « Gérer les salons » manquante) — l'appelant décide quoi
// faire de l'échec (cf. handlePlanModal qui retombe sur le salon courant).
function discordBot(method, path, payload) {
  var token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return Promise.reject(new Error("DISCORD_BOT_TOKEN manquant"));
  var opts = {
    method: method,
    headers: {
      Authorization: "Bot " + token,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://optimisation-goat.vercel.app, 1.0)",
    },
  };
  if (payload != null) opts.body = JSON.stringify(payload);
  return fetch("https://discord.com/api/v10" + path, opts).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) { throw new Error("Discord " + r.status + " " + t); });
    }
    return r.status === 204 ? null : r.json().catch(function () { return null; });
  });
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
// opts.min / opts.max = min_values / max_values (multi-sélection).
function selectMenu(customId, placeholder, options, opts) {
  var menu = { type: 3, custom_id: customId, placeholder: placeholder, options: options };
  if (opts) {
    if (opts.min != null) menu.min_values = opts.min;
    if (opts.max != null) menu.max_values = opts.max;
  }
  return menu;
}

// Champ texte d'un modal (type 4). style 1 = court, 2 = paragraphe.
// DOIT être seul dans son action row (row(textInput(...))).
function textInput(customId, label, opts) {
  opts = opts || {};
  var c = { type: 4, custom_id: customId, label: label, style: opts.style || 1 };
  if (opts.required != null) c.required = opts.required;
  if (opts.placeholder) c.placeholder = opts.placeholder;
  if (opts.max_length) c.max_length = opts.max_length;
  if (opts.min_length) c.min_length = opts.min_length;
  if (opts.value) c.value = opts.value;
  return c;
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

// Bouton (type 2). style : 1=primary, 2=secondary, 3=success, 4=danger.
function button(customId, label, opts) {
  opts = opts || {};
  var b = { type: 2, style: opts.style || 2, custom_id: customId, label: label };
  if (opts.emoji) b.emoji = { name: opts.emoji };
  if (opts.disabled) b.disabled = true;
  return b;
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

// Ajoute un bandeau au-dessus du tableau — SEULEMENT s'il tient dans les
// 2000 caractères de Discord (sinon on garde le tableau seul, prioritaire).
function withNote(content, note) {
  var full = note + "\n" + content;
  return full.length <= 2000 ? full : content;
}

// APERÇU (éphémère) d'un plan : le tableau tel qu'il sera publié + les actions.
// Rien n'est visible des autres tant qu'on n'a pas cliqué 📢 Post ou 🚀 Launch —
// c'est le « bouton de confirmation » demandé : on regarde, puis on publie.
//   ◀ / (i/N) / ▶  : navigation entre les plans (si le village en a plusieurs)
//   📢 Post table  : publie le tableau dans le salon, visible de tous
//   ⚙️ Setup       : ouvre l'éditeur (side / formations / joueurs)
//   🚀 Launch      : publie le tableau + ping + 1 message de formation par joueur
// custom_id : "<action>:<mode>:<nukeId>:<index>".
function previewData(nuke, variants, mode, index) {
  var total = variants.length;
  if (index < 0) index = 0;
  if (index > total - 1) index = total - 1;
  var v = variants[index];
  var content = variantTableMessage(nuke, v, mode, { tag: variantTag(v, index, total) });
  var suffix = mode + ":" + nuke.id + ":" + index;
  var comps = [];
  if (total > 1) {
    comps.push(row(
      button("vnav:" + mode + ":" + nuke.id + ":" + (index - 1), "◀ Previous",
        { disabled: index <= 0 }),
      button("vnav_count", (index + 1) + " / " + total, { disabled: true }),
      button("vnav:" + mode + ":" + nuke.id + ":" + (index + 1), "Next ▶",
        { disabled: index >= total - 1 })
    ));
  }
  comps.push(row(
    button("post:" + suffix, "Post table", { style: 1, emoji: "📢" }),
    button("setup:" + suffix, "Setup", { style: 2, emoji: "⚙️" }),
    button("lnow:" + suffix, "Launch", { style: 3, emoji: "🚀" })
  ));
  // Aucun ping : ceci n'affiche que la cible + le tableau. parse:[] neutralise
  // toute mention qui se glisserait dans le contenu (nom de joueur, etc.).
  return {
    content: withNote(content, "*Preview — you alone see this. **📢 Post** shows the " +
      "table to everyone, **⚙️ Setup** edits it, **🚀 Launch** posts it and pings each player.*"),
    components: comps,
    allowed_mentions: { parse: [] },
  };
}

// --- Éditeur de tir ("Setup") -------------------------------------------
// Le brouillon (nuke_drafts) est une copie de travail : on y change le side,
// les formations, on retire/ajoute des joueurs, et on publie quand c'est prêt.
// Le plan enregistré sur le site n'est JAMAIS modifié.

// Objets "façon nuke"/"façon variante" attendus par variantTableMessage().
function draftRow(draft) {
  return { target: draft.target || "", target_player: draft.target_player || "" };
}
function draftVariant(draft) {
  return {
    label: draft.label || "",
    side: draft.side || "",
    participants: draft.participants || [],
  };
}

// Retrouve l'index d'un plan depuis son libellé ("Plan 2"). Sert au ♻️ Reset :
// on stocke le libellé, pas l'index, donc on le ré-associe au chargement.
function variantIndexByTag(variants, tag) {
  if (!tag) return 0;
  for (var i = 0; i < variants.length; i++) {
    if (planName(variants[i], i) === tag) return i;
  }
  return 0;
}

// Brouillon NEUF construit depuis le plan enregistré sur le site.
function draftFromNuke(nuke, mode, index, userId) {
  var variants = variantsOf(nuke);
  if (index < 0 || index >= variants.length) index = 0;
  var v = variants[index];
  return {
    nuke_id: nuke.id,
    target: nuke.target || "",
    target_player: nuke.target_player || "",
    mode: mode,
    side: v.side || "",
    label: variantTag(v, index, variants.length),
    participants: (v.participants || []).map(cloneParticipant),
    created_by: userId || "",
  };
}

// Copie d'un joueur dans le brouillon (on ne garde que ce qui sert au calcul
// et à l'affichage). formLock = formation imposée à la main dans l'éditeur.
function cloneParticipant(p) {
  p = p || {};
  return {
    id: p.id || "",
    name: p.name || "",
    type: p.type || "",
    qty: p.qty || "",
    march: p.march || "",
    side: p.side || "",
    formation: p.formation || "",
    formLock: !!p.formLock,
  };
}

// Marque une option de menu comme pré-sélectionnée. On passe par la notation
// crochets : "default" est un mot réservé en ES3, et scripts/syntax-check.js
// (JScript) refuse de parser le fichier s'il le voit en clé littérale.
function selected(option, isDefault) {
  if (isDefault) option["default"] = true;
  return option;
}

// Sous-titre d'une option de joueur : type · card · marche · formation.
function playerDesc(p) {
  var bits = [];
  if (p.type) bits.push(p.type);
  if (p.qty) bits.push(p.qty);
  if (p.march) bits.push(p.march);
  if (p.formation) bits.push("form " + p.formation);
  return (bits.join(" · ") || "—").slice(0, 100);
}

// Options "joueur" (valeur = index dans le brouillon, re-généré à chaque rendu).
function playerOptions(draft) {
  return (draft.participants || []).slice(0, 25).map(function (p, i) {
    return {
      label: String(p.name || p.id || "Player " + (i + 1)).slice(0, 100),
      value: String(i),
      description: playerDesc(p),
    };
  });
}

// Panneau principal de l'éditeur : aperçu du tableau + 4 rangées d'actions.
function draftPanelData(draft) {
  var content = variantTableMessage(draftRow(draft), draftVariant(draft), draft.mode,
    { tag: draft.label || "" });
  var players = playerOptions(draft);
  var comps = [
    row(selectMenu("drs:" + draft.id, "Side — " + (draft.side || "not set"),
      SIDES.map(function (s) {
        return selected({ label: s, value: s }, s === draft.side);
      }))),
  ];
  if (players.length) {
    comps.push(row(selectMenu("drp:" + draft.id, "Set a player's formation", players)));
    comps.push(row(selectMenu("drx:" + draft.id, "Remove player(s)", players,
      { min: 0, max: players.length })));
  }
  comps.push(row(
    button("dra:" + draft.id, "Add player", { emoji: "➕" }),
    button("drz:" + draft.id, "Reset", { emoji: "♻️" }),
    button("drpost:" + draft.id, "Post table", { style: 1, emoji: "📢" }),
    button("drl:" + draft.id, "Launch", { style: 3, emoji: "🚀" })
  ));
  var note = "*Setup — you alone see this. It is remembered for this village: " +
    "next time, ⚙️ Setup reopens this exact comp. **♻️ Reset** starts again from " +
    "the site's plan. The plan on the site is never modified.*";
  if ((draft.participants || []).length > 25) {
    note += "\n*(only the first 25 players can be edited here)*";
  }
  return {
    content: withNote(content, note),
    components: comps,
    allowed_mentions: { parse: [] },
  };
}

// Deuxième écran de l'éditeur : la formation d'UN joueur. "Auto" rend la main
// à l'optimiseur (90 pour la 1ʳᵉ armée, 110 pour les autres, 50 pour le cap).
// `files` = fichiers du site. On propose d'abord les fichiers NOMMÉS du côté
// du joueur ("50 - Centre", "50 - Corner") — c'est ce qui permet de donner un
// fichier précis à chacun — puis les types génériques (50, 90, …).
function draftFormPanelData(draft, index, files) {
  var p = (draft.participants || [])[index] || {};
  var side = String(p.side || draft.side || "").toUpperCase();
  var cur = String(p.formation || "");
  var options = [selected({
    label: "Auto (computed)", value: "auto",
    description: "Let the optimizer pick the formation",
  }, !p.formLock)];
  var seen = {};
  function add(label, description) {
    var v = String(label).slice(0, 100);
    if (!v || seen[v.toLowerCase()] || options.length >= 25) return;
    seen[v.toLowerCase()] = true;
    var o = { label: v, value: v };
    if (description) o.description = String(description).slice(0, 100);
    options.push(selected(o, !!p.formLock && cur === v));
  }
  (files || []).forEach(function (f) {
    if (f && f.name && String(f.side || "").toUpperCase() === side) {
      add(f.name, side + " · " + (f.type || "?"));
    }
  });
  formTypesOf(files).forEach(function (t) { add(t, "Any " + t + " file for the side"); });
  return {
    content: "⚙️ **Formation for " + (p.name || p.id || "this player") + "** — pick one:",
    components: [
      row(selectMenu("drf:" + draft.id + ":" + index, "Choose a formation", options)),
      row(button("drb:" + draft.id, "Back to setup", { emoji: "◀" })),
    ],
    allowed_mentions: { parse: [] },
  };
}

// Modal "➕ Add player" (5 champs max côté Discord ; la formation se règle
// ensuite avec le menu "Set a player's formation").
function addPlayerModalData(draftId) {
  return {
    custom_id: "dram:" + draftId,
    title: "Add a player",
    components: [
      row(textInput("name", "Player name", { style: 1, required: true, max_length: 60 })),
      row(textInput("march", "March time (e.g. 1h21m42s)", { style: 1, required: true, max_length: 20 })),
      row(textInput("type", "Type — army or cap", { style: 1, required: false, max_length: 10, placeholder: "army" })),
      row(textInput("qty", "Card (x2 … x6)", { style: 1, required: false, max_length: 10, placeholder: "x4" })),
      row(textInput("pid", "Player ID (optional)", { style: 1, required: false, max_length: 20 })),
    ],
  };
}

function draftGone(res) {
  reply(res, "❌ This setup is no longer available — run the command again.", true);
}

// La table nuke_drafts n'existe pas encore (SQL pas rejoué) ou Supabase répond mal.
function draftDbError(res) {
  reply(res, "⚠️ Setup needs the `nuke_drafts` table — re-run `supabase-setup.sql` " +
    "in Supabase (SQL Editor), then try again.", true);
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

  // Village → APERÇU du plan (éphémère) : tableau + boutons Post / Setup /
  // Launch, et les flèches ◀ ▶ si le village a plusieurs plans. On UPDATE le
  // menu éphémère : rien n'est encore visible des autres.
  if (kind === "idn") {
    return fetchNukeById(value).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      respond(res, REPLY.UPDATE, previewData(nuke, variantsOf(nuke), mode, 0));
    }).catch(function () { dbError(res); });
  }

  // Flèches de navigation entre variantes (◀ / Suivant ▶) → ré-affiche
  // l'aperçu de la variante ciblée dans le MÊME message (UPDATE).
  if (kind === "vnav") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var idx = parseInt(parts[3], 10); if (isNaN(idx)) idx = 0;
      respond(res, REPLY.UPDATE, previewData(nuke, variantsOf(nuke), mode, idx));
    }).catch(function () { dbError(res); });
  }

  // 📢 Post table → publie le tableau du plan dans le salon (visible de TOUS).
  if (kind === "post") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      var idx = parseInt(parts[3], 10); if (isNaN(idx)) idx = 0;
      var v = variants[idx] || variants[0];
      return publishAndAck(res, body, {
        content: variantTableMessage(nuke, v, mode, { tag: variantTag(v, idx, variants.length) }),
        allowed_mentions: { parse: [] },
      });
    }).catch(function () { dbError(res); });
  }

  // ⚙️ Setup → ROUVRE le brouillon de ce village s'il existe (même compo,
  // mêmes formations, mêmes joueurs exclus qu'au dernier tir), sinon en crée
  // un depuis le plan du site.
  if (kind === "setup") {
    return Promise.all([fetchNukeById(parts[2]), findDraft(parts[2], mode)])
      .then(function (arr) {
        var nuke = arr[0], existing = arr[1];
        if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
        if (existing) { respond(res, REPLY.UPDATE, draftPanelData(existing)); return; }
        var idx = parseInt(parts[3], 10); if (isNaN(idx)) idx = 0;
        return createDraft(draftFromNuke(nuke, mode, idx, interactionUser(body).id))
          .then(function (draft) {
            if (!draft) { draftDbError(res); return; }
            respond(res, REPLY.UPDATE, draftPanelData(draft));
          });
      }).catch(function () { draftDbError(res); });
  }

  // 🚀 Launch (depuis l'aperçu) → tableau public + ping + formations.
  if (kind === "lnow") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      var idx = parseInt(parts[3], 10); if (isNaN(idx)) idx = 0;
      var v = variants[idx] || variants[0];
      return doLaunch(res, body, nuke, v, mode, variantTag(v, idx, variants.length),
        { nukeId: nuke.id, index: idx });
    }).catch(function () { dbError(res); });
  }

  // --- Éditeur de tir (brouillon) ---------------------------------------
  // Side choisi : un seul aller-retour (PATCH + relecture) puis re-rendu.
  if (kind === "drs") {
    return patchDraft(parts[1], { side: value }).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      respond(res, REPLY.UPDATE, draftPanelData(draft));
    }).catch(function () { draftDbError(res); });
  }

  // Joueur choisi → écran "quelle formation pour lui ?" (types du site inclus).
  if (kind === "drp") {
    return Promise.all([fetchDraft(parts[1]), fetchFormationFiles()])
      .then(function (arr) {
        var draft = arr[0];
        if (!draft) { draftGone(res); return; }
        var i = parseInt(value, 10); if (isNaN(i)) i = 0;
        respond(res, REPLY.UPDATE, draftFormPanelData(draft, i, arr[1]));
      }).catch(function () { draftDbError(res); });
  }

  // ♻️ Reset → on repart du plan enregistré sur le site (on jette la compo).
  if (kind === "drz") {
    return fetchDraft(parts[1]).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      if (!draft.nuke_id) { draftGone(res); return; }
      return fetchNukeById(draft.nuke_id).then(function (nuke) {
        if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
        var variants = variantsOf(nuke);
        var idx = variantIndexByTag(variants, draft.label);
        var fresh = draftFromNuke(nuke, draft.mode, idx, draft.created_by);
        return patchDraft(draft.id, {
          side: fresh.side, label: fresh.label, participants: fresh.participants,
        }).then(function (saved) {
          respond(res, REPLY.UPDATE, draftPanelData(saved || draft));
        });
      });
    }).catch(function () { draftDbError(res); });
  }

  // Formation choisie pour le joueur d'index parts[2] ("auto" = laisse calculer).
  if (kind === "drf") {
    return fetchDraft(parts[1]).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      var i = parseInt(parts[2], 10); if (isNaN(i)) i = 0;
      var ps = draft.participants || [];
      if (ps[i]) {
        if (value === "auto") { ps[i].formation = ""; ps[i].formLock = false; }
        else { ps[i].formation = value; ps[i].formLock = true; }
      }
      return patchDraft(draft.id, { participants: ps }).then(function (saved) {
        respond(res, REPLY.UPDATE, draftPanelData(saved || draft));
      });
    }).catch(function () { draftDbError(res); });
  }

  // Joueur(s) retiré(s) du tir (multi-sélection ; rien de coché = rien à faire).
  if (kind === "drx") {
    return fetchDraft(parts[1]).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      var kill = {};
      (data.values || []).forEach(function (v) { kill[String(parseInt(v, 10))] = true; });
      var ps = (draft.participants || []).filter(function (p, i) { return !kill[String(i)]; });
      return patchDraft(draft.id, { participants: ps }).then(function (saved) {
        respond(res, REPLY.UPDATE, draftPanelData(saved || draft));
      });
    }).catch(function () { draftDbError(res); });
  }

  // ➕ Add player → modal (la suite se passe dans handleAddPlayerModal).
  if (kind === "dra") {
    respond(res, REPLY.MODAL, addPlayerModalData(parts[1]));
    return Promise.resolve();
  }

  // ◀ Back to setup depuis l'écran formation.
  if (kind === "drb") {
    return fetchDraft(parts[1]).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      respond(res, REPLY.UPDATE, draftPanelData(draft));
    }).catch(function () { draftDbError(res); });
  }

  // 📢 / 🚀 depuis l'éditeur : on publie le BROUILLON (side + formations +
  // joueurs tels qu'ils viennent d'être réglés), pas le plan du site.
  if (kind === "drpost" || kind === "drl") {
    return fetchDraft(parts[1]).then(function (draft) {
      if (!draft) { draftGone(res); return; }
      if (kind === "drpost") {
        return publishAndAck(res, body, {
          content: variantTableMessage(draftRow(draft), draftVariant(draft), draft.mode,
            { tag: draft.label || "" }),
          allowed_mentions: { parse: [] },
        });
      }
      // Le 🏆 Success classe la nuke ENREGISTRÉE : on retrouve son plan via le
      // libellé du brouillon (l'index n'est pas stocké).
      return fetchNukeById(draft.nuke_id).then(function (nuke) {
        var origin = nuke
          ? { nukeId: nuke.id, index: variantIndexByTag(variantsOf(nuke), draft.label) }
          : null;
        return doLaunch(res, body, draftRow(draft), draftVariant(draft), draft.mode,
          draft.label || "", origin);
      });
    }).catch(function () { draftDbError(res); });
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
      return doLaunch(res, body, nuke, variants[0], mode, "", { nukeId: nuke.id, index: 0 });
    }).catch(function () { dbError(res); });
  }

  // Plan à lancer (/launch_* multi-plans) → ping public + tableau.
  if (kind === "lv") {
    return fetchNukeById(parts[2]).then(function (nuke) {
      if (!nuke) { reply(res, "❌ This village no longer exists.", true); return; }
      var variants = variantsOf(nuke);
      var idx = parseInt(value, 10); if (isNaN(idx)) idx = 0;
      var v = variants[idx] || variants[0];
      return doLaunch(res, body, nuke, v, mode, variantTag(v, idx, variants.length),
        { nukeId: nuke.id, index: idx });
    }).catch(function () { dbError(res); });
  }

  // ✅ I'm ready / ↩️ Not ready sur le message de tir. L'état vit DANS le
  // message : on le relit, on y déplace le joueur, on ré-affiche. Quand le
  // dernier bascule, le bot annonce le "tout le monde est prêt" à part.
  if (kind === "rdy" || kind === "nrdy") {
    var who = interactionUser(body);
    var msg = (body.message && body.message.content) || "";
    var chan = interactionChannelId(body);
    var out = applyReadyClick(msg, who.id, who.name, kind === "rdy");

    // Inconnu, mais des joueurs non retrouvés restent à pourvoir : on lui
    // demande lequel il est (menu éphémère).
    if (out.status === "claim") {
      respond(res, REPLY.MESSAGE,
        claimMenuData(chan, (body.message && body.message.id) || "", out.names));
      return Promise.resolve();
    }
    if (out.status === "absent") {
      reply(res, "You're not in this nuke — nothing to confirm here.", true);
      return Promise.resolve();
    }
    // Déjà dans cet état : on le dit, plutôt que de laisser croire à un bug.
    if (out.status === "same") {
      reply(res, kind === "rdy"
        ? "You're already marked **ready** — hit ↩️ *Not ready* to step back."
        : "You're already marked **not ready**.", true);
      return Promise.resolve();
    }

    respond(res, REPLY.UPDATE, {
      content: out.content,
      // On garde les boutons du message (prêt + éventuel Success).
      components: (body.message && body.message.components) || readyComponents(),
      allowed_mentions: { parse: [] }, // ré-affichage : on NE re-pingue personne
    });
    return readyFollowUp(out, chan, body.application_id, body.token, who.name);
  }

  // Le joueur a désigné qui il est dans le menu : on édite le message de tir
  // par l'API (le menu, lui, vit dans un message éphémère à part).
  if (kind === "rdyc") {
    var cid = parts[1], mid = parts[2];
    var claimer = interactionUser(body);
    var appId2 = body.application_id, token2 = body.token;
    deferFor(res, body);
    var claimWork = discordBot("GET", "/channels/" + cid + "/messages/" + mid)
      .then(function (m) {
        var done = applyReadyClaim((m && m.content) || "", claimer.id, value);
        if (done.status !== "ok") {
          return editOriginal(appId2, token2, {
            content: "⚠️ **" + value + "** was already taken — nothing changed.",
            components: [],
          });
        }
        return discordBot("PATCH", "/channels/" + cid + "/messages/" + mid, {
          content: done.content,
          components: (m && m.components) || readyComponents(),
          allowed_mentions: { parse: [] },
        }).then(function () {
          return editOriginal(appId2, token2, {
            content: "✅ You're marked **ready** as **" + value + "**.",
            components: [],
          });
        }).then(function () {
          return readyFollowUp(done, cid, appId2, token2, value);
        });
      })
      .catch(function () {
        return editOriginal(appId2, token2,
          { content: "❌ Couldn't update the strike message.", components: [] });
      });
    vercelWaitUntil(claimWork);
    return claimWork;
  }

  // 🏆 Success -> confirmation, parce que ça SUPPRIME la nuke du site.
  if (kind === "ok") {
    respond(res, REPLY.MESSAGE, {
      content: "🏆 **Mark this nuke as a success?**\nIt gets saved to the site's " +
        "**History** and removed from the nuke list — exactly like the Success " +
        "button on the site.\n*(the number of armies is only asked for on the site)*",
      flags: EPHEMERAL,
      components: [row(
        button("okc:" + parts[1] + ":" + (parts[2] || "0"), "Confirm success",
          { style: 4, emoji: "🏆" }),
        button("okx", "Cancel", { style: 2 })
      )],
    });
    return Promise.resolve();
  }

  if (kind === "okx") {
    respond(res, REPLY.UPDATE,
      { content: "Cancelled — nothing was changed.", components: [] });
    return Promise.resolve();
  }

  if (kind === "okc") {
    var nukeId = parts[1];
    var vIdx = parseInt(parts[2], 10); if (isNaN(vIdx)) vIdx = 0;
    var okApp = body.application_id, okToken = body.token;
    var okChan = interactionChannelId(body);
    var okUser = interactionUser(body);
    deferFor(res, body);
    var okWork = fetchNukeById(nukeId).then(function (nuke) {
      if (!nuke) {
        return editOriginal(okApp, okToken,
          { content: "⚠️ This nuke is already off the site — nothing to do.", components: [] });
      }
      var v = rawVariantAt(nuke, vIdx);
      // Historique D'ABORD : si la suppression échoue, on n'a pas perdu la trace.
      return sbWrite("POST", "nuke_history", historyRowOf(nuke, v, "success"),
        { Prefer: "return=minimal" })
        .then(function () { return sbDelete("nukes?id=eq." + encodeURIComponent(nukeId)); })
        .then(function () {
          return postPublic(okChan, okApp, okToken, {
            content: "🏆 **TARGET " + (nuke.target || "?") + " destroyed** — saved to " +
              "History and removed from the site by **" + okUser.name + "**.",
            allowed_mentions: { parse: [] },
          });
        })
        .then(function () {
          return editOriginal(okApp, okToken,
            { content: "✅ Done — it's in History and off the nuke list.", components: [] });
        });
    }).catch(function () {
      return editOriginal(okApp, okToken,
        { content: "❌ Couldn't save the success — nothing was deleted.", components: [] });
    });
    vercelWaitUntil(okWork);
    return okWork;
  }

  // [PLAN] Vote de disponibilité : on enregistre (remplace) la sélection du
  // joueur, puis on re-render le message (UPDATE) avec les compteurs à jour.
  if (kind === "pa") {
    var voter = interactionUser(body);
    return upsertAvailability(parts[1], voter.id, voter.name, (data.values || []).slice())
      .then(function () { return renderPlanUpdate(res, parts[1]); })
      .catch(function () { dbError(res); });
  }

  // [PLAN] Bouton "Clear my availability" : vide le vote du joueur (re-render).
  if (kind === "pac") {
    var clearer = interactionUser(body);
    return upsertAvailability(parts[1], clearer.id, clearer.name, [])
      .then(function () { return renderPlanUpdate(res, parts[1]); })
      .catch(function () { dbError(res); });
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

// Formations forcées à la main dans l'éditeur ("Setup") : elles écrasent celles
// calculées par l'optimiseur. `rows` porte l'index d'origine du joueur (idx).
function applyFormationLocks(rows, participants) {
  (rows || []).forEach(function (r) {
    var p = (participants || [])[r.idx];
    if (p && p.formLock && p.formation) r.formation = String(p.formation);
  });
}

// Idem, puis on raccourcit pour l'AFFICHAGE (la colonne Form du tableau).
function applyFormationsForTable(rows, participants) {
  applyFormationLocks(rows, participants);
  (rows || []).forEach(function (r) { r.formation = shortFormation(r.formation); });
}

// Formation retenue pour chaque joueur, dans l'ordre d'impact du tableau :
// [{ id, name, formation, side }]. Sert aux messages "1 joueur = 1 formation".
function assignmentsOf(variant, mode) {
  var participants = (variant && variant.participants) || [];
  var rows = mode === "raw"
    ? optimizer.rawList(participants)
    : optimizer.optimize(participants).rows;
  applyFormationLocks(rows, participants);
  return rows.map(function (r) {
    var p = participants[r.idx] || {};
    return {
      id: r.id,
      name: r.name,
      formation: r.formation || p.formation || "",
      // Côté du joueur s'il a le sien, sinon celui du plan (même règle que le site).
      side: p.side || (variant && variant.side) || "",
    };
  });
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
    applyFormationsForTable(rawRows, participants);
    if (!rawRows.length) return emptyTableMsg(target);
    var rawHeader = "**TARGET " + target + "**" +
      (row.target_player ? " — " + row.target_player : "") +
      (side ? " (" + side + ")" : "") + tag + " · SAME TIME — everyone fires together (not optimized)";
    // Pas de colonne "Fire @" : tout le monde tire en même temps.
    return fitDiscord(rawHeader, "**TARGET " + target + "** · SAME TIME",
      renderTable(rawRows, { hideFire: true, noColor: noColor }));
  }

  var result = optimizer.optimize(participants, opts.maxAdj);
  applyFormationsForTable(result.rows, participants);
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

// Ids d'un texte : "<@123>" / "<@!123>" -> ["123"].
function mentionIds(line) {
  var out = [], re = /<@!?(\d+)>/g, m;
  while ((m = re.exec(String(line || "")))) out.push(m[1]);
  return out;
}

function mentionList(ids) {
  return ids.map(function (id) { return "<@" + id + ">"; }).join(" ");
}

// --- Entrées du bloc "prêt" ---------------------------------------------
// Une ENTRÉE = un joueur du tir. Deux formes :
//   { id }   -> son pseudo en jeu a été retrouvé sur le serveur : "<@123>"
//   { name } -> il n'a pas été retrouvé : "`@Nom`" (accents graves : pas de
//               ping possible, mais il est bien ATTENDU comme les autres).
// Un joueur non retrouvé participe quand même : à son 1ᵉʳ clic on le rapproche
// de son nom (comparaison souple), ou il choisit qui il est dans un menu.
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function entryKey(e) { return e.id ? "i:" + e.id : "n:" + normName(e.name); }
function entryToken(e) { return e.id ? "<@" + e.id + ">" : "`@" + e.name + "`"; }
function entryList(entries) { return entries.map(entryToken).join(" "); }

function parseEntries(line) {
  var out = [], re = /<@!?(\d+)>|`@([^`]+)`/g, m;
  while ((m = re.exec(String(line || "")))) {
    out.push(m[1] ? { id: m[1] } : { name: m[2] });
  }
  return out;
}

// Les 1 ou 2 lignes qui portent l'état "prêt / en attente".
function readyBlock(ready, waiting) {
  var total = ready.length + waiting.length;
  var lines = [READY_TAG + " (" + ready.length + "/" + total + "):** " +
    (ready.length ? entryList(ready) : "—")];
  if (waiting.length) lines.push(WAIT_TAG + ":** " + entryList(waiting));
  else if (total) lines.push(ALL_READY);
  return lines.join("\n");
}

function isReadyLine(line) {
  return line.indexOf(READY_TAG) === 0 || line.indexOf(WAIT_TAG) === 0 || line === ALL_READY;
}

// Relit l'état écrit dans le message.
function parseReady(content) {
  var ready = [], waiting = [];
  String(content || "").split("\n").forEach(function (l) {
    if (l.indexOf(READY_TAG) === 0) ready = parseEntries(l);
    else if (l.indexOf(WAIT_TAG) === 0) waiting = parseEntries(l);
  });
  return { ready: ready, waiting: waiting };
}

// Remplace l'entrée `fromKey` par la mention du joueur qui vient de s'identifier.
function claimInto(all, readySet, fromKey, userId) {
  if (readySet[fromKey]) { delete readySet[fromKey]; readySet["i:" + userId] = true; }
  return all.map(function (e) {
    return entryKey(e) === fromKey ? { id: userId } : e;
  });
}

// Reconstruit le bloc à partir de l'ordre d'origine et de l'ensemble des prêts.
function splitReady(all, readySet) {
  var ready = [], waiting = [];
  all.forEach(function (e) { (readySet[entryKey(e)] ? ready : waiting).push(e); });
  return { ready: ready, waiting: waiting };
}

function readyResult(content, before, all, readySet) {
  var next = splitReady(all, readySet);
  return {
    status: "ok",
    content: replaceReadyBlock(content, readyBlock(next.ready, next.waiting)),
    ready: next.ready,
    waiting: next.waiting,
    // Transitions : personne n'attendait plus / on retombe en attente.
    completed: before.waiting.length > 0 && next.waiting.length === 0,
    reopened: before.waiting.length === 0 && next.waiting.length > 0,
  };
}

// Clic sur ✅ / ↩️. Renvoie :
//   { status: "ok", content, … }    -> message à ré-afficher
//   { status: "same" }              -> déjà dans cet état (rien à changer)
//   { status: "claim", names }      -> inconnu, mais des joueurs non retrouvés
//                                      restent à pourvoir : on lui demande qui
//                                      il est
//   { status: "absent" }            -> il n'a rien à faire ici
function applyReadyClick(content, userId, userName, wantReady) {
  var before = parseReady(content);
  var all = before.ready.concat(before.waiting);
  if (!all.length) return { status: "absent" };

  var readySet = {};
  before.ready.forEach(function (e) { readySet[entryKey(e)] = true; });

  var meKey = "i:" + userId;
  var known = all.some(function (e) { return entryKey(e) === meKey; });

  if (!known) {
    // Rapprochement souple : "Master_snidel" (Discord) ~ "Mastersnidel" (jeu).
    var guess = all.find(function (e) {
      return !e.id && normName(e.name) === normName(userName);
    });
    if (!guess) {
      var names = before.waiting.filter(function (e) { return !e.id; })
        .map(function (e) { return e.name; });
      return names.length ? { status: "claim", names: names } : { status: "absent" };
    }
    all = claimInto(all, readySet, entryKey(guess), userId);
  } else if (!!readySet[meKey] === wantReady) {
    return { status: "same" };
  }

  if (wantReady) readySet[meKey] = true; else delete readySet[meKey];
  return readyResult(content, before, all, readySet);
}

// Le joueur a choisi QUI il est dans le menu : on remplace son nom par sa
// mention et on le passe prêt. "gone" = quelqu'un l'a pris entre-temps.
function applyReadyClaim(content, userId, name) {
  var before = parseReady(content);
  var all = before.ready.concat(before.waiting);
  var readySet = {};
  before.ready.forEach(function (e) { readySet[entryKey(e)] = true; });

  var target = all.find(function (e) {
    return !e.id && normName(e.name) === normName(name);
  });
  if (!target) return { status: "gone" };

  all = claimInto(all, readySet, entryKey(target), userId);
  readySet["i:" + userId] = true;
  return readyResult(content, before, all, readySet);
}

// Remplace le bloc SUR PLACE (le tableau peut le suivre dans le même message).
function replaceReadyBlock(content, block) {
  var out = [], done = false;
  String(content || "").split("\n").forEach(function (l) {
    if (!isReadyLine(l)) { out.push(l); return; }
    if (!done) { out.push(block); done = true; }
  });
  return out.join("\n");
}

function readyComponents() {
  return [row(
    button("rdy", "I'm ready", { style: 3, emoji: "✅" }),
    button("nrdy", "Not ready", { style: 2, emoji: "↩️" })
  )];
}

// Menu (éphémère) posé quand le cliqueur n'est associé à personne : il désigne
// le joueur qu'il est parmi ceux dont le pseudo n'a pas été retrouvé.
// custom_id : "rdyc:<salon>:<message>" — le menu vit dans un message éphémère,
// on doit donc éditer le message de tir par l'API (d'où ses identifiants ici).
function claimMenuData(channelId, messageId, names) {
  return {
    content: "Your Discord name doesn't match any player in this nuke — " +
      "**which player are you?**",
    flags: EPHEMERAL,
    components: [row(selectMenu("rdyc:" + channelId + ":" + messageId,
      "Pick your player", names.slice(0, 25).map(function (n) {
        return { label: String(n).slice(0, 100), value: String(n).slice(0, 100) };
      })))],
  };
}

// --- 🏆 Success : classer la nuke depuis Discord ------------------------
// Même effet que le bouton Success du site : une trace dans nuke_history, puis
// la nuke sort de la liste. On garde la variante BRUTE de la ligne (elle porte
// spread / firstLaunch, que variantsOf() ne conserve pas).
function rawVariantAt(nuke, index) {
  if (Array.isArray(nuke.variants) && nuke.variants.length) {
    return nuke.variants[index] || nuke.variants[0];
  }
  return {
    label: "", side: nuke.side || "", participants: nuke.participants || [],
    spread: nuke.spread || "", firstLaunch: nuke.first_launch || "",
  };
}

// Ligne nuke_history, au même format que celle écrite par le site (js/store.js).
function historyRowOf(nuke, variant, result) {
  variant = variant || {};
  var participants = variant.participants || [];
  return {
    target: nuke.target || null,
    target_player: nuke.target_player || null,
    side: variant.side || null,
    result: result,
    players: participants.length,
    armies: null,          // le nombre d'armées ne se saisit que sur le site
    outside_nuke: false,
    variant_label: variant.label || null,
    details: {
      spread: variant.spread || "",
      firstLaunch: variant.firstLaunch || variant.first_launch || "",
      targetImage: nuke.target_image || null,
      participants: participants.map(function (p) {
        return {
          id: p.id || "", name: p.name || "", type: p.type || "", qty: p.qty || "",
          march: p.march || "", offset: p.offset || "", impact: p.impact || "",
          side: p.side || "", formation: p.formation || "",
        };
      }),
    },
  };
}

// Boutons du message de tir : "prêt" et, si on sait de quelle nuke il s'agit,
// le 🏆 Success qui la classe sans passer par le site.
function launchComponents(withReady, origin) {
  var comps = withReady ? readyComponents() : [];
  if (origin && origin.nukeId) {
    comps.push(row(button("ok:" + origin.nukeId + ":" + (origin.index || 0),
      "Success — remove from site", { style: 4, emoji: "🏆" })));
  }
  return comps.length ? comps : null;
}

// Suite d'un clic : on annonce le "tout le monde est prêt", et on signale aussi
// le cas inverse — quelqu'un se retire APRÈS l'annonce. Sans ça, le salon reste
// sur un "GO!" qui n'est plus vrai.
function readyFollowUp(out, channelId, appId, token, whoName) {
  var task = null;
  if (out.completed) {
    task = announceAllReady(channelId, appId, token, out.content, out.ready);
  } else if (out.reopened) {
    task = postPublic(channelId, appId, token, {
      content: "↩️ **" + whoName + " is no longer ready** — " +
        out.ready.length + "/" + (out.ready.length + out.waiting.length) + " ready.",
      allowed_mentions: { parse: [] },
    });
  }
  if (!task) return Promise.resolve();
  vercelWaitUntil(task);
  return task;
}

// Annonce publique "tout le monde est prêt".
function announceAllReady(channelId, appId, token, content, ready) {
  var tgt = targetOfPing(content);
  var ids = ready.filter(function (e) { return e.id; })
    .map(function (e) { return e.id; });
  return postPublic(channelId, appId, token, {
    content: "🔥 **Everyone is ready" + (tgt ? " on " + tgt : "") + " — GO!**\n" +
      entryList(ready),
    allowed_mentions: { parse: [], users: ids.slice(0, 100) },
  });
}

// Cible relue depuis l'en-tête du message de tir (pour l'annonce finale).
function targetOfPing(content) {
  var m = /^🎯 \*\*Target:\*\* (.+)$/m.exec(String(content || ""));
  return m ? m[1].trim() : "";
}

// Récap de tir (SANS tableau) : cible, side, mentions, appel "prêt". tag = plan.
// `resolved` = sortie de resolveMentions() : [{ name, text:"<@id>"|"@nom", id }].
function buildLaunchPing(row, variant, resolved, tag) {
  var target = row.target || "";
  var head = "🎯 **Target:** " + target + (row.target_player ? " — " + row.target_player : "") +
    "\n🛡️ **Side:** " + ((variant && variant.side) || "—") + (tag ? "  ·  " + tag : "");
  // TOUS les joueurs du plan sont attendus, y compris ceux dont le pseudo n'a
  // pas été retrouvé sur le serveur : ils s'identifieront à leur 1ᵉʳ clic.
  var entries = (resolved || []).map(function (r) {
    return r.id ? { id: r.id } : { name: r.name };
  }).filter(function (e) { return e.id || e.name; });
  var foot = entries.length
    ? "🚀 The strike on **" + target + "** is imminent — hit ✅ **I'm ready** below.\n\n" +
      readyBlock([], entries)
    : "🚀 The strike on **" + target + "** is imminent — get ready.";
  var mentions = (resolved || []).map(function (r) { return r.text; }).join(" ");
  var body = head + "\n\n" + (mentions || "@ everyone in this nuke") + "\n\n" + foot;
  if (body.length <= 2000) return body;
  // Trop de joueurs pour tenir : on garde l'essentiel sans la liste des mentions.
  return head + "\n\n@ everyone in this nuke\n\n" + foot;
}

// POST d'un followup (data brut : content/components/allowed_mentions/flags…) via
// le webhook de l'interaction (valable 15 min, pas besoin du bot token). Échec
// silencieux : un followup raté n'a pas à casser la réponse déjà envoyée.
function followupData(appId, token, data) {
  if (!appId || !token || !data) return Promise.resolve();
  var url = "https://discord.com/api/v10/webhooks/" + appId + "/" + token;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://optimisation-goat.vercel.app, 1.0)",
    },
    body: JSON.stringify(data),
  }).then(function () {}, function () {});
}

// Message de suivi texte (cas courant). User-Agent conforme par sécurité.
function followup(appId, token, content) {
  if (!content) return Promise.resolve();
  return followupData(appId, token, { content: content });
}

// Édite le message de la réponse INITIALE de l'interaction (le "le bot
// réfléchit…" du DEFERRED, ou le panneau éphémère cliqué en DEFERRED_UPDATE) :
// PATCH .../messages/@original. Utilise le token d'interaction (pas le bot
// token) → marche même si DISCORD_BOT_TOKEN est absent.
// `data` = texte simple, ou objet Discord complet ({ content, components… }).
function editOriginal(appId, token, data) {
  if (!appId || !token) return Promise.resolve();
  var payload = typeof data === "string" ? { content: data } : (data || {});
  var url = "https://discord.com/api/v10/webhooks/" + appId + "/" + token + "/messages/@original";
  return fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://optimisation-goat.vercel.app, 1.0)",
    },
    body: JSON.stringify(payload),
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

// ============================================================
//  PUBLICATION — poster POUR TOUT LE MONDE
//  Discord force l'éphémère sur tout ce qui répond à un message éphémère
//  (menus de /id_* et /launch_*) : impossible d'y répondre en public. On passe
//  donc par le BOT (POST /channels/{id}/messages), qui poste un vrai message
//  public. Sans bot token / sans droits, repli sur un followup (éphémère) pour
//  ne pas perdre le contenu — l'utilisateur en est averti.
// ============================================================

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Poste dans le salon en encaissant le rate limit : sur 429, on attend le
// retry_after annoncé par Discord et on réessaie une fois.
function postChannelMessageRL(channelId, data, file) {
  return postChannelMessage(channelId, data, file).catch(function (e) {
    var msg = String((e && e.message) || "");
    if (msg.indexOf("Discord 429") !== 0) throw e;
    var wait = 1000;
    try { wait = Math.ceil((JSON.parse(msg.slice(12)).retry_after || 1) * 1000); } catch (e2) { /* défaut */ }
    return delay(Math.min(wait + 100, 5000)).then(function () {
      return postChannelMessage(channelId, data, file);
    });
  });
}

// Nom de la pièce jointe : le nom donné à la formation sur le site + l'extension
// du fichier stocké ("50 - Corner" + ".cas"). On retire ce qui est interdit dans
// un nom de fichier.
function attachmentName(label, url) {
  var m = /\.([A-Za-z0-9]{1,8})(?:$|\?)/.exec(String(url || ""));
  var ext = m ? "." + m[1] : "";
  var base = String(label || "formation").replace(/[\\/:*?"<>|\r\n]+/g, "-").trim();
  if (!base) base = "formation";
  if (ext && base.slice(-ext.length).toLowerCase() === ext.toLowerCase()) ext = "";
  return (base.slice(0, 72) + ext).slice(0, 80);
}

// Télécharge le fichier à joindre. null si indisponible ou trop gros (on
// retombera alors sur le lien en clair : mieux qu'un message sans formation).
function downloadAttachment(attach) {
  if (!attach || !attach.url) return Promise.resolve(null);
  return fetch(attach.url).then(function (r) {
    if (!r.ok) return null;
    return r.arrayBuffer().then(function (ab) {
      if (!ab.byteLength || ab.byteLength > MAX_ATTACH_BYTES) return null;
      return { name: attach.name, buf: Buffer.from(ab) };
    });
  }).catch(function () { return null; });
}

// true = posté en PUBLIC dans le salon ; false = repli éphémère (followup).
function postPublic(channelId, appId, token, data, file) {
  if (!channelId) {
    return followupData(appId, token, data).then(function () { return false; });
  }
  return postChannelMessageRL(channelId, data, file)
    .then(function () { return true; })
    .catch(function () {
      return followupData(appId, token, data).then(function () { return false; });
    });
}

// Poste une SUITE de messages dans l'ordre, espacés de POST_GAP_MS (limite
// Discord ~5 messages / 5 s par salon). Renvoie false si l'un d'eux a dû
// retomber en éphémère.
// Un message peut porter `attach` ({ url, name }) : on télécharge le fichier et
// on le JOINT. Si le téléchargement échoue, on remet le lien en clair dans le
// texte plutôt que d'envoyer un message sans formation.
function postSequence(channelId, appId, token, messages) {
  var allPublic = true;
  return (messages || []).reduce(function (chain, m, i) {
    return chain
      .then(function () { return i ? delay(POST_GAP_MS) : null; })
      .then(function () { return downloadAttachment(m.attach); })
      .then(function (file) {
        var data = { content: m.content, allowed_mentions: m.allowed_mentions };
        if (m.components) data.components = m.components;
        if (m.attach && !file) data.content += "\n" + m.attach.url;
        return postPublic(channelId, appId, token, data, file);
      })
      .then(function (ok) { if (!ok) allPublic = false; });
  }, Promise.resolve()).then(function () { return allPublic; });
}

function interactionChannelId(body) {
  return body.channel_id || (body.channel && body.channel.id) || null;
}

// ACK adapté à l'origine : clic sur un composant → DEFERRED_UPDATE (le panneau
// reste affiché tel quel) ; slash-command → DEFERRED éphémère.
function deferFor(res, body) {
  if (body.type === INTERACTION.COMPONENT) {
    res.status(200).json({ type: REPLY.DEFERRED_UPDATE }); // pas de data : on garde le message
    return;
  }
  respond(res, REPLY.DEFERRED, { flags: EPHEMERAL });
}

// Bouton "📢 Post table" : publie `data` dans le salon puis remplace le panneau
// éphémère par un accusé de réception (et retire ses boutons).
function publishAndAck(res, body, data) {
  var appId = body.application_id, token = body.token;
  deferFor(res, body);
  var work = postPublic(interactionChannelId(body), appId, token, data)
    .then(function (isPublic) {
      return editOriginal(appId, token, {
        content: isPublic
          ? "✅ Table posted in this channel — everyone can see it."
          : "⚠️ Couldn't post publicly (missing bot token or **Send Messages** permission) " +
            "— the table was sent to you only.",
        components: [],
      });
    })
    .catch(function () {
      return editOriginal(appId, token,
        { content: "❌ Something went wrong while posting the table.", components: [] });
    });
  vercelWaitUntil(work);
  return work;
}

// Un message PAR joueur : sa mention + la formation qui lui a été attribuée
// (fichier uploadé sur le site pour ce couple side/type). C'est le "petit plus"
// du récap : chacun reçoit son ping et son fichier.
function formationMessages(variant, mode, resolved, files) {
  var byName = {};
  (resolved || []).forEach(function (r) {
    byName[String(r.name || "").toLowerCase()] = r;
  });
  return assignmentsOf(variant, mode).slice(0, MAX_PLAYER_PINGS).map(function (a) {
    var who = byName[String(a.name || "").toLowerCase()];
    var mention = who ? who.text : "@" + (a.name || a.id || "player");
    var type = formTypeOf(a.formation, files);
    var file = pickFormationFile(files, a.side, a.formation);
    var lines = [mention];
    var attach = null;
    if (!type) {
      lines.push("⚠️ **No formation set** — assign one with ⚙️ Setup before the next launch.");
    } else if (file) {
      // On reprend le NOM du fichier tel qu'il a été nommé sur le site, et on
      // JOINT le fichier : pas de lien de stockage à rallonge dans le message.
      lines.push("**" + (file.name || type) + "**  ·  " + type +
        (a.side ? "  ·  " + a.side : ""));
      attach = { url: file.url, name: attachmentName(file.name || type, file.url) };
    } else {
      lines.push("**" + type + "**" + (a.side ? "  ·  " + a.side : ""));
      lines.push("⚠️ No file uploaded for **" + (a.side || "?") + " / " + type +
        "** — add it on the site (Formations tab).");
    }
    return {
      content: lines.join("\n"),
      allowed_mentions: who && who.id ? { parse: [], users: [who.id] } : { parse: [] },
      attach: attach,
    };
  });
}

// 🚀 LAUNCH : publie dans le salon le récap qui PING + le tableau (mode choisi),
// puis un message par joueur avec sa formation. Le tout via le bot → visible de
// tous. Le panneau éphémère du lanceur devient un simple accusé de réception.
function doLaunch(res, body, row, variant, mode, tag, origin) {
  var appId = body.application_id, token = body.token;
  var channelId = interactionChannelId(body);
  deferFor(res, body);

  var work = Promise.all([
    resolveMentions(body.guild_id, participantNames(variant)),
    fetchFormationFiles(),
  ]).then(function (arr) {
    var resolved = arr[0] || [], files = arr[1] || [];
    var ping = buildLaunchPing(row, variant, resolved, tag);
    var table = variantTableMessage(row, variant, mode, { tag: tag });
    var ids = resolved.map(function (r) { return r.id; }).filter(function (id) { return id; });
    var allowed = { parse: [], users: ids.slice(0, 100) };
    var combined = ping + "\n" + table;
    // Boutons du message de tir : "prêt" (s'il y a un roster) et 🏆 Success.
    var ready = launchComponents(ping.indexOf(READY_TAG) >= 0, origin);
    // Un seul message si ça tient en 2000 car., sinon récap puis tableau.
    var msgs = combined.length <= 2000
      ? [{ content: combined, allowed_mentions: allowed, components: ready }]
      : [{ content: ping, allowed_mentions: allowed, components: ready },
         { content: table, allowed_mentions: { parse: [] } }];
    msgs = msgs.concat(formationMessages(variant, mode, resolved, files));
    return postSequence(channelId, appId, token, msgs).then(function (isPublic) {
      return editOriginal(appId, token, {
        content: isPublic
          ? "🚀 Launched — table posted in this channel and every player pinged with their formation."
          : "⚠️ Couldn't post publicly (missing bot token or **Send Messages** permission) " +
            "— everything was sent to you only.",
        components: [],
      });
    });
  }).catch(function () {
    return editOriginal(appId, token,
      { content: "❌ Something went wrong while launching.", components: [] });
  });

  vercelWaitUntil(work);
  return work;
}

// ============================================================
//  /plan — sondage de disponibilité (HEURE DU JEU)
//  /plan -> modal (target + table d'attaque). À la validation, on extrait
//  les joueurs de la table, on crée un "plan" en base et on poste un message
//  avec la COMPO + une grille de créneaux 06:00 -> 00:00 à cocher. Chaque clic
//  enregistre la dispo du joueur et re-render le message (meilleur créneau).
// ============================================================

var PLAN_NA = "na"; // valeur spéciale du menu : "Not available today"

// Créneaux proposés : toutes les heures pleines de 06:00 à minuit (00:00),
// en HEURE DU JEU. -> 19 créneaux (06:00 … 23:00, 00:00).
function defaultSlots() {
  var out = [];
  for (var h = 6; h <= 24; h++) out.push(pad2(h % 24) + ":00");
  return out;
}

// Extrait les joueurs d'une table d'attaque collée : motifs "11282[Mastersnidel]"
// (ID + pseudo entre crochets). Dédupliqué par ID, dans l'ordre d'apparition.
function parsePlayers(text) {
  var re = /(\d+)\s*\[\s*([^\]]+?)\s*\]/g;
  var out = [], seen = {}, m;
  while ((m = re.exec(String(text || "")))) {
    var id = m[1];
    if (seen[id]) continue;
    seen[id] = true;
    out.push({ id: id, name: m[2].trim() });
  }
  return out;
}

// Signe d'un papillon le joueur "Varju bence" (varjubence.) partout où le bot
// écrit son nom EN TEXTE dans /plan (pas dans le tableau ASCII -> alignement).
// Match tolérant : on réduit le nom à ses lettres/chiffres minuscules, donc
// "Varju bence", "varjubence." et "VarjuBence" matchent tous.
function decorateName(name) {
  var norm = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm === "varjubence" ? name + " 🦋" : name;
}

// Liste "SHOOTERS" : un joueur par ligne, préfixé d'un tiret.
//   - Mastersnidel(11282)
//   - Gandalf47(89877)
function shooterList(players) {
  if (!players || !players.length) return "—";
  return players.map(function (p) { return "- " + decorateName(p.name) + "(" + p.id + ")"; }).join("\n");
}

function repeatChar(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ""; }
function padEndStr(s, n) { s = String(s); while (s.length < n) s += " "; return s; }

// Barre de progression (█/░) proportionnelle au max de votes d'un créneau.
function planBar(n, max, width) {
  width = width || 10;
  var filled = max ? Math.round((n / max) * width) : 0;
  if (n > 0 && filled === 0) filled = 1;
  if (filled > width) filled = width;
  return repeatChar("█", filled) + repeatChar("░", width - filled);
}

// Lit les valeurs d'un modal soumis : { custom_id_du_champ: valeur }.
function modalValues(body) {
  var out = {};
  (((body.data || {}).components) || []).forEach(function (r) {
    (r.components || []).forEach(function (c) { out[c.custom_id] = c.value; });
  });
  return out;
}

// Modal de /plan : cible + table d'attaque (les créneaux sont fixes).
function planModalData() {
  return {
    custom_id: "plan_modal",
    title: "New attack plan",
    components: [
      row(textInput("target", "Target (village ID or name)", { style: 1, required: true, max_length: 100 })),
      row(textInput("attack", "Attack file (paste the table)", { style: 2, required: true, max_length: 4000 })),
    ],
  };
}

// Menu de la grille : un choix par créneau (valeur = index) + "Not available today".
function planComponents(plan) {
  var slots = plan.slots || [];
  var options = slots.slice(0, 24).map(function (s, i) {
    return { label: String(s).slice(0, 100), value: String(i) };
  });
  options.push({ label: "🚫 Not available today", value: PLAN_NA });
  return [
    row(selectMenu("pa:" + plan.id, "Pick every GAME TIME slot you're free",
      options, { min: 0, max: options.length })),
    row(button("pac:" + plan.id, "Clear my availability", { style: 2, emoji: "🗑️" })),
  ];
}

// Construit le message du plan : TARGET / SHOOTERS / COMPO / grille de dispos.
// `avail` = lignes plan_availability ([{ user_name, slots:[idx|"na"] }]).
function buildPlanMessage(plan, avail) {
  var slots = plan.slots || [];
  var players = plan.players || [];
  var counts = slots.map(function () { return []; });
  var naNames = [];
  (avail || []).forEach(function (a) {
    var sel = a.slots || [];
    var name = a.user_name || "?";
    if (sel.indexOf(PLAN_NA) !== -1) naNames.push(name);
    sel.forEach(function (v) {
      var i = parseInt(v, 10);
      if (!isNaN(i) && i >= 0 && i < counts.length) counts[i].push(name);
    });
  });
  var voters = (avail || []).filter(function (a) { return (a.slots || []).length; }).length;
  var max = counts.reduce(function (mx, c) { return Math.max(mx, c.length); }, 0);
  var bestIdx = -1;
  counts.forEach(function (c, i) { if (max > 0 && c.length === max && bestIdx < 0) bestIdx = i; });

  // Joueurs résolus en membres Discord (did renseigné à la création) -> mentions.
  var pings = players
    .filter(function (p) { return p.did; })
    .map(function (p) { return "<@" + p.did + ">"; });
  var head =
    "🎯 **TARGET:** " + (plan.target || "—") +
    "\n💥 **SHOOTERS (" + players.length + "):**\n" + shooterList(players) +
    (pings.length ? "\n\n" + pings.join(" ") : "") +
    "\n\nPlease share your availability to schedule the attack 👇";

  var compo = plan.attack_text ? "\n\n**COMPO**\n```\n" + plan.attack_text + "\n```" : "";

  var gridLines = slots.map(function (s, i) {
    var c = counts[i].length;
    // Noms des dispos de ce créneau (avec 🦋 le cas échéant) ; rien si personne.
    var who = c ? " — " + counts[i].map(decorateName).join(", ") : "";
    return "`" + padEndStr(s, 6) + "` " + planBar(c, max) + " **" + c + "**" +
      (i === bestIdx ? "  ← best" : "") + who;
  });
  var grid = "\n🕒 **Availability (game time)** — " + voters + " player" +
    (voters === 1 ? "" : "s") + " voted\n" +
    "*Pick all slots you're free below. Re-open the menu anytime to change your pick, or 🗑️ to clear it.*\n" +
    gridLines.join("\n");
  if (bestIdx >= 0) {
    grid += "\n\n✅ **Best slot: " + slots[bestIdx] + "** — " + max + " available";
    if (counts[bestIdx].length) grid += ": " + counts[bestIdx].map(decorateName).join(", ");
  } else {
    grid += "\n\n*No availability yet — be the first to pick your slots.*";
  }
  if (naNames.length) grid += "\n🚫 **Not available today:** " + naNames.map(decorateName).join(", ");

  var body = head + compo + "\n" + grid;
  if (body.length <= 2000) return body;
  // Trop long : on retire la COMPO (toujours en base / visible via /id, /optimise).
  body = head + "\n\n*(compo hidden — too long for Discord)*\n" + grid;
  if (body.length <= 2000) return body;
  // Encore trop long : on tronque.
  return ("🎯 **TARGET:** " + (plan.target || "—") + "\n" + grid).slice(0, 1990);
}

function createPlan(plan) {
  return sbWrite("POST", "plans", plan, { Prefer: "return=representation" })
    .then(function (rows) { return (rows && rows[0]) || null; });
}
function fetchPlan(id) {
  return sbGet("plans?select=*&limit=1&id=eq." + encodeURIComponent(id))
    .then(function (rows) { return (rows && rows[0]) || null; });
}
function fetchAvailability(planId) {
  return sbGet("plan_availability?select=user_id,user_name,slots&plan_id=eq." +
    encodeURIComponent(planId));
}
// Upsert (remplace) le vote d'un joueur : clé (plan_id, user_id).
function upsertAvailability(planId, userId, userName, slots) {
  return sbWrite("POST", "plan_availability?on_conflict=plan_id,user_id",
    { plan_id: planId, user_id: userId, user_name: userName, slots: slots,
      updated_at: new Date().toISOString() },
    { Prefer: "resolution=merge-duplicates,return=minimal" });
}

// Re-render du message d'un plan (UPDATE) après un vote / un clear. On supprime
// les mentions (parse: []) pour NE PAS re-pinguer les joueurs à chaque clic.
function renderPlanUpdate(res, planId) {
  return Promise.all([fetchPlan(planId), fetchAvailability(planId)]).then(function (arr) {
    var plan = arr[0], avail = arr[1] || [];
    if (!plan) { reply(res, "❌ This plan no longer exists.", true); return; }
    respond(res, REPLY.UPDATE, {
      content: buildPlanMessage(plan, avail),
      components: planComponents(plan),
      allowed_mentions: { parse: [] },
    });
  });
}

// Discord renvoie le membre (guild) ou l'utilisateur (DM). Pseudo serveur en priorité.
function interactionUser(body) {
  var u = (body.member && body.member.user) || body.user || {};
  var name = (body.member && body.member.nick) || u.global_name || u.username || "player";
  return { id: u.id || "?", name: name };
}

// ============================================================
//  Salon privé "nuke-<cible>" — créé/réutilisé à chaque /plan.
// ============================================================

// Bits de permission Discord (cf. doc) — passés en STRING à l'API v10.
var PERM = { VIEW: 1024, SEND: 2048, HISTORY: 65536 };
var PERM_MEMBER = String(PERM.VIEW | PERM.SEND | PERM.HISTORY); // voir + écrire + historique

// Nom de salon déterministe pour une cible : "nuke-<slug>". Discord impose des
// noms en minuscules sans espaces ni caractères spéciaux ; on slugifie nous-mêmes
// pour que le nom envoyé == le nom stocké (indispensable pour retrouver/réutiliser
// le salon existant). Ex. "41707" -> "nuke-41707", "Bois Noir" -> "nuke-bois-noir".
function nukeChannelName(target) {
  var slug = String(target || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // tout le reste -> tiret
    .replace(/^-+|-+$/g, "");      // pas de tiret en bord
  return ("nuke-" + (slug || "cible")).slice(0, 100);
}

// Overwrites pour un salon PRIVÉ : @everyone ne voit rien, chaque joueur résolu
// + le bot ont l'accès. (id de @everyone = id du serveur ; type 0 = rôle, 1 = membre.)
function nukeOverwrites(guildId, botId, memberIds) {
  var ow = [
    { id: guildId, type: 0, allow: "0", deny: String(PERM.VIEW) }, // @everyone : caché
  ];
  if (botId) ow.push({ id: botId, type: 1, allow: PERM_MEMBER, deny: "0" }); // le bot peut poster
  (memberIds || []).forEach(function (id) {
    ow.push({ id: id, type: 1, allow: PERM_MEMBER, deny: "0" });
  });
  return ow;
}

// Crée le salon "nuke-<cible>" (ou réutilise celui qui existe déjà, même nom) et
// (re)pose les droits privés pour TOUS les joueurs de l'attaque. Renvoie l'id du
// salon. Rejette si le bot n'a pas les droits (Gérer les salons / Gérer les rôles)
// -> l'appelant retombe alors sur le salon courant.
function ensureNukeChannel(guildId, botId, target, memberIds) {
  var name = nukeChannelName(target);
  var ow = nukeOverwrites(guildId, botId, memberIds);
  return discordBot("GET", "/guilds/" + guildId + "/channels").then(function (channels) {
    var existing = (channels || []).find(function (c) {
      return c && c.type === 0 && c.name === name;
    });
    if (existing) {
      // Réutilise : on réécrit les overwrites pour inclure d'éventuels nouveaux
      // joueurs (PATCH remplace la liste ; on garde @everyone caché + le bot).
      return discordBot("PATCH", "/channels/" + existing.id, { permission_overwrites: ow })
        .then(function () { return existing.id; }, function () { return existing.id; });
    }
    return discordBot("POST", "/guilds/" + guildId + "/channels", {
      name: name, type: 0, permission_overwrites: ow,
    }).then(function (ch) { return ch && ch.id; });
  });
}

// Poste un message (content/components/allowed_mentions) dans un salon via bot
// token. `file` = { name, buf } pour JOINDRE un fichier (pièce jointe Discord,
// bien plus lisible qu'un lien de stockage brut) ; null = message texte simple.
// Avec un fichier on passe en multipart : Node ≥ 18 fournit FormData/Blob, et
// il ne faut SURTOUT pas poser Content-Type à la main (fetch écrit la frontière).
function postChannelMessage(channelId, data, file) {
  if (!file) return discordBot("POST", "/channels/" + channelId + "/messages", data);
  var token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return Promise.reject(new Error("DISCORD_BOT_TOKEN manquant"));
  var form = new FormData();
  form.append("payload_json", JSON.stringify(data));
  form.append("files[0]", new Blob([file.buf]), file.name);
  return fetch("https://discord.com/api/v10/channels/" + channelId + "/messages", {
    method: "POST",
    headers: {
      Authorization: "Bot " + token,
      "User-Agent": "DiscordBot (https://optimisation-goat.vercel.app, 1.0)",
    },
    body: form,
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) { throw new Error("Discord " + r.status + " " + t); });
    }
    return r.json().catch(function () { return null; });
  });
}

// Validation d'un modal /plan. On a ≤3 s pour répondre à Discord, or créer le
// salon + poser les droits + poster le plan = plusieurs allers-retours -> on ACK
// d'abord en DEFERRED (éphémère), puis on fait le travail et on remplit la réponse
// via editOriginal(). Étapes : résoudre les pseudos -> créer le plan en base ->
// créer/réutiliser le salon privé "nuke-<cible>" -> y poster le sondage. Si la
// création du salon échoue (droits du bot), on retombe sur le salon courant.
function handlePlanModal(res, body) {
  var vals = modalValues(body);
  var players = parsePlayers(vals.attack);
  var user = interactionUser(body);
  var appId = body.application_id, token = body.token, guildId = body.guild_id;

  // ACK immédiat : "le bot réfléchit…" (visible par toi seul).
  respond(res, REPLY.DEFERRED, { flags: EPHEMERAL });

  // Résout chaque pseudo en jeu -> membre Discord (match exact). did = id Discord
  // si trouvé ; stocké dans players pour rendre les mentions + donner l'accès au salon.
  var work = resolveMentions(guildId, players.map(function (p) { return p.name; }))
    .then(function (resolved) {
      resolved.forEach(function (r, i) { if (r.id && players[i]) players[i].did = r.id; });
      var ids = resolved.map(function (r) { return r.id; }).filter(function (id) { return id; });
      var unresolved = resolved.filter(function (r) { return !r.id; })
        .map(function (r) { return r.name; });
      var plan = {
        target: (vals.target || "").trim(),
        attack_text: (vals.attack || "").trim(),
        players: players,
        slots: defaultSlots(),
        created_by: user.id,
      };
      return createPlan(plan).then(function (saved) {
        if (!saved) return editOriginal(appId, token, "❌ Database error — the plan wasn't saved.");
        var msg = {
          content: buildPlanMessage(saved, []),
          components: planComponents(saved),
          allowed_mentions: { parse: [], users: ids.slice(0, 100) },
        };
        var note = unresolved.length
          ? "\n⚠️ Not added to the channel (Discord name not found): " + unresolved.join(", ") + "."
          : "";
        return ensureNukeChannel(guildId, appId, plan.target, ids)
          .then(function (channelId) {
            return postChannelMessage(channelId, msg).then(function () {
              return editOriginal(appId, token,
                "✅ Channel <#" + channelId + "> is ready — the availability poll is posted there." + note);
            });
          })
          .catch(function () {
            // Création du salon impossible (souvent : bot sans « Gérer les salons »
            // / « Gérer les rôles »). On ne perd pas le sondage : on le poste ici.
            return followupData(appId, token, msg).then(function () {
              return editOriginal(appId, token,
                "⚠️ Couldn't create the private channel — does the bot have **Manage Channels** and " +
                "**Manage Roles**? Posted the poll in this channel instead." + note);
            });
          });
      });
    })
    .catch(function () {
      return editOriginal(appId, token, "❌ Something went wrong while creating the plan.");
    });

  vercelWaitUntil(work);
  return work;
}

// Validation du modal "➕ Add player" : on ajoute le joueur au brouillon puis
// on ré-affiche l'éditeur (UPDATE du panneau d'où venait le bouton).
function handleAddPlayerModal(res, body, draftId) {
  var vals = modalValues(body);
  return fetchDraft(draftId).then(function (draft) {
    if (!draft) { draftGone(res); return; }
    var ps = draft.participants || [];
    ps.push(cloneParticipant({
      id: (vals.pid || "").trim(),
      name: (vals.name || "").trim(),
      type: /cap/i.test(vals.type || "") ? "cap" : "army",
      qty: (vals.qty || "").trim(),
      march: (vals.march || "").trim(),
    }));
    return patchDraft(draft.id, { participants: ps }).then(function (saved) {
      respond(res, REPLY.UPDATE, draftPanelData(saved || draft));
    });
  }).catch(function () { draftDbError(res); });
}

function handleModalSubmit(res, body) {
  var cid = (body.data && body.data.custom_id) || "";
  if (cid === "plan_modal") return handlePlanModal(res, body);
  if (cid.indexOf("dram:") === 0) return handleAddPlayerModal(res, body, cid.slice(5));
  reply(res, "Unknown modal.", true);
  return Promise.resolve();
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

      // Validation d'un modal (formulaire popup) — ex. /plan.
      if (body.type === INTERACTION.MODAL_SUBMIT) {
        return handleModalSubmit(res, body);
      }

      var cmd = body.type === INTERACTION.COMMAND && body.data ? body.data.name : null;
      var MODE = {
        id_syncro: "syncro", id_same_time: "raw",
        launch_syncro: "syncro", launch_same_time: "raw",
      };

      // /plan => ouvre un modal (cible + table d'attaque). La suite (création
      // du plan + grille de dispos) se fait à la validation du modal.
      if (cmd === "plan") {
        respond(res, REPLY.MODAL, planModalData());
        return;
      }

      // /id_syncro | /id_same_time => navigation ÉPHÉMÈRE (toi seul la vois) :
      // catégorie -> village -> APERÇU du tableau. Rien n'est visible des autres
      // avant de cliquer 📢 Post table (tableau public) ou 🚀 Launch (tableau
      // public + pings + formations) ; ⚙️ Setup ouvre l'éditeur avant publication.
      if (cmd === "id_syncro" || cmd === "id_same_time") {
        return fetchCategories()
          .then(function (cats) {
            var data = categoryMenuData(cats, MODE[cmd]);
            data.flags = EPHEMERAL; // menu privé ; c'est le bouton qui publie
            respond(res, REPLY.MESSAGE, data);
          })
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
          return doLaunch(res, body, nuke, variants[0], lmode, "", { nukeId: nuke.id, index: 0 });
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
