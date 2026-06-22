/* ============================================================
   OPTIMIZER — synchronise les temps d'IMPACT d'une nuke.

   MODÈLE "compte à rebours de groupe" (cf. discussion métier) :
     - On lance un COMPTE À REBOURS commun (ex. réglé sur 1h37m50s).
       Chacun TIRE quand le compte à rebours atteint SA valeur "Fire @".
     - Pour qu'une attaque tombe pile à l'instant T (= 0 du rebours),
       il faut tirer quand le rebours = sa MARCHE. Donc :
         Fire @ (armée) = marche ;  Fire @ (cap) = marche − CAP_GAP
       -> toutes les armées tombent ensemble (T), les caps à T+CAP_GAP
          (ils ferment la marche).
     - CONTRAINTE RÉELLE : la fenêtre de tir (du 1ᵉʳ au dernier tir) ne
       peut pas dépasser MAX_WINDOW secondes. Si les marches sont plus
       étalées que ça, on ne PEUT PAS tout synchroniser : on cale la
       fenêtre sur la plus lente, on tire les trop-rapides au plus tard
       possible (bord de fenêtre) — elles tombent un peu trop tôt — et
       on SIGNALE (warning). On fait AU MIEUX, jamais triché.
     - Le tableau est RANGÉ PAR ORDRE D'ARRIVÉE (impact), caps en dernier.
   Colonnes : March | Fire @ (valeur du rebours où tirer) | Lands (écart
   à T : 0 = synchro, +2 = cap qui ferme, −n = tombe trop tôt).
   Formations auto : 1ʳᵉ armée à impacter = 90 ; autres armées = 110 ;
   CAP qui frappe après les armées = 50 ; sinon 110.
   ============================================================ */

(function () {
  "use strict";

  var CAP_GAP = 2;     // les CAPs frappent CAP_GAP s après les armées
  var MAX_WINDOW = 8;  // fenêtre de tir maximale (du 1ᵉʳ au dernier tir), en s

  // "1h21m42s" / "30m:13s" / "30:13" / "45s" / "6m" -> secondes (null si illisible)
  function toSeconds(str) {
    var s = String(str || "").trim().toLowerCase();
    var c = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
    if (c) {
      return c[3] == null
        ? parseInt(c[1], 10) * 60 + parseInt(c[2], 10)
        : parseInt(c[1], 10) * 3600 + parseInt(c[2], 10) * 60 + parseInt(c[3], 10);
    }
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

  // Écart d'impact à T, signé : "0s" (synchro) / "+2s" (cap) / "-4s" (trop tôt).
  function signed(n) { return (n > 0 ? "+" : "") + n + "s"; }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function optimize(participants, maxWindow) {
    // Fenêtre de tir maximale (s). /optimise <id> <s> la fait varier ;
    // absente / négative => valeur par défaut MAX_WINDOW.
    var W = (maxWindow == null || maxWindow < 0) ? MAX_WINDOW : maxWindow;

    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    });

    var skipped = rows.filter(function (r) { return r.t == null; });
    var valid = rows.filter(function (r) { return r.t != null; });
    var armies = valid.filter(function (r) { return r.p.type !== "cap"; });
    var caps = valid.filter(function (r) { return r.p.type === "cap"; });

    var warnings = [];

    if (!valid.length) {
      if (skipped.length) {
        warnings.push("Unreadable march time, player(s) left out: " +
          skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + ".");
      }
      return { rows: [], fireWindow: 0, maxWindow: W, impactSpread: 0, capGap: CAP_GAP,
        launchWindow: 0, spreadBefore: 0, spreadAfter: 0, warnings: warnings };
    }

    // --- Fire @ idéal = valeur du rebours où tirer pour tomber pile ---
    // armée -> marche ; cap -> marche − CAP_GAP (pour tomber CAP_GAP s plus tard).
    valid.forEach(function (r) {
      r.idealA = r.t - (r.p.type === "cap" ? CAP_GAP : 0);
    });
    var hiA = Math.max.apply(null, valid.map(function (r) { return r.idealA; }));
    var loA = Math.min.apply(null, valid.map(function (r) { return r.idealA; }));

    // Fenêtre calée sur la plus lente : [hiA − usedW, hiA]. Si l'étalement
    // des marches tient dans W, pas de compression (usedW = étalement).
    var usedW = Math.min(W, hiA - loA);
    var winHi = hiA;
    var winLo = hiA - usedW;

    valid.forEach(function (r) {
      r.A = clamp(r.idealA, winLo, winHi);   // valeur réelle du rebours où tirer
      r.clamped = r.idealA < winLo;          // trop rapide pour la fenêtre -> tombe tôt
      r.impactOff = r.t - r.A;               // écart d'impact à T (0 armée, +CAP_GAP cap, − si trop tôt)
    });

    var maxArmyOff = armies.length
      ? Math.max.apply(null, armies.map(function (a) { return a.impactOff; }))
      : null;

    // --- Warnings : unités trop rapides pour la fenêtre de W s ---
    valid.forEach(function (r) {
      if (!r.clamped) return;
      var who = (r.p.type === "cap" ? "CAP " : "") + (r.p.name || r.p.id);
      var early = -r.impactOff; // s d'avance sur T
      var note = (r.p.type === "cap" && maxArmyOff != null && r.impactOff <= maxArmyOff)
        ? " — it lands BEFORE the armies (can't close the nuke)."
        : ".";
      warnings.push(who + " is too fast for a " + W + "s send window: fire at " +
        toTime(r.A) + ", it lands " + early + "s before the wave" + note);
    });

    if (!caps.length) {
      warnings.push("No CAP in this nuke: the last attack should be a CAP.");
    } else {
      var lastOff = Math.max.apply(null, valid.map(function (r) { return r.impactOff; }));
      if (!caps.some(function (c) { return c.impactOff === lastOff; })) {
        warnings.push("The last impact is not a CAP — a captain should land last.");
      }
    }
    if (skipped.length) {
      warnings.push("Unreadable march time, player(s) left out: " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + ".");
    }

    // --- Formations (selon l'ordre d'impact) ---
    // 1ʳᵉ armée à impacter = 90 (départage : marche la plus courte) ; autres = 110.
    var firstArmy = null;
    armies.forEach(function (a) {
      if (!firstArmy || a.impactOff < firstArmy.impactOff ||
          (a.impactOff === firstArmy.impactOff && a.t < firstArmy.t)) {
        firstArmy = a;
      }
    });
    function formationOf(r) {
      if (r.p.type === "cap") return (maxArmyOff != null && r.impactOff > maxArmyOff) ? "50" : "110";
      return r === firstArmy ? "90" : "110";
    }

    var spreadOf = function (xs) {
      return xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    };
    var spreadBefore = spreadOf(valid.map(function (r) { return r.t; }));
    var fireWindow = spreadOf(valid.map(function (r) { return r.A; }));       // fenêtre de tir réelle
    var impactSpread = spreadOf(valid.map(function (r) { return r.impactOff; })); // étalement des impacts

    // --- RÉSULTAT : RANGÉ PAR ORDRE D'ARRIVÉE (impact croissant) ---
    // tombe le plus tôt en haut, caps (qui ferment) en bas.
    // Départage à impact égal : par ordre de TIR (rebours décroissant = 1ᵉʳ tiré).
    var ordered = valid.slice().sort(function (a, b) {
      return a.impactOff - b.impactOff || b.A - a.A || a.idx - b.idx;
    });

    var result = ordered.map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),       // March (marche)
        marchSec: r.t,
        offsetSec: r.A,             // valeur du rebours où tirer
        offset: toTime(r.A),        // "Fire @" : tire quand le rebours atteint ça
        newTime: signed(r.impactOff), // "Lands" : écart à T (0 synchro / +2 cap / − trop tôt)
        impactSec: r.impactOff,
        clamped: r.clamped,
        formation: formationOf(r),
      };
    });

    return {
      rows: result,
      fireWindow: fireWindow,
      maxWindow: W,
      impactSpread: impactSpread,
      capGap: CAP_GAP,
      // compat champs existants
      launchWindow: fireWindow,
      spreadBefore: spreadBefore,
      spreadAfter: impactSpread,
      warnings: warnings,
    };
  }

  // Temps BRUTS, non optimisés : on affiche la marche telle quelle comme
  // valeur de tir (Fire @ = marche) -> tout serait synchro mais sur une
  // fenêtre = l'étalement complet des marches. Rangé par marche.
  function rawList(participants) {
    var rows = (participants || []).map(function (p, idx) {
      return { p: p, idx: idx, t: toSeconds(p.march) };
    }).filter(function (r) { return r.t != null; });
    rows.sort(function (a, b) { return b.t - a.t || a.idx - b.idx; });
    return rows.map(function (r) {
      return {
        idx: r.idx,
        id: r.p.id,
        name: r.p.name,
        type: r.p.type,
        qty: r.p.qty,
        current: toTime(r.t),     // March
        marchSec: r.t,
        offsetSec: r.t,
        offset: toTime(r.t),      // Fire @ = marche (tir naturel)
        newTime: "0s",            // synchro si chacun tire à sa marche
        impactSec: 0,
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
  if (typeof window !== "undefined") window.NukeOptimizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
