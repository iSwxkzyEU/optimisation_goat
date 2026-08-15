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
var parsed = VP.parseFile(readUtf8(BASE + "\\all_variants.txt"));

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
         p.armies + "a/" + p.caps + "c) spread " + p.spread + "s fire " + p.fire +
         "s cartes " + p.cards);
    line("       " + who.join(", "));
  }
  if (!out.total) line("   (aucun)");
  line("");
}

/* --- 2. MODULE 1 : la meilleure nuke possible ---------------------- */
line("=== 2. MODULE 1 — meilleure nuke (max d'attaques, joueurs uniques) ===");
show("  W = 8s (reglage actuel du site)",
  VP.search(parsed, { mode: "max", fireWindow: 8, minArmies: 2, minCaps: 1 }));
show("  W = 20s (fenetre du bot)",
  VP.search(parsed, { mode: "max", fireWindow: 20, minArmies: 2, minCaps: 1 }));

/* --- 3. Taille imposee + suggestion de fenetre --------------------- */
line("=== 3. TAILLE IMPOSEE : exactement 7 attaques ===");
var seven = VP.search(parsed, { mode: "exact", attacks: 7, fireWindow: 8 });
show("  W = 8s", seven);
if (!seven.total) {
  var hint = VP.suggestWindow(parsed, { mode: "exact", attacks: 7, fireWindow: 8 });
  line("  suggestion : " + (hint
    ? "passer la fenetre a " + hint.window + "s -> " + hint.total + " plans"
    : "aucune fenetre testee ne donne de plan"));
  line("");
}

/* --- 4. MODULE 2 : recherche par joueurs connectes ----------------- */
line("=== 4. MODULE 2 — recherche intelligente (joueurs imposes) ===");
var trio = ["Mastersnidel", "Dosz-HU", "Warlock IV"];
line("  joueurs connectes imposes : " + trio.join(", "));
show("  W = 20s, ces 3 obligatoires",
  VP.search(parsed, { mode: "max", fireWindow: 20, include: trio, minArmies: 2, minCaps: 1 }));

var duo = ["Gandalf47", "r3wy"];
line("  autre essai, 2 imposes : " + duo.join(", "));
show("  W = 16s",
  VP.search(parsed, { mode: "max", fireWindow: 16, include: duo, minArmies: 2, minCaps: 1 }));

/* --- 5. Verification de la regle "joueurs uniques" ----------------- */
line("=== 5. CONTROLE : aucun doublon dans les plans rendus ===");
var big = VP.search(parsed, { mode: "max", fireWindow: 20, limit: 200 });
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
line("=== 6. DOUBLONS AUTORISES vs INTERDITS (meme fenetre) ===");
[8, 16, 20].forEach(function (w) {
  var strict = VP.search(parsed, { mode: "max", fireWindow: w, uniquePlayers: true, limit: 300 });
  var loose = VP.search(parsed, { mode: "max", fireWindow: w, uniquePlayers: false, limit: 300 });
  var bs = strict.plans.length ? strict.plans[0].attacks : 0;
  var bl = loose.plans.length ? loose.plans[0].attacks : 0;
  line("  W=" + pad(w + "s", 5) + " uniques : " + pad(strict.total, 5) + " plans, max " +
       bs + " att.   |   doublons OK : " + pad(loose.total, 5) + " plans, max " + bl + " att.");
});
line("");

/* --- 7. Controle "capi en dernier" --------------------------------- */
var noCapLast = 0;
for (var i2 = 0; i2 < big.plans.length; i2++) {
  var rr = big.plans[i2].res.rows;
  if (!rr.length || rr[rr.length - 1].type !== "cap") noCapLast++;
}
line("  plans dont le dernier impact n'est PAS un cap : " + noCapLast);
