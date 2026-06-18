/* ============================================================
   RENDER-TABLE — rend le tableau d'une nuke optimisée en ASCII
   (style "boîte" +---+) prêt à coller dans un bloc de code Discord.
   Colonnes : ID[name] | Type | Card | Time | Offset | New time | Form
   ============================================================ */

"use strict";

// Centre `text` dans une cellule de largeur `width` (espace en plus à droite si impair).
function center(text, width) {
  var s = String(text == null ? "" : text);
  var total = width - s.length;
  if (total <= 0) return s;
  var left = Math.floor(total / 2);
  var right = total - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

// rows = sortie de NukeOptimizer.optimize().rows
function renderTable(rows) {
  var headers = ["ID", "Type", "Card", "Time", "Offset", "New time", "Form"];

  var data = rows.map(function (r) {
    var id = r.name ? r.id + "[" + r.name + "]" : String(r.id || "");
    return [id, r.type || "", r.qty || "", r.current || "", r.offset || "", r.newTime || "", r.formation || ""];
  });

  // Largeur de chaque colonne = max(contenu, en-tête) + 1 espace de marge de chaque côté.
  var widths = headers.map(function (h, i) {
    var max = h.length;
    data.forEach(function (row) { if (row[i].length > max) max = row[i].length; });
    return max + 2;
  });

  var sep = "+" + widths.map(function (w) { return "-".repeat(w); }).join("+") + "+";
  var line = function (cells) {
    return "|" + cells.map(function (c, i) { return center(c, widths[i]); }).join("|") + "|";
  };

  var out = [sep, line(headers), sep];
  data.forEach(function (row) { out.push(line(row)); });
  out.push(sep);
  return out.join("\n");
}

module.exports = { renderTable: renderTable };
