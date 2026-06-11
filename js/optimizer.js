/* ============================================================
   OPTIMIZER — synchronise les temps d'impact d'une nuke.
   Principe : le décalage est un DÉLAI D'ENVOI (on ne peut que
   retarder un départ, jamais l'avancer). Donc :
     - l'armée la plus lente fixe l'heure d'impact commune T ;
     - chaque armée part avec un délai (T - sa marche) pour que
       TOUTES frappent à la même seconde ;
     - le CAP frappe en dernier, ~2s après les armées (s'il est
       plus lent que T+2s, il garde son temps de marche : il
       arrive de toute façon après) ;
     - plusieurs CAPs : +1s entre eux, le plus lent ferme le tir.
   ============================================================ */

(function () {
  "use strict";

  var CAP_GAP = 2; // le CAP final frappe ~2s après les armées

  // "1h21m42s" / "6m11s" / "45s" / "6m" -> secondes (null si illisible)
  function toSeconds(str) {
    var s = String(str || "").trim().toLowerCase();
    var m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s?)?$/);
    if (!m || (m[1] == null && m[2] == null && m[3] == null)) return null;
    return parseInt(m[1] || 0, 10) * 3600 +
           parseInt(m[2] || 0, 10) * 60 +
           parseInt(m[3] || 0, 10);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function toTime(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + "h" + pad2(m) + "m" + pad2(s) + "s";
    if (m) return m + "m" + pad2(s) + "s";
    return s + "s";
  }

  function signed(n) {
    return (n > 0 ? "+" : "") + n + "s";
  }

  function optimize(participants) {
    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    });

    var skipped = rows.filter(function (r) { return r.t == null; });
    var valid = rows.filter(function (r) { return r.t != null; });
    var armies = valid.filter(function (r) { return r.p.type !== "cap"; });
    var caps = valid.filter(function (r) { return r.p.type === "cap"; });
    var byTime = function (a, b) { return a.t - b.t || a.idx - b.idx; };
    armies.sort(byTime);
    caps.sort(byTime);

    var warnings = [];

    // 1) Toutes les armées frappent à l'heure de la plus lente
    var T = armies.length ? armies[armies.length - 1].t : null;
    armies.forEach(function (a) { a.nt = T; });

    // 2) CAPs après les armées : T+2s, puis +1s entre eux.
    //    Un CAP plus lent que ça garde sa marche (délai 0) : il arrive après.
    var prev = T == null ? null : T + CAP_GAP - 1;
    caps.forEach(function (c) {
      c.nt = prev == null ? c.t : Math.max(prev + 1, c.t);
      prev = c.nt;
    });
    if (!caps.length) {
      warnings.push("Aucun CAP dans la nuke : la dernière attaque devrait être un CAP.");
    } else if (T != null) {
      var lastCap = caps[caps.length - 1];
      if (lastCap.nt - T > CAP_GAP + Math.max(0, caps.length - 1)) {
        warnings.push(
          "Le CAP " + (lastCap.p.name || lastCap.p.id) + " a une marche plus lente : " +
          "il frappera " + (lastCap.nt - T) + "s après les armées."
        );
      }
    }
    if (skipped.length) {
      warnings.push(
        "Temps illisible, joueur(s) non optimisé(s) : " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + "."
      );
    }

    var times = valid.map(function (r) { return r.t; });
    var newTimes = valid.map(function (r) { return r.nt; });
    var spreadOf = function (xs) {
      return xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    };

    // Résultat : armées triées par marche (délais décroissants), CAPs à la fin
    var result = armies.concat(caps).map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),
        offsetSec: r.nt - r.t,
        offset: signed(r.nt - r.t),
        newTime: toTime(r.nt),
      };
    });

    return {
      rows: result,
      impactTime: T == null ? null : toTime(T),
      capTime: caps.length ? toTime(caps[caps.length - 1].nt) : null,
      spreadBefore: spreadOf(times),
      spreadAfter: spreadOf(newTimes),
      warnings: warnings,
    };
  }

  window.NukeOptimizer = {
    optimize: optimize,
    toSeconds: toSeconds,
    toTime: toTime,
  };
})();
