/* ============================================================
   OPTIMIZER — synchronise les temps d'impact d'une nuke.
   Principe : le décalage est un DÉLAI D'ENVOI (on ne peut que
   retarder un départ, jamais l'avancer), PLAFONNÉ À +8s. Donc :
     - l'armée la plus lente fixe l'heure d'impact commune T ;
     - chaque armée part avec un délai (T - sa marche, max +8s)
       pour frapper à la même seconde ; une armée trop rapide
       pour rejoindre T est signalée (elle frappe au plus tard) ;
     - les CAPs frappent APRÈS les armées et sont GROUPÉS sur un
       même impact (spread minimal), au plus tôt possible ; un CAP
       trop rapide pour rejoindre le groupe (>+8s) frappe au plus
       tard qu'il peut et est signalé.
   Formations auto (selon l'ordre d'impact final) :
     - 1ʳᵉ armée à impacter = 90 ; autres armées = 110 ;
     - CAP qui frappe après les armées = 50 ; sinon 110.
   ============================================================ */

(function () {
  "use strict";

  var MAX_DELAY = 8; // délai d'envoi maximum en secondes
  var CAP_GAP = 2;   // le CAP final frappe ~2s après les armées

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

    // 1) Les armées rejoignent la plus lente, dans la limite de +8s d'envoi
    var T = armies.length ? armies[armies.length - 1].t : null;
    var tooFast = [];
    armies.forEach(function (a) {
      a.nt = Math.min(a.t + MAX_DELAY, T);
      if (a.nt < T) tooFast.push(a);
    });
    tooFast.forEach(function (a) {
      warnings.push(
        (a.p.name || a.p.id) + " is too fast to sync (max +" + MAX_DELAY + "s delay): " +
        "it lands at " + toTime(a.nt) + ", " + (T - a.nt) + "s before the main impact."
      );
    });

    // 2) CAPs : ils frappent APRÈS les armées et sont GROUPÉS sur un même
    //    impact pour réduire le spread, au plus tôt possible (envoi rapide :
    //    le CAP le plus lent part sans délai). Heure commune des caps =
    //    max(T + CAP_GAP, marche du CAP le plus lent). Un CAP trop rapide pour
    //    rejoindre ce créneau (>+8s) frappe au plus tard qu'il peut, et est
    //    signalé (surtout s'il tombe avant/pendant les armées).
    var Tc = null;
    if (caps.length) {
      var slowestCap = caps[caps.length - 1].t; // caps triés par marche asc
      Tc = T == null ? slowestCap : Math.max(T + CAP_GAP, slowestCap);
      caps.forEach(function (c) {
        c.nt = Math.min(c.t + MAX_DELAY, Tc);
        if (c.nt < Tc) {
          warnings.push(
            "CAP " + (c.p.name || c.p.id) + " is too fast to join the cap group (max +" +
            MAX_DELAY + "s delay): it lands at " + toTime(c.nt) +
            (T != null && c.nt <= T ? ", before the armies." : ".")
          );
        } else if (T != null && c.nt <= T) {
          warnings.push(
            "CAP " + (c.p.name || c.p.id) + " lands at " + toTime(c.nt) + ", not after the armies."
          );
        }
      });
    } else {
      warnings.push("No CAP in this nuke: the last attack should be a CAP.");
    }
    if (skipped.length) {
      warnings.push(
        "Unreadable march time, player(s) left out: " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + "."
      );
    }

    var times = valid.map(function (r) { return r.t; });
    var newTimes = valid.map(function (r) { return r.nt; });
    var spreadOf = function (xs) {
      return xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    };

    // 1ʳᵉ armée à impacter (impact le plus tôt, départage par marche) → 90 form
    var firstArmy = null;
    armies.forEach(function (a) {
      if (!firstArmy || a.nt < firstArmy.nt || (a.nt === firstArmy.nt && a.t < firstArmy.t)) {
        firstArmy = a;
      }
    });

    // Formation auto selon l'ordre d'impact final
    function formationOf(r) {
      if (r.p.type === "cap") return (T != null && r.nt > T) ? "50" : "110";
      return r === firstArmy ? "90" : "110";
    }

    // Résultat : armées triées par marche (délais décroissants), CAPs à la fin
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
      impactTime: T == null ? null : toTime(T),
      impactSec: T,
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
