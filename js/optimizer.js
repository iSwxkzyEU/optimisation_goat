/* ============================================================
   OPTIMIZER — optimise les temps d'impact d'une nuke.
   Règles (identiques au prompt ChatGPT utilisé avant) :
     - décalage max ±6s par joueur ;
     - spread total visé ≤ 8s (au mieux : on prévient si impossible) ;
     - la dernière attaque doit être un CAP, ~2s après la dernière armée ;
     - pas d'impacts en double sur la même seconde si possible ;
     - l'ordre logique du tir est conservé.
   Algorithme : on essaie toutes les fins de tir possibles pour les
   armées (entre la plus tôt et la plus tard atteignables avec ±6s).
   Pour chaque ancrage T : armées calées en arrière depuis T (1s
   d'écart, ordre conservé), CAPs placés ensuite (+2s puis +1s).
   On garde l'ancrage qui : 1. permet au CAP de frapper en dernier,
   2. minimise le spread, 3. évite les doublons. Ça gère aussi bien
   le resserrement simple que le cas "CAP lent" (armées retardées
   vers le CAP plutôt qu'avancées).
   ============================================================ */

(function () {
  "use strict";

  var MAX_OFFSET = 6;    // décalage max en secondes (+ ou -)
  var TARGET_SPREAD = 8; // spread total visé
  var CAP_GAP = 2;       // le CAP final arrive ~2s après la dernière armée

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

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Armées calées en arrière depuis la fin T : ordre conservé, 1s d'écart
  // quand c'est possible, chacune dans sa fenêtre ±6s.
  // W = largeur max de la fenêtre [T-W, T] : Infinity = espacement libre ;
  // un W réduit force des doublons pour compresser le spread (utilisé
  // seulement si ça permet de passer sous les 8s).
  function scheduleArmies(armies, T, W) {
    var n = armies.length;
    var s = new Array(n);
    var floor = W === Infinity ? -Infinity : T - W;
    for (var i = n - 1; i >= 0; i--) {
      var want = i === n - 1 ? T : s[i + 1] - 1;
      var lo = Math.max(armies[i].t - MAX_OFFSET, floor);
      var hi = Math.min(armies[i].t + MAX_OFFSET, T);
      s[i] = lo > hi ? hi : clamp(want, lo, hi);
    }
    return s;
  }

  // CAPs placés après la dernière armée : +2s pour le premier, +1s ensuite.
  // violations = CAPs qui ne peuvent pas frapper après ce qui précède.
  function scheduleCaps(caps, lastArmy) {
    var times = [];
    var violations = [];
    var prev = lastArmy;
    caps.forEach(function (c, k) {
      var want = prev == null ? c.t : prev + (k === 0 ? CAP_GAP : 1);
      var nt = clamp(want, c.t - MAX_OFFSET, c.t + MAX_OFFSET);
      if (prev != null && nt <= prev) violations.push(k);
      times.push(nt);
      prev = prev == null ? nt : Math.max(prev, nt);
    });
    return { times: times, violations: violations };
  }

  function countDupes(times) {
    var seen = {};
    var dupes = 0;
    times.forEach(function (t) {
      if (seen[t]) dupes++;
      seen[t] = true;
    });
    return dupes;
  }

  function spreadOf(times) {
    if (!times.length) return 0;
    return Math.max.apply(null, times) - Math.min.apply(null, times);
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
    var i, n = armies.length;
    var best = null;

    if (n) {
      // Fin de tir la plus tôt atteignable (passe avant, 1s d'écart)
      var e = new Array(n);
      for (i = 0; i < n; i++) {
        var lo = armies[i].t - MAX_OFFSET;
        e[i] = i === 0 ? lo : Math.max(lo, e[i - 1] + 1);
        if (e[i] > armies[i].t + MAX_OFFSET) e[i] = armies[i].t + MAX_OFFSET;
      }
      var Tmin = e[n - 1];
      var Tmax = armies[n - 1].t + MAX_OFFSET;

      // Largeurs de fenêtre candidates : libre (espacement 1s naturel)
      // puis compressées (doublons forcés, pour tenir le spread cible)
      var widths = [Infinity];
      for (var w = n - 1; w >= 0; w--) widths.push(w);

      // Balayage de tous les ancrages possibles de la dernière armée
      for (var T = Tmin; T <= Tmax; T++) {
        for (var wi = 0; wi < widths.length; wi++) {
          var s = scheduleArmies(armies, T, widths[wi]);
          var capRes = scheduleCaps(caps, s[n - 1]);
          var all = s.concat(capRes.times);
          var spread = spreadOf(all);
          var moved = 0; // somme des décalages : à spread égal, on bouge le moins possible
          s.forEach(function (v, k) { moved += Math.abs(v - armies[k].t); });
          capRes.times.forEach(function (v, k) { moved += Math.abs(v - caps[k].t); });
          var score = [
            caps.length ? capRes.violations.length : 0, // 1. le CAP doit finir
            Math.max(0, spread - TARGET_SPREAD),        // 2. tenir les 8s
            countDupes(all),                            // 3. pas de doublons
            spread,                                     // 4. spread minimal
            moved,                                      // 5. décalages minimaux
            T,                                          // 6. au plus tôt
          ];
          var better = !best;
          if (best) {
            for (i = 0; i < score.length; i++) {
              if (score[i] !== best.score[i]) { better = score[i] < best.score[i]; break; }
            }
          }
          if (better) best = { score: score, armyTimes: s, capRes: capRes };
        }
      }
      armies.forEach(function (a, k) { a.nt = best.armyTimes[k]; });
    } else {
      best = { capRes: scheduleCaps(caps, null) };
    }
    caps.forEach(function (c, k) { c.nt = best.capRes.times[k]; });

    // Avertissements
    best.capRes.violations.forEach(function (k) {
      var c = caps[k];
      warnings.push(
        "Le CAP " + (c.p.name || c.p.id) + " ne peut pas frapper en dernier : " +
        "même à +" + MAX_OFFSET + "s il arrive à " + toTime(c.nt) + "."
      );
    });
    if (!caps.length) {
      warnings.push("Aucun CAP dans la nuke : la dernière attaque devrait être un CAP.");
    }

    var newTimes = valid.map(function (r) { return r.nt; });
    var spreadBefore = spreadOf(valid.map(function (r) { return r.t; }));
    var spreadAfter = spreadOf(newTimes);
    if (spreadAfter > spreadBefore) {
      warnings.push(
        "Spread plus large qu'à l'origine : c'est le prix pour supprimer les " +
        "doublons et faire frapper le CAP en dernier (" + valid.length +
        " attaques distinctes occupent au moins " + (valid.length - 1) + "s)."
      );
    }
    if (spreadAfter > TARGET_SPREAD) {
      warnings.push(
        "Spread final de " + spreadAfter + "s (> " + TARGET_SPREAD + "s visés) : " +
        "impossible de faire mieux avec ±" + MAX_OFFSET + "s de décalage."
      );
    }

    var seen = {};
    var dupes = [];
    newTimes.forEach(function (t) {
      if (seen[t] && dupes.indexOf(t) === -1) dupes.push(t);
      seen[t] = true;
    });
    if (dupes.length) {
      warnings.push("Impacts en double (inévitables) à : " + dupes.map(toTime).join(", ") + ".");
    }
    if (skipped.length) {
      warnings.push(
        "Temps illisible, joueur(s) non optimisé(s) : " +
        skipped.map(function (r) { return r.p.name || r.p.id; }).join(", ") + "."
      );
    }

    // Résultat trié par nouveau temps = ordre de frappe
    var result = valid.slice().sort(function (a, b) { return a.nt - b.nt || a.t - b.t; })
      .map(function (r) {
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
      spreadBefore: spreadBefore,
      spreadAfter: spreadAfter,
      warnings: warnings,
    };
  }

  window.NukeOptimizer = {
    optimize: optimize,
    toSeconds: toSeconds,
    toTime: toTime,
  };
})();
