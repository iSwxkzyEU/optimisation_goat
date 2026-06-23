/* ============================================================
   RENDER-TABLE — rend le tableau d'une nuke optimisée en ASCII
   (style "boîte" +---+) prêt à coller dans un bloc de code Discord.
   Colonnes : ID[name] | Type | Card | March | Fire @ | Form

   COULEUR : Discord ne colore que dans un bloc ```ansi. On colore
   par CELLULE (sens métier), pour repérer l'info d'un coup d'œil :
     - Nom du joueur (colonne ID) : une couleur par joueur (cycle) ;
     - Type : Army et CAP ont chacun leur couleur ;
     - Card (x2/x3/x4/x5/x6) : une couleur par valeur.
   Les codes ANSI sont ajoutés APRÈS le centrage (ils sont invisibles
   à l'affichage mais comptent dans .length) pour ne pas fausser
   l'alignement des colonnes.
   ============================================================ */

// IIFE : tout reste interne (rien ne fuite dans le scope global du navigateur,
// ce qui évitait une collision de variables avec preview.html).
(function () {
"use strict";

// --- Codes ANSI Discord ---
var ESC = String.fromCharCode(27) + "["; // \x1b[
var RESET = ESC + "0m";

var HEADER_STYLE = "1;37"; // en-tête : blanc gras (neutre, laisse les colonnes ressortir)

// Type : Army vs CAP
var TYPE_COLORS = { army: "1;36", cap: "1;35" }; // cyan vif / magenta vif

// Card (multiplicateur) : une couleur par valeur. Clé = chiffre seul.
var CARD_COLORS = {
  "2": "0;34", // bleu
  "3": "0;36", // cyan
  "4": "0;33", // jaune
  "5": "0;32", // vert
  "6": "0;31", // rouge
};

// Form (formation auto) : une couleur par valeur.
var FORM_COLORS = {
  "50": "1;31",  // rouge
  "90": "1;32",  // vert
  "110": "1;33", // jaune
};

// Nom du joueur : couleur cyclée d'un joueur à l'autre (gras pour ressortir).
var NAME_COLORS = ["1;33", "1;32", "1;31", "1;35", "1;34", "1;36"];

function color(code, text) {
  return code ? ESC + code + "m" + text + RESET : text;
}

// Colonnes du tableau, dans l'ordre. "key" identifie la colonne (pour la couleur
// ET pour pouvoir en masquer une sans décaler les autres). "Fire @" est retirée
// en mode "same time" : tout le monde tire ensemble, il n'y a pas d'heure de tir
// par joueur.
var COLUMNS = [
  { key: "id",    header: "ID",     value: function (r) { return r.name ? r.id + "[" + r.name + "]" : String(r.id || ""); } },
  { key: "type",  header: "Type",   value: function (r) { return r.type || ""; } },
  { key: "card",  header: "Card",   value: function (r) { return r.qty || ""; } },
  { key: "march", header: "March",  value: function (r) { return r.current || ""; } },
  { key: "fire",  header: "Fire @", value: function (r) { return r.offset || ""; } },
  { key: "form",  header: "Form",   value: function (r) { return r.formation || ""; } },
];

// Couleur d'une cellule selon sa colonne (clé) / sa valeur / sa ligne. null = pas de couleur.
function colColor(key, value, rowIndex) {
  var v = String(value == null ? "" : value).trim().toLowerCase();
  if (key === "id") return NAME_COLORS[rowIndex % NAME_COLORS.length];                 // ID[joueur]
  if (key === "type") return v ? (v.indexOf("cap") >= 0 ? TYPE_COLORS.cap : TYPE_COLORS.army) : null;
  if (key === "card") { var n = v.replace(/[^0-9]/g, ""); return CARD_COLORS[n] || null; }
  if (key === "form") return FORM_COLORS[v] || null;                                    // Form (formation)
  return null;
}

// Centre `text` dans une cellule de largeur `width` (espace en plus à droite si impair).
function center(text, width) {
  var s = String(text == null ? "" : text);
  var total = width - s.length;
  if (total <= 0) return s;
  var left = Math.floor(total / 2);
  var right = total - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

// rows = sortie de NukeOptimizer.optimize().rows (ou rawList()).
// opts.hideFire = masque la colonne "Fire @" (mode "same time").
// opts.noColor = tableau SANS codes ANSI (bien plus court : utile pour "All
//                plans" où plusieurs tableaux doivent tenir en 2000 car.).
function renderTable(rows, opts) {
  opts = opts || {};
  var noColor = !!opts.noColor;
  var cols = COLUMNS.filter(function (c) { return !(opts.hideFire && c.key === "fire"); });

  var data = rows.map(function (r) {
    return cols.map(function (c) { return c.value(r); });
  });

  // Largeur de chaque colonne = max(contenu, en-tête) + 1 espace de marge de chaque côté.
  var widths = cols.map(function (c, i) {
    var max = c.header.length;
    data.forEach(function (row) { if (row[i].length > max) max = row[i].length; });
    return max + 2;
  });

  var sep = "+" + widths.map(function (w) { return "-".repeat(w); }).join("+") + "+";

  // En-tête : couleur sur toute la ligne (neutre) — sauf en mode noColor.
  var headerRow = "|" + cols.map(function (c, i) { return center(c.header, widths[i]); }).join("|") + "|";
  var headerLine = noColor ? headerRow : color(HEADER_STYLE, headerRow);

  var out = [sep, headerLine, sep];

  // Lignes de données : couleur PAR CELLULE (sur la cellule déjà centrée,
  // donc sans impact sur la largeur). En mode noColor : texte brut.
  data.forEach(function (row, ri) {
    var cells = row.map(function (cell, i) {
      var centered = center(cell, widths[i]);
      return noColor ? centered : color(colColor(cols[i].key, cell, ri), centered);
    });
    out.push("|" + cells.join("|") + "|");
  });

  out.push(sep);
  return out.join("\n");
}

// Node (bot Discord) : export CommonJS. Navigateur (preview.html) : window.RenderTable.
if (typeof module !== "undefined" && module.exports) module.exports = { renderTable: renderTable };
if (typeof window !== "undefined") window.RenderTable = { renderTable: renderTable };
})();
