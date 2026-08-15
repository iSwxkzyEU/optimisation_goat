/* ============================================================
   BANC D'ESSAI (jetable) — repond a UNE question :
   pour choisir K attaques dans une variante de n attaques,
   faut-il se limiter au PREFIXE (les K premiers), a une
   FENETRE contiguë, ou tester TOUS LES SOUS-ENSEMBLES ?

   Tourne sous cscript (JScript/ES3) — pas de Node ici.
   Charge le VRAI js/optimizer.js pour que le verdict soit fiable.

   Usage : cscript //nologo scripts\test-variant-selection.js
   ============================================================ */

/* --- Polyfills ES3 (JScript n'a pas les methodes ES5) -------------- */
if (!String.prototype.trim) {
  String.prototype.trim = function () {
    return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
  };
}
if (!Array.prototype.map) {
  Array.prototype.map = function (fn) {
    var out = [], i;
    for (i = 0; i < this.length; i++) out[i] = fn(this[i], i, this);
    return out;
  };
}
if (!Array.prototype.filter) {
  Array.prototype.filter = function (fn) {
    var out = [], i;
    for (i = 0; i < this.length; i++) if (fn(this[i], i, this)) out[out.length] = this[i];
    return out;
  };
}
if (!Array.prototype.forEach) {
  Array.prototype.forEach = function (fn) {
    var i;
    for (i = 0; i < this.length; i++) fn(this[i], i, this);
  };
}
if (!Array.prototype.some) {
  Array.prototype.some = function (fn) {
    var i;
    for (i = 0; i < this.length; i++) if (fn(this[i], i, this)) return true;
    return false;
  };
}
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (x) {
    var i;
    for (i = 0; i < this.length; i++) if (this[i] === x) return i;
    return -1;
  };
}

/* --- Lecture fichier UTF-8 ---------------------------------------- */
function readUtf8(path) {
  var st = new ActiveXObject("ADODB.Stream");
  st.Type = 2;
  st.Charset = "utf-8";
  st.Open();
  st.LoadFromFile(path);
  var t = st.ReadText(-1);
  st.Close();
  return t;
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
var BASE = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

/* --- Chargement du vrai optimizer.js ------------------------------ */
// L'IIFE fait `if (typeof window !== "undefined") window.NukeOptimizer = api;`
// donc il suffit de declarer un faux `window` avant l'eval.
// JScript est en ES3 : il refuse les virgules finales ({a: 1,}) que le code
// moderne autorise. On les retire — la logique executee reste identique.
var window = {};
eval(readUtf8(BASE + "\\js\\optimizer.js").replace(/,(\s*[}\]])/g, "$1"));
var Opt = window.NukeOptimizer;
if (!Opt) { WScript.Echo("ERREUR: optimizer.js non charge"); WScript.Quit(1); }

/* --- Parsing du fichier de variantes ------------------------------ */
function parseVariants(text) {
  var lines = text.replace(/\r\n/g, "\n").split("\n");
  var variants = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    var vm = line.match(/\[Variant\s+(\d+)\s*\((\d+)\s*attacks?\)\]/i);
    if (vm) {
      cur = { no: parseInt(vm[1], 10), declared: parseInt(vm[2], 10), rows: [] };
      variants[variants.length] = cur;
      continue;
    }
    if (!cur) continue;
    if (line.charAt(0) !== "|") continue;

    var body = line.replace(/^\|/, "").replace(/\|$/, "");
    var cells = body.split("|");
    for (var c = 0; c < cells.length; c++) cells[c] = cells[c].trim();
    if (cells.length < 4) continue;
    if (cells[0].toLowerCase() === "id") continue; // ligne d'en-tete

    var idm = cells[0].match(/^(\S+?)\s*\[(.+?)\]\s*$/);
    cur.rows[cur.rows.length] = {
      id: idm ? idm[1] : cells[0],
      name: idm ? idm[2] : cells[0],
      type: cells[1].toLowerCase(),
      qty: cells[2],
      march: cells[3].replace(/\s+/g, "")
    };
  }
  return variants;
}

/* --- Evaluation d'un sous-ensemble -------------------------------- */
// Valide = l'optimiseur ne sort AUCUNE alerte : tout le monde tient dans
// la fenetre de tir, il y a au moins un CAP, et le dernier impact est un CAP.
// UNIQUE     : interdit deux fois le meme JOUEUR (meme nom, IDs differents)
// MIN_ARMIES : garde-fou contre les sous-ensembles 100% capitaines (spread
//              parfait mais zero degat) que l'optimiseur ne signale pas.
var UNIQUE = false;
var MIN_ARMIES = 0;

function evaluate(subset, W) {
  var caps = 0, armies = 0, i;
  var seenName = {};
  for (i = 0; i < subset.length; i++) {
    if (subset[i].type === "cap") caps++; else armies++;
    if (UNIQUE) {
      var nm = subset[i].name;
      if (seenName[nm]) return { ok: false, spread: 999, fire: 999, caps: caps, n: subset.length };
      seenName[nm] = true;
    }
  }
  if (armies < MIN_ARMIES) {
    return { ok: false, spread: 999, fire: 999, caps: caps, n: subset.length };
  }
  var r = Opt.optimize(subset, W);
  return {
    ok: r.warnings.length === 0,
    spread: r.impactSpread,
    fire: r.fireWindow,
    warns: r.warnings.length,
    caps: caps,
    armies: armies,
    n: subset.length
  };
}

/* --- Generateurs de sous-ensembles -------------------------------- */
function prefixOf(rows, k) { return rows.slice(0, k); }

function windowsOf(rows, k) {
  var out = [];
  for (var s = 0; s + k <= rows.length; s++) out[out.length] = rows.slice(s, s + k);
  return out;
}

function combosOf(rows, k) {
  var out = [], n = rows.length, total = 1 << n;
  for (var m = 0; m < total; m++) {
    var bits = 0, mm = m;
    while (mm) { bits += (mm & 1); mm >>= 1; }
    if (bits !== k) continue;
    var s = [];
    for (var i = 0; i < n; i++) if (m & (1 << i)) s[s.length] = rows[i];
    out[out.length] = s;
  }
  return out;
}

// Meilleur plan valide d'une liste de candidats : spread mini, puis fenetre de tir mini.
function best(cands, W) {
  var bestRes = null, bestSet = null;
  for (var i = 0; i < cands.length; i++) {
    var e = evaluate(cands[i], W);
    if (!e.ok) continue;
    if (!bestRes || e.spread < bestRes.spread ||
        (e.spread === bestRes.spread && e.fire < bestRes.fire)) {
      bestRes = e; bestSet = cands[i];
    }
  }
  return bestRes ? { res: bestRes, set: bestSet } : null;
}

function pad(s, n) { s = "" + s; while (s.length < n) s += " "; return s; }
function padL(s, n) { s = "" + s; while (s.length < n) s = " " + s; return s; }

/* --- Execution ----------------------------------------------------- */
var W = 8; // fenetre de tir du site (optimizer.js MAX_WINDOW)

// Le vrai fichier de la guilde n'est pas dans le depot (il contient des
// pseudos). Les chiffres publies venaient de lui ; sans lui on retombe sur
// le jeu d'essai, qui ne prouve que le bon fonctionnement du code.
var REAL = BASE + "\\all_variants.txt";
var DATA = fso.FileExists(REAL) ? REAL : BASE + "\\scripts\\fixture-variants.txt";
if (DATA !== REAL) {
  WScript.Echo("!! all_variants.txt absent -> jeu d'essai synthetique.");
  WScript.Echo("   Les comparaisons restent valables, les VOLUMES non.");
  WScript.Echo("");
}
var variants = parseVariants(readUtf8(DATA));

WScript.Echo("Variantes lues : " + variants.length + "   |   fenetre de tir W = " + W + "s");
WScript.Echo("");

// Sanity check : le nb d'attaques annonce correspond-il aux lignes lues ?
var mismatch = 0;
for (var i = 0; i < variants.length; i++) {
  if (variants[i].declared !== variants[i].rows.length) mismatch++;
}
WScript.Echo("Coherence [N attacks] vs lignes lues : " +
  (mismatch === 0 ? "OK sur les " + variants.length : mismatch + " ECARTS"));
WScript.Echo("");

// 1) Les variantes ENTIERES, telles que le bot les propose
var wholeOk = 0, wholeBestSpread = 999, wholeNoCapLast = 0;
for (var i = 0; i < variants.length; i++) {
  var e = evaluate(variants[i].rows, W);
  if (e.ok) { wholeOk++; if (e.spread < wholeBestSpread) wholeBestSpread = e.spread; }
}
WScript.Echo("=== 1. VARIANTES ENTIERES (aucune troncature) ===");
WScript.Echo("  Valides (0 alerte) : " + wholeOk + " / " + variants.length);
WScript.Echo("  Meilleur spread    : " + (wholeOk ? wholeBestSpread + "s" : "-"));
WScript.Echo("");

// 2) Comparaison des 3 strategies, pour chaque taille K demandee
WScript.Echo("=== 2. STRATEGIES DE SELECTION DE K ATTAQUES ===");
WScript.Echo("  (nb de variantes ou la strategie trouve AU MOINS un plan valide)");
WScript.Echo("");
WScript.Echo("  " + pad("K", 4) + padL("prefixe", 10) + padL("fenetre", 10) +
             padL("sous-ens.", 11) + padL("gain s/e", 10) + "   meilleur spread (p/f/s)");
WScript.Echo("  " + "----------------------------------------------------------------------");

for (var k = 4; k <= 8; k++) {
  var nP = 0, nW = 0, nS = 0;
  var sP = 999, sW = 999, sS = 999;
  var examples = [];

  for (var v = 0; v < variants.length; v++) {
    var rows = variants[v].rows;
    if (rows.length < k) continue;

    var bp = best([prefixOf(rows, k)], W);
    var bw = best(windowsOf(rows, k), W);
    var bs = best(combosOf(rows, k), W);

    if (bp) { nP++; if (bp.res.spread < sP) sP = bp.res.spread; }
    if (bw) { nW++; if (bw.res.spread < sW) sW = bw.res.spread; }
    if (bs) { nS++; if (bs.res.spread < sS) sS = bs.res.spread; }

    // Cas ou le sous-ensemble trouve alors que le prefixe echoue
    if (bs && !bp && examples.length < 3) {
      examples[examples.length] = { v: variants[v].no, n: rows.length, set: bs.set, res: bs.res };
    }
  }

  WScript.Echo("  " + pad(k, 4) + padL(nP, 10) + padL(nW, 10) + padL(nS, 11) +
               padL("+" + (nS - nP), 10) + "   " +
               (sP === 999 ? "-" : sP + "s") + " / " +
               (sW === 999 ? "-" : sW + "s") + " / " +
               (sS === 999 ? "-" : sS + "s"));

  for (var e2 = 0; e2 < examples.length; e2++) {
    var ex = examples[e2];
    var who = [];
    for (var q = 0; q < ex.set.length; q++) {
      who[who.length] = ex.set[q].name + "(" + ex.set[q].type + ")";
    }
    WScript.Echo("       ex. Variant " + ex.v + " [" + ex.n + " att.] -> " +
                 "spread " + ex.res.spread + "s : " + who.join(", "));
  }
}

WScript.Echo("");
WScript.Echo("Lecture : 'prefixe' = les K premiers ; 'fenetre' = K consecutifs ;");
WScript.Echo("          'sous-ens.' = n'importe quels K. Valide = 0 alerte optimizer.");
WScript.Echo("");

// 3) Matrice K x W : combien de plans valides selon la fenetre de tir autorisee ?
//    Le bot genere ses variantes avec "window 20s", le site impose 8s.
WScript.Echo("=== 3. MATRICE  taille K  x  fenetre de tir W ===");
WScript.Echo("  (variantes offrant >=1 sous-ensemble valide / 62, et meilleur spread)");
WScript.Echo("");

var WS = [8, 10, 12, 16, 20];
var head = "  " + pad("K", 4);
for (var w = 0; w < WS.length; w++) head += padL("W=" + WS[w] + "s", 12);
WScript.Echo(head);
WScript.Echo("  " + "--------------------------------------------------------------");

for (var k = 4; k <= 8; k++) {
  var lineOut = "  " + pad(k, 4);
  for (var w = 0; w < WS.length; w++) {
    var Wc = WS[w], cnt = 0, bs2 = 999;
    for (var v = 0; v < variants.length; v++) {
      var rows2 = variants[v].rows;
      if (rows2.length < k) continue;
      var b2 = best(combosOf(rows2, k), Wc);
      if (b2) { cnt++; if (b2.res.spread < bs2) bs2 = b2.res.spread; }
    }
    lineOut += padL(cnt + (cnt ? " (" + bs2 + "s)" : ""), 12);
  }
  WScript.Echo(lineOut);
}

WScript.Echo("");
WScript.Echo("Rappel : optimizer.js impose MAX_WINDOW = 8s, le bot genere en 20s.");
WScript.Echo("");

// 4) La meme matrice, avec les VRAIES regles metier :
//    joueurs uniques (pas 2 fois le meme nom) + au moins 2 armees.
UNIQUE = true;
MIN_ARMIES = 2;

WScript.Echo("=== 4. MEMES MESURES, REGLES REELLES ===");
WScript.Echo("  (joueurs uniques + >=2 armees + >=1 cap qui ferme)");
WScript.Echo("");

var head2 = "  " + pad("K", 4);
for (var w = 0; w < WS.length; w++) head2 += padL("W=" + WS[w] + "s", 12);
WScript.Echo(head2);
WScript.Echo("  " + "--------------------------------------------------------------");

for (var k = 4; k <= 8; k++) {
  var lineU = "  " + pad(k, 4);
  for (var w = 0; w < WS.length; w++) {
    var Wu = WS[w], cntU = 0, bsU = 999;
    for (var v = 0; v < variants.length; v++) {
      var rowsU = variants[v].rows;
      if (rowsU.length < k) continue;
      var bu = best(combosOf(rowsU, k), Wu);
      if (bu) { cntU++; if (bu.res.spread < bsU) bsU = bu.res.spread; }
    }
    lineU += padL(cntU + (cntU ? " (" + bsU + "s)" : ""), 12);
  }
  WScript.Echo(lineU);
}

// 5) Combien de variantes contiennent un doublon de joueur ?
var dup = 0, dupNames = {};
for (var v = 0; v < variants.length; v++) {
  var seen = {}, has = false;
  for (var r = 0; r < variants[v].rows.length; r++) {
    var nm2 = variants[v].rows[r].name;
    if (seen[nm2]) { has = true; dupNames[nm2] = (dupNames[nm2] || 0) + 1; }
    seen[nm2] = true;
  }
  if (has) dup++;
}
WScript.Echo("");
WScript.Echo("Variantes contenant au moins un joueur en double : " + dup + " / " + variants.length);
var dl = [];
for (var dn in dupNames) if (dupNames.hasOwnProperty(dn)) dl[dl.length] = dn + " x" + dupNames[dn];
WScript.Echo("Joueurs concernes : " + dl.join(", "));
