/* ============================================================
   TEST (jetable) du moteur js/variants.js, hors navigateur.
   Charge parser.js + optimizer.js + variants.js tels quels.

   Usage : cscript //nologo scripts\test-picker.js
   ============================================================ */

/* --- Polyfills ES3 (JScript n'a pas les methodes ES5) -------------- */
if (!String.prototype.trim) {
  String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ""); };
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

function readUtf8(path) {
  var st = new ActiveXObject("ADODB.Stream");
  st.Type = 2; st.Charset = "utf-8"; st.Open();
  st.LoadFromFile(path);
  var t = st.ReadText(-1); st.Close();
  return t;
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
var BASE = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

// JScript est en ES3 : il refuse les virgules finales que le code moderne
// autorise. On les retire — la logique executee reste identique.
function load(rel) {
  eval(readUtf8(BASE + "\\" + rel).replace(/,(\s*[}\]])/g, "$1"));
}

var window = {};
load("js\\parser.js");
load("js\\optimizer.js");
load("js\\variants.js");

var NukeParser = window.NukeParser;
var NukeOptimizer = window.NukeOptimizer;
var VP = window.VariantPicker;
if (!VP) { WScript.Echo("ERREUR: VariantPicker absent"); WScript.Quit(1); }

function line(s) { WScript.Echo(s); }
function pad(s, n) { s = "" + s; while (s.length < n) s += " "; return s; }

/* --- 1. Parsing ---------------------------------------------------- */
// Le vrai fichier de la guilde (all_variants.txt) n'est pas dans le depot :
// il contient des pseudos. On l'utilise s'il est la, sinon on retombe sur le
// jeu d'essai synthetique, pour que le test tourne toujours.
var REAL = BASE + "\\all_variants.txt";
var DATA = fso.FileExists(REAL) ? REAL : BASE + "\\scripts\\fixture-variants.txt";
WScript.Echo("Donnees : " + (DATA === REAL ? "all_variants.txt (reel)" : "fixture-variants.txt (synthetique)"));
WScript.Echo("");

var parsed = VP.parseFile(readUtf8(DATA));

line("=== 1. PARSING ===");
line("  cible          : " + parsed.target + "   joueur : " + parsed.targetPlayer);
line("  fenetre du bot : " + parsed.sourceWindow + "s");
line("  variantes      : " + parsed.variants.length);
line("  marches illisibles : " + parsed.unreadable);
var pl = VP.playerList(parsed);
line("  joueurs distincts  : " + pl.length);
line("  top 5 presences    : " + pl.slice(0, 5).join(", "));
line("");

function show(title, out) {
  line(title);
  line("  plans trouves : " + out.total + "   (sous-ensembles testes : " + out.scanned + ")");
  var n = Math.min(3, out.plans.length);
  for (var i = 0; i < n; i++) {
    var p = out.plans[i];
    var who = p.rows.map(function (r) { return r.name + (r.type === "cap" ? "*" : ""); });
    line("   #" + (i + 1) + " V" + pad(p.variant, 3) + " " + p.attacks + " att. (" +
         p.armies + "a/" + p.caps + "c) spread " + p.spread + "s cartes " + p.cards);
    line("       " + who.join(", "));
    line("       ordre : " + p.rows.map(function (r) {
      return r.march + (r.type === "cap" ? " CAP" : "");
    }).join("  ->  "));
  }
  if (!out.total) line("   (aucun)");
  line("");
}

/* --- 2. MODULE 1 : la meilleure nuke possible ---------------------- */
line("=== 2. MODULE 1 — meilleure nuke (max d'attaques, joueurs uniques) ===");
show("  reglages par defaut, AUCUNE contrainte de temps ajoutee",
  VP.search(parsed, { mode: "max", minArmies: 2, minCaps: 1 }));

/* --- 3. Taille imposee --------------------------------------------- */
line("=== 3. TAILLE IMPOSEE : exactement 7 attaques ===");
show("  exactement 7", VP.search(parsed, { mode: "exact", attacks: 7 }));

/* --- 4. MODULE 2 : recherche par joueurs connectes ----------------- */
line("=== 4. MODULE 2 — recherche intelligente (joueurs imposes) ===");
// Noms pris dans les donnees chargees (le test doit marcher sur les deux
// jeux) : 3 joueurs distincts de la 1re variante, donc surs de coexister.
var trio = (function () {
  var out = [], rows = parsed.variants[0].rows;
  for (var i = 0; i < rows.length && out.length < 3; i++) {
    if (out.indexOf(rows[i].name) === -1) out.push(rows[i].name);
  }
  return out;
})();
line("  joueurs connectes imposes : " + trio.join(", "));
show("  ces 3 obligatoires",
  VP.search(parsed, { mode: "max", include: trio, minArmies: 2, minCaps: 1 }));

var duo = [pl[0], pl[1]];
line("  autre essai, 2 imposes : " + duo.join(", "));
show("  ces 2 obligatoires",
  VP.search(parsed, { mode: "max", include: duo, minArmies: 2, minCaps: 1 }));

/* --- 5. Verification de la regle "joueurs uniques" ----------------- */
line("=== 5. CONTROLE : aucun doublon dans les plans rendus ===");
var big = VP.search(parsed, { mode: "max", limit: 200 });
var bad = 0;
for (var i = 0; i < big.plans.length; i++) {
  var seenN = {}, rows = big.plans[i].rows;
  for (var r = 0; r < rows.length; r++) {
    if (seenN[rows[r].name]) bad++;
    seenN[rows[r].name] = true;
  }
}
line("  plans controles : " + big.plans.length + "   doublons detectes : " + bad);

/* --- 6bis. Doublons AUTORISES (option demandee) -------------------- */
line("");
line("=== 6. DOUBLONS AUTORISES vs INTERDITS ===");
var strict = VP.search(parsed, { mode: "max", uniquePlayers: true, limit: 300 });
var loose = VP.search(parsed, { mode: "max", uniquePlayers: false, limit: 300 });
line("  joueurs uniques  : " + pad(strict.total, 5) + " plans, max " +
     (strict.plans.length ? strict.plans[0].attacks : 0) + " attaques");
line("  doublons permis  : " + pad(loose.total, 5) + " plans, max " +
     (loose.plans.length ? loose.plans[0].attacks : 0) + " attaques");
line("");

/* --- 6ter. EXCLUSION d'un joueur ----------------------------------- */
line("=== 7. EXCLUSION (chercher une nuke SANS tel joueur) ===");
var banned = pl[0];   // le joueur le plus present : l'exclusion se voit bien
var kept = pl[1];
var before = VP.search(parsed, { mode: "max", fireWindow: 20, limit: 300 });
var after = VP.search(parsed, { mode: "max", fireWindow: 20, exclude: [banned], limit: 300 });
line("  sans filtre        : " + before.total + " plans");
line("  en excluant " + pad(banned, 10) + ": " + after.total + " plans");
var leak = 0;
for (var x = 0; x < after.plans.length; x++) {
  var rws = after.plans[x].rows;
  for (var y = 0; y < rws.length; y++) if (rws[y].name === banned) leak++;
}
line("  fuites (" + banned + " encore present) : " + leak);

// Exclusion + joueur impose en meme temps
var combo = VP.search(parsed, {
  mode: "max", fireWindow: 20, include: [kept], exclude: [banned], limit: 300
});
line("  " + kept + " impose + " + banned + " exclu : " + combo.total + " plans");
if (combo.plans.length) {
  line("     ex. " + combo.plans[0].rows.map(function (r) {
    return r.name + (r.type === "cap" ? "*" : "");
  }).join(", "));
}
line("");

/* --- 8. Controles d'ordre (tir simultane) -------------------------- */
// L'invariant central : tout le monde tirant ensemble, c'est le temps de
// marche qui fait l'ordre. Le dernier a frapper doit etre un capitaine, et
// aucune armee ne doit frapper aussi tard ou plus tard que lui.
var noCapLast = 0, unsorted = 0, armyTooLate = 0;
for (var i2 = 0; i2 < big.plans.length; i2++) {
  var rr = big.plans[i2].rows;
  if (!rr.length || rr[rr.length - 1].type !== "cap") noCapLast++;

  var maxArmy = null, maxCap = null;
  for (var k2 = 0; k2 < rr.length; k2++) {
    if (k2 && rr[k2].marchSec < rr[k2 - 1].marchSec) unsorted++;
    if (rr[k2].type === "cap") {
      if (maxCap == null || rr[k2].marchSec > maxCap) maxCap = rr[k2].marchSec;
    } else if (maxArmy == null || rr[k2].marchSec > maxArmy) {
      maxArmy = rr[k2].marchSec;
    }
  }
  if (maxArmy != null && maxCap != null && maxCap <= maxArmy) armyTooLate++;
}
line("=== 8. CONTROLES D'ORDRE (tir simultane) ===");
line("  plans dont le dernier impact n'est PAS un cap : " + noCapLast);
line("  plans mal tries par temps de marche           : " + unsorted);
line("  plans ou une armee frappe apres/avec le dernier cap : " + armyTooLate);
