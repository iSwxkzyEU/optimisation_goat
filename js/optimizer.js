/* ============================================================
   OPTIMIZER — synchronise les temps d'impact d'une nuke.

   Modèle ±8 (cf. LOGIQUE-METIER.txt) :
     - chaque unité peut être ajustée de -8 s à +8 s (avance OU
       retard) ; c'est la colonne "Offset" ;
     - OBJECTIF : toutes les ARMÉES frappent à la même seconde T,
       et tous les CAPITAINES à T + 2 (coussin anti-décalage
       serveur) -> le dernier impact est donc un capitaine ;
     - T est CENTRÉ pour minimiser le plus gros écart = le plan le
       plus serré possible (spread idéal = 2 s) ;
     - si le groupe est trop dispersé (> 16 s d'écart de marche),
       on fait AU MIEUX dans les ±8 et on SIGNALE ce qui déborde.
   Formations auto (selon l'ordre d'impact final) :
     - 1ʳᵉ armée à impacter = 90 ; autres armées = 110 ;
     - CAP qui frappe après les armées = 50 ; sinon 110.
   ============================================================ */

(function () {
  "use strict";

  var MAX_ADJ = 8;  // ajustement maximum en secondes, dans les DEUX sens (-8..+8)
  var CAP_GAP = 2;  // les CAPs frappent CAP_GAP secondes après les armées

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // "1h21m42s" / "30m:13s" / "30:13" / "45s" / "6m" -> secondes (null si illisible)
  function toSeconds(str) {
    var s = String(str || "").trim().toLowerCase();
    // Format purement numérique : "30:13" (mm:ss) ou "1:21:42" (h:mm:ss)
    var c = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
    if (c) {
      return c[3] == null
        ? parseInt(c[1], 10) * 60 + parseInt(c[2], 10)
        : parseInt(c[1], 10) * 3600 + parseInt(c[2], 10) * 60 + parseInt(c[3], 10);
    }
    // Avec unités, séparateurs ":" tolérés : "1h21m42s", "30m:13s", "6m", "45s"
    var m = s.match(/^(?:(\d+)\s*h\s*:?\s*)?(?:(\d+)\s*m\s*:?\s*)?(?:(\d+)\s*s?)?$/);
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

    // --- CHOIX DE T : on centre tout le monde (spread minimal) ---
    // Chaque armée "souhaite" T = sa marche ; chaque CAP "souhaite"
    // T = sa marche - CAP_GAP (puisqu'il vise T + CAP_GAP). On prend
    // T = milieu de [min, max] des souhaits -> minimise le plus gros
    // offset, donc le plan le plus serré possible.
    var desired = armies.map(function (a) { return a.t; })
      .concat(caps.map(function (c) { return c.t - CAP_GAP; }));

    var T = null;
    if (desired.length) {
      var lo = Math.min.apply(null, desired);
      var hi = Math.max.apply(null, desired);
      T = Math.round((lo + hi) / 2);
    }
    var armyTarget = T;                              // les armées visent T
    var capTarget = T == null ? null : T + CAP_GAP;  // les CAPs visent T + 2

    // --- ARMÉES : offset = clamp(T - marche, -8, +8) ---
    armies.forEach(function (a) {
      var raw = armyTarget - a.t;
      a.nt = a.t + clamp(raw, -MAX_ADJ, MAX_ADJ);
      if (raw > MAX_ADJ) {
        warnings.push((a.p.name || a.p.id) + " is too fast to sync (max " + MAX_ADJ +
          "s adjust): it lands at " + toTime(a.nt) + ", " + (armyTarget - a.nt) + "s before the others.");
      } else if (raw < -MAX_ADJ) {
        warnings.push((a.p.name || a.p.id) + " is too slow to sync (max " + MAX_ADJ +
          "s adjust): it lands at " + toTime(a.nt) + ", " + (a.nt - armyTarget) + "s after the others.");
      }
    });

    var maxArmyImpact = armies.length
      ? Math.max.apply(null, armies.map(function (a) { return a.nt; }))
      : null;

    // --- CAPs : visent T + CAP_GAP, même fenêtre ±8 ---
    if (caps.length) {
      caps.forEach(function (c) {
        var raw = capTarget - c.t;
        c.nt = c.t + clamp(raw, -MAX_ADJ, MAX_ADJ);
        if (raw > MAX_ADJ) {
          warnings.push("CAP " + (c.p.name || c.p.id) + " is too fast to join the cap group (max " +
            MAX_ADJ + "s adjust): it lands at " + toTime(c.nt) +
            (maxArmyImpact != null && c.nt <= maxArmyImpact ? ", before the armies." : "."));
        } else if (raw < -MAX_ADJ) {
          warnings.push("CAP " + (c.p.name || c.p.id) + " is too slow to join the cap group (max " +
            MAX_ADJ + "s adjust): it lands at " + toTime(c.nt) + ".");
        } else if (maxArmyImpact != null && c.nt <= maxArmyImpact) {
          warnings.push("CAP " + (c.p.name || c.p.id) + " lands at " + toTime(c.nt) + ", not after the armies.");
        }
      });
    } else {
      warnings.push("No CAP in this nuke: the last attack should be a CAP.");
    }

    if (skipped.length) {
      warnings.push("Unreadable march time, player(s) left out: " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + ".");
    }

    // --- RÈGLE D'OR : le dernier impact doit être un capitaine ---
    if (caps.length && valid.length) {
      var lastImpact = Math.max.apply(null, valid.map(function (r) { return r.nt; }));
      var lastIsCap = caps.some(function (c) { return c.nt === lastImpact; });
      if (!lastIsCap) {
        warnings.push("The last impact is not a CAP — a captain should land last.");
      }
    }

    // --- Spreads ---
    var spreadOf = function (xs) {
      return xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    };
    var spreadBefore = spreadOf(valid.map(function (r) { return r.t; }));
    var spreadAfter = spreadOf(valid.map(function (r) { return r.nt; }));

    // 1ʳᵉ armée à impacter (impact le plus tôt, départage par marche) → 90 form
    var firstArmy = null;
    armies.forEach(function (a) {
      if (!firstArmy || a.nt < firstArmy.nt || (a.nt === firstArmy.nt && a.t < firstArmy.t)) {
        firstArmy = a;
      }
    });

    function formationOf(r) {
      if (r.p.type === "cap") return (maxArmyImpact != null && r.nt > maxArmyImpact) ? "50" : "110";
      return r === firstArmy ? "90" : "110";
    }

    // Résultat : armées (triées par marche) puis CAPs
    var result = armies.concat(caps).map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),
        marchSec: r.t,
        offsetSec: r.nt - r.t,
        offset: signed(r.nt - r.t),
        newTime: toTime(r.nt),
        impactSec: r.nt,
        formation: formationOf(r),
      };
    });

    return {
      rows: result,
      impactTime: armies.length ? toTime(armyTarget) : null,
      impactSec: armies.length ? armyTarget : null,
      capTime: caps.length ? toTime(capTarget) : null,
      spreadBefore: spreadBefore,
      spreadAfter: spreadAfter,
      warnings: warnings,
    };
  }

  var api = {
    optimize: optimize,
    toSeconds: toSeconds,
    toTime: toTime,
  };
  // Navigateur : expose window.NukeOptimizer (comme avant).
  if (typeof window !== "undefined") window.NukeOptimizer = api;
  // Node (bot Discord) : réutilise EXACTEMENT la même logique via require().
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
