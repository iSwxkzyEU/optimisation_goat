/* ============================================================
   OPTIMIZER — synchronise les temps d'IMPACT d'une nuke.

   Modèle (cf. discussion métier) :
     - distinguer clairement HEURE DE TIR et HEURE D'IMPACT :
         impact = heure_de_tir + marche   (la marche est fixe).
     - NUKE SYNCHRONISÉE : toutes les ARMÉES frappent à la MÊME
       seconde = la marche de l'armée la plus LENTE (aucune ne peut
       frapper avant elle) ; les CAPITAINES frappent CAP_GAP s après
       -> un capitaine ferme TOUJOURS la marche.
     - chaque unité reçoit un "Fire" = délai de tir depuis un top GO
       commun (0 = première tirée, valeurs ≥ 0). Une unité rapide qui
       doit frapper tard est simplement tirée plus tard (gros Fire).
     - l'ordre de TIR n'a pas d'importance ; ce qui compte c'est
       l'ordre d'ARRIVÉE -> le tableau est RANGÉ PAR IMPACT.
   Formations auto (selon l'ordre d'impact final) :
     - 1ʳᵉ armée à impacter = 90 ; autres armées = 110 ;
     - CAP qui frappe après les armées = 50 ; sinon 110.
   ============================================================ */

(function () {
  "use strict";

  var CAP_GAP = 2;  // les CAPs frappent CAP_GAP secondes après les armées

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

  // Délai de tir depuis le GO : toujours ≥ 0, affiché "+Ns".
  function fmtFire(n) { return "+" + n + "s"; }

  function optimize(participants) {
    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    });

    var skipped = rows.filter(function (r) { return r.t == null; });
    var valid = rows.filter(function (r) { return r.t != null; });
    var armies = valid.filter(function (r) { return r.p.type !== "cap"; });
    var caps = valid.filter(function (r) { return r.p.type === "cap"; });

    var warnings = [];

    // --- CIBLE D'IMPACT : synchro sur la plus LENTE ---
    // Les armées frappent toutes à T = marche de l'armée la plus lente ;
    // les CAPs à T + CAP_GAP. (Nuke 100 % caps : ils se synchronisent
    // entre eux sur le cap le plus lent.)
    var maxArmyT = armies.length
      ? Math.max.apply(null, armies.map(function (a) { return a.t; }))
      : null;
    var maxCapT = caps.length
      ? Math.max.apply(null, caps.map(function (c) { return c.t; }))
      : null;

    var armyTarget = maxArmyT;
    var capTarget = armyTarget != null ? armyTarget + CAP_GAP : maxCapT;

    // Heure de tir "absolue" (relative à l'impact) = impact - marche.
    valid.forEach(function (r) {
      var target = (r.p.type === "cap") ? capTarget : armyTarget;
      r.fireAbs = target - r.t;   // peut être négatif avant normalisation
    });

    // --- GO : on cale le PREMIER tir à 0, les autres en délai positif ---
    var go = valid.length
      ? Math.min.apply(null, valid.map(function (r) { return r.fireAbs; }))
      : 0;
    valid.forEach(function (r) {
      r.fire = r.fireAbs - go;   // délai de tir depuis le GO (≥ 0)
      r.nt = r.fire + r.t;       // impact (cohérent : tir + marche = impact)
    });

    var maxArmyImpact = armies.length
      ? Math.max.apply(null, armies.map(function (a) { return a.nt; }))
      : null;

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
    var launchWindow = spreadOf(valid.map(function (r) { return r.fire; })); // = max fire (min = 0)

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
        offsetSec: r.fire,        // délai de tir depuis le GO (≥ 0)
        offset: fmtFire(r.fire),  // "Fire" : "+Ns"
        newTime: toTime(r.nt),    // heure d'impact
        impactSec: r.nt,
        formation: formationOf(r),
      };
    });

    return {
      rows: result,
      impactTime: armies.length ? toTime(armyTarget - go) : null,
      impactSec: armies.length ? armyTarget - go : null,
      capTime: caps.length ? toTime(capTarget - go) : null,
      spreadBefore: spreadBefore,
      spreadAfter: spreadAfter,
      launchWindow: launchWindow,
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
