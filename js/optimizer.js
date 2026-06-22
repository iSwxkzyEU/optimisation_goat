/* ============================================================
   OPTIMIZER — synchronise les temps d'IMPACT d'une nuke.

   Modèle (cf. discussion métier) :
     - distinguer clairement HEURE DE TIR et HEURE D'IMPACT :
         impact = heure_de_tir + marche   (la marche est fixe).
     - NUKE SYNCHRONISÉE : toutes les ARMÉES frappent à la MÊME
       seconde = la marche de l'armée la plus LENTE (aucune ne peut
       frapper avant elle) ; les CAPITAINES frappent CAP_GAP s après
       -> un capitaine ferme TOUJOURS la marche.
     - chaque unité reçoit un "Fire" = ajustement de tir SIGNÉ, borné à
       -8..+8s : on peut AVANCER (négatif) ou RETARDER (positif) un départ
       de 8 secondes max. La cible T est CENTRÉE pour minimiser le plus gros
       |ajustement| -> le maximum d'unités tient dans les ±8. Une unité hors
       d'atteinte est tirée au plus près et SIGNALÉE (warning), sans tricher.
     - l'ordre de TIR n'a pas d'importance ; ce qui compte c'est
       l'ordre d'ARRIVÉE -> le tableau est RANGÉ PAR IMPACT.
   Formations auto (selon l'ordre d'impact final) :
     - 1ʳᵉ armée à impacter = 90 ; autres armées = 110 ;
     - CAP qui frappe après les armées = 50 ; sinon 110.
   ============================================================ */

(function () {
  "use strict";

  var CAP_GAP = 2;  // les CAPs frappent CAP_GAP secondes après les armées
  var MAX_ADJ = 8;  // ajustement de tir : -8..+8 s (on peut AVANCER ou RETARDER un départ de 8s)

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

  // Ajustement de tir, signé : -8..+8 s, affiché "+7s" / "-6s" / "0s".
  function signed(n) { return (n > 0 ? "+" : "") + n + "s"; }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function optimize(participants, maxAdj) {
    // Budget d'ajustement de tir : ±maxAdj s (par défaut MAX_ADJ = 8).
    // Le bot Discord /optimise <id> <s> permet de le faire varier ;
    // une valeur absente / négative retombe sur la valeur par défaut.
    var adj = (maxAdj == null || maxAdj < 0) ? MAX_ADJ : maxAdj;

    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    });

    var skipped = rows.filter(function (r) { return r.t == null; });
    var valid = rows.filter(function (r) { return r.t != null; });
    var armies = valid.filter(function (r) { return r.p.type !== "cap"; });
    var caps = valid.filter(function (r) { return r.p.type === "cap"; });

    var warnings = [];

    // --- CIBLE D'IMPACT : on CENTRE pour minimiser le plus gros ajustement ---
    // Chaque armée "souhaite" T = sa marche ; chaque CAP "souhaite"
    // T = sa marche - CAP_GAP (puisqu'il vise T + CAP_GAP). On prend
    // T = milieu de [min, max] des souhaits -> le plus gros |ajustement|
    // est minimal, donc le MAXIMUM d'unités tient dans les ±MAX_ADJ.
    var desired = armies.map(function (a) { return a.t; })
      .concat(caps.map(function (c) { return c.t - CAP_GAP; }));

    var T = null;
    if (desired.length) {
      var lo = Math.min.apply(null, desired);
      var hi = Math.max.apply(null, desired);
      T = Math.round((lo + hi) / 2);
    }
    var armyTarget = T;                              // les armées visent T
    var capTarget = T == null ? null : T + CAP_GAP;  // les CAPs visent T + CAP_GAP

    // --- TIR : ajustement = clamp(cible - marche, -MAX_ADJ, +MAX_ADJ) ---
    // impact = marche + ajustement. L'ajustement (colonne "Fire") peut être
    // négatif (avancer le départ) OU positif (le retarder). Une unité hors
    // d'atteinte (besoin de plus de ±MAX_ADJ s) est tirée au plus près et
    // SIGNALÉE : on fait AU MIEUX, jamais triché.
    valid.forEach(function (r) {
      var target = (r.p.type === "cap") ? capTarget : armyTarget;
      r.raw = target - r.t;                          // ajustement idéal pour être synchro
      r.fire = clamp(r.raw, -adj, adj);              // ajustement réel, borné ±adj
      r.clamped = r.raw > adj || r.raw < -adj;
      r.nt = r.t + r.fire;                           // impact réel (marche + ajustement)
    });

    var maxArmyImpact = armies.length
      ? Math.max.apply(null, armies.map(function (a) { return a.nt; }))
      : null;

    // --- Warnings : unités hors de portée des ±adj s ---
    armies.forEach(function (a) {
      if (a.raw > adj) {
        warnings.push((a.p.name || a.p.id) + " is too fast to sync (max ±" + adj +
          "s): it lands at " + toTime(a.nt) + ", " + (armyTarget - a.nt) + "s before the others.");
      } else if (a.raw < -adj) {
        warnings.push((a.p.name || a.p.id) + " is too slow to sync (max ±" + adj +
          "s): it lands at " + toTime(a.nt) + ", " + (a.nt - armyTarget) + "s after the others.");
      }
    });
    caps.forEach(function (c) {
      if (c.raw > adj) {
        warnings.push("CAP " + (c.p.name || c.p.id) + " is too fast to join the cap group (max ±" +
          adj + "s): it lands at " + toTime(c.nt) +
          (maxArmyImpact != null && c.nt <= maxArmyImpact ? ", BEFORE the armies." : "."));
      } else if (c.raw < -adj) {
        warnings.push("CAP " + (c.p.name || c.p.id) + " is too slow to join the cap group (max ±" +
          adj + "s): it lands at " + toTime(c.nt) + ".");
      } else if (maxArmyImpact != null && c.nt <= maxArmyImpact) {
        warnings.push("CAP " + (c.p.name || c.p.id) + " lands at " + toTime(c.nt) + ", not after the armies.");
      }
    });

    if (!caps.length) {
      warnings.push("No CAP in this nuke: the last attack should be a CAP.");
    }
    if (skipped.length) {
      warnings.push("Unreadable march time, player(s) left out: " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + ".");
    }

    // --- Formations (selon l'ordre d'impact) ---
    // 1ʳᵉ armée à impacter = 90 (départage : marche la plus courte) ; autres = 110.
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

    // --- Spreads / fenêtre de tir ---
    var spreadOf = function (xs) {
      return xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    };
    var spreadBefore = spreadOf(valid.map(function (r) { return r.t; }));
    var spreadAfter = spreadOf(valid.map(function (r) { return r.nt; }));
    var launchWindow = spreadOf(valid.map(function (r) { return r.fire; })); // étalement des tirs (max - min)

    // --- RÉSULTAT : RANGÉ PAR ORDRE D'IMPACT (arrivée sur cible) ---
    // impact croissant -> armées synchronisées d'abord, CAPs en dernier.
    // Départage à impact égal : par ordre de TIR (premier tiré en haut).
    var ordered = valid.slice().sort(function (a, b) {
      return a.nt - b.nt || a.fire - b.fire || a.idx - b.idx;
    });

    var result = ordered.map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),     // marche
        marchSec: r.t,
        offsetSec: r.fire,        // ajustement de tir signé (-8..+8)
        offset: signed(r.fire),   // "Fire" : "+7s" / "-6s" / "0s"
        newTime: toTime(r.nt),    // heure d'impact
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
      launchWindow: launchWindow,
      maxAdj: adj,
      warnings: warnings,
    };
  }

  // Temps BRUTS, non optimisés : aucune correction de tir. Tout le monde
  // part au même top (Fire +0s) -> l'impact = la marche, et on RANGE par
  // marche pour voir l'ordre d'arrivée "naturel" avant optimisation.
  function rawList(participants) {
    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    }).filter(function (r) { return r.t != null; });
    rows.sort(function (a, b) { return a.t - b.t || a.idx - b.idx; });
    return rows.map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),     // marche
        marchSec: r.t,
        offsetSec: 0,
        offset: "+0s",            // aucun décalage
        newTime: toTime(r.t),     // impact = marche (tir simultané)
        impactSec: r.t,
        formation: r.p.formation || "",
      };
    });
  }

  var api = {
    optimize: optimize,
    rawList: rawList,
    toSeconds: toSeconds,
    toTime: toTime,
  };
  // Navigateur : expose window.NukeOptimizer (comme avant).
  if (typeof window !== "undefined") window.NukeOptimizer = api;
  // Node (bot Discord) : réutilise EXACTEMENT la même logique via require().
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
