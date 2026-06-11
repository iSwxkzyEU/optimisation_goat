/* ============================================================
   OPTIMIZER — synchronise les temps d'impact d'une nuke.
   Principe : le décalage est un DÉLAI D'ENVOI (on ne peut que
   retarder un départ, jamais l'avancer), PLAFONNÉ À +8s. Donc :
     - l'armée la plus lente fixe l'heure d'impact commune T ;
     - chaque armée part avec un délai (T - sa marche, max +8s)
       pour frapper à la même seconde ; une armée trop rapide
       pour rejoindre T est signalée (elle frappe au plus tard) ;
     - le CAP frappe en dernier, ~2s après les armées (s'il est
       plus lent il garde sa marche, s'il ne peut pas atteindre
       l'après-armées avec +8s il est signalé) ;
     - plusieurs CAPs : +1s entre eux, le plus lent ferme le tir.
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

    // 2) CAPs après les armées : T+2s, puis +1s entre eux — délai max +8s.
    //    Un CAP plus lent que ça garde sa marche (délai 0) : il arrive après.
    var prev = T;
    caps.forEach(function (c, k) {
      var want = prev == null ? c.t : prev + (k === 0 ? CAP_GAP : 1);
      c.nt = Math.max(c.t, Math.min(c.t + MAX_DELAY, want));
      if (T != null && c.nt <= T) {
        warnings.push(
          "CAP " + (c.p.name || c.p.id) + " cannot strike after the armies even with +" +
          MAX_DELAY + "s delay: it lands at " + toTime(c.nt) + "."
        );
      }
      prev = prev == null ? c.nt : Math.max(prev, c.nt);
    });
    if (!caps.length) {
      warnings.push("No CAP in this nuke: the last attack should be a CAP.");
    } else if (T != null) {
      var lastCap = caps[caps.length - 1];
      if (lastCap.nt - T > CAP_GAP + Math.max(0, caps.length - 1)) {
        warnings.push(
          "CAP " + (lastCap.p.name || lastCap.p.id) + " has a slower march: " +
          "it will strike " + (lastCap.nt - T) + "s after the armies."
        );
      }
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
