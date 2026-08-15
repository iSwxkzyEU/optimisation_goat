/* ============================================================
   VARIANTS — choisit le MEILLEUR plan dans le fichier de
   variantes du bot (⚔️ Dist "X" → 12345 … [Variant N (K attacks)]).

   Le bot propose des dizaines/centaines de variantes générées avec
   SA fenêtre (souvent 20 s). Le site, lui, synchronise dans une
   fenêtre de tir plus serrée (optimizer.js). Ce module fait le pont :

     1. il découpe le fichier en variantes (tableaux ASCII) ;
     2. pour chaque variante il teste les SOUS-ENSEMBLES de joueurs
        (retirer 1-2 lignes suffit souvent à rendre le plan tenable —
        et c'est aussi comme ça qu'on élimine un joueur en double) ;
     3. il ne garde que les plans que optimizer.js valide SANS aucune
        alerte : tout le monde dans la fenêtre, un capi qui ferme ;
     4. il classe et renvoie les meilleurs.

   Mesuré sur un vrai fichier de 62 variantes : piocher n'importe
   quels K (plutôt que couper la queue du tableau) trouve plus du
   DOUBLE de plans valides. D'où l'énumération complète ci-dessous.
   ============================================================ */

(function () {
  "use strict";

  var CAP_GAP = 2;        // doit rester aligné sur optimizer.js
  var DEFAULT_LIMIT = 25;

  /* ---------- Parsing du fichier ------------------------------------ */

  // "⚔️ Dist "VARJU" → 59169 (all, window 20s) [Variant 3 (7 attacks)]"
  var VARIANT_RE = /\[\s*Variant\s+(\d+)\s*\(\s*(\d+)\s*attacks?\s*\)\s*\]/i;
  var DIST_RE = /Dist\s*["“]([^"”]*)["”]\s*(?:→|->|=>)\s*(\S+)/i;
  var WINDOW_RE = /window\s*(\d+)\s*s/i;

  // "x4" -> 4 ; "none" -> 0 (aucune carte de vitesse nécessaire, tant mieux)
  function cardValue(qty) {
    var m = String(qty || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function parseFile(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var blocks = [];
    var cur = null;
    var head = { target: "", targetPlayer: "", sourceWindow: null };

    lines.forEach(function (line) {
      var m = line.match(VARIANT_RE);
      if (m) {
        if (!head.target) {
          var d = line.match(DIST_RE);
          if (d) { head.targetPlayer = d[1].trim(); head.target = d[2].trim(); }
          var w = line.match(WINDOW_RE);
          if (w) head.sourceWindow = parseInt(w[1], 10);
        }
        cur = { no: parseInt(m[1], 10), declared: parseInt(m[2], 10), lines: [] };
        blocks.push(cur);
        return;
      }
      if (cur) cur.lines.push(line);
    });

    // Le découpage fait, chaque tableau ASCII est relu par le parser
    // existant (il gère déjà les bordures, l'en-tête et "id[nom]").
    var players = {};
    var unreadable = 0;

    var variants = blocks.map(function (b) {
      var rows = NukeParser.parseTableBlock(b.lines).map(function (p) {
        p.marchSec = NukeOptimizer.toSeconds(p.march);
        p.cards = cardValue(p.qty);
        if (p.marchSec == null) unreadable++;
        return p;
      });
      rows.forEach(function (p) { players[p.name] = (players[p.name] || 0) + 1; });
      return { no: b.no, declared: b.declared, rows: rows };
    }).filter(function (v) { return v.rows.length; });

    return {
      target: head.target,
      targetPlayer: head.targetPlayer,
      sourceWindow: head.sourceWindow,
      variants: variants,
      players: players,
      unreadable: unreadable,
    };
  }

  // Liste des joueurs du fichier, du plus présent au moins présent.
  function playerList(parsed) {
    var names = [];
    for (var n in parsed.players) {
      if (parsed.players.hasOwnProperty(n)) names.push(n);
    }
    return names.sort(function (a, b) {
      return parsed.players[b] - parsed.players[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  /* ---------- Recherche --------------------------------------------- */

  function defaults(opts) {
    opts = opts || {};
    return {
      mode: opts.mode || "max",              // "max" | "min" | "exact"
      attacks: opts.attacks || 0,            // K, pour "min" et "exact"
      minArmies: opts.minArmies == null ? 2 : opts.minArmies,
      minCaps: opts.minCaps == null ? 1 : opts.minCaps,
      fireWindow: opts.fireWindow || 8,
      uniquePlayers: opts.uniquePlayers !== false,
      include: opts.include || [],           // joueurs OBLIGATOIRES
      only: opts.only || null,               // si non vide : piocher UNIQUEMENT là-dedans
      exclude: opts.exclude || [],           // joueurs interdits
      limit: opts.limit || DEFAULT_LIMIT,
    };
  }

  function extend(base, over) {
    var out = {};
    for (var k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
    for (var j in over) if (over.hasOwnProperty(j)) out[j] = over[j];
    return out;
  }

  // Instant de tir idéal : c'est sur cet axe que l'optimiseur resserre.
  function idealA(p) {
    return p.marchSec - (p.type === "cap" ? CAP_GAP : 0);
  }

  function hasName(rows, name) {
    for (var i = 0; i < rows.length; i++) if (rows[i].name === name) return true;
    return false;
  }

  // Toutes les combinaisons de k éléments, en élaguant dès qu'un joueur
  // serait pris deux fois (c'est l'élagage qui rend l'exhaustif abordable).
  function forEachCombo(pool, k, unique, cb) {
    if (k <= 0 || k > pool.length) return;
    var chosen = [];
    var used = {};

    (function rec(start) {
      if (chosen.length === k) { cb(chosen.slice()); return; }
      if (pool.length - start < k - chosen.length) return; // plus assez de candidats
      for (var i = start; i < pool.length; i++) {
        var p = pool[i];
        if (unique && used[p.name]) continue;              // joueur déjà dans le plan
        chosen.push(p);
        if (unique) used[p.name] = (used[p.name] || 0) + 1;
        rec(i + 1);
        chosen.pop();
        if (unique) used[p.name]--;
      }
    })(0);
  }

  // Un sous-ensemble devient un "plan" seulement s'il passe TOUT :
  // quotas armées/capis, joueurs imposés, et zéro alerte de l'optimiseur
  // (fenêtre de tir tenue + un capitaine en dernier impact).
  function evaluate(subset, variant, o) {
    var armies = 0, caps = 0, cards = 0, names = {}, i;
    for (i = 0; i < subset.length; i++) {
      var p = subset[i];
      if (p.type === "cap") caps++; else armies++;
      cards += p.cards || 0;
      names[p.name] = true;
    }
    if (armies < o.minArmies || caps < o.minCaps) return null;
    for (i = 0; i < o.include.length; i++) {
      if (!names[o.include[i]]) return null;
    }

    var res = NukeOptimizer.optimize(subset, o.fireWindow);
    if (res.warnings.length) return null;

    var ids = subset.map(function (x) { return x.id; }).slice().sort();
    return {
      variant: variant.no,
      rows: subset,
      res: res,
      attacks: subset.length,
      armies: armies,
      caps: caps,
      cards: cards,
      spread: res.impactSpread,
      fire: res.fireWindow,
      key: ids.join(","),
    };
  }

  // Plus d'attaques d'abord (une nuke plus grosse frappe plus fort), puis la
  // synchro la plus serrée, puis la fenêtre de tir la plus courte (plus facile
  // à exécuter), puis plus d'armées, puis le moins de cartes de vitesse.
  function compare(a, b) {
    return b.attacks - a.attacks ||
           a.spread - b.spread ||
           a.fire - b.fire ||
           b.armies - a.armies ||
           a.cards - b.cards ||
           a.variant - b.variant;
  }

  function search(parsed, options) {
    var o = defaults(options);
    var plans = [];
    var seen = {};
    var scanned = 0;

    (parsed.variants || []).forEach(function (v) {
      // Réservoir de la variante, une fois retirés les exclus, les hors-liste
      // et les marches illisibles.
      var pool = v.rows.filter(function (p) {
        if (p.marchSec == null) return false;
        if (o.exclude.length && o.exclude.indexOf(p.name) !== -1) return false;
        if (o.only && o.only.length && o.only.indexOf(p.name) === -1) return false;
        return true;
      });
      if (!pool.length) return;

      // Un joueur imposé absent de cette variante ? Inutile de la fouiller.
      for (var i = 0; i < o.include.length; i++) {
        if (!hasName(pool, o.include[i])) return;
      }

      pool = pool.slice().sort(function (a, b) { return idealA(a) - idealA(b); });

      var floor = Math.max(2, o.minArmies + o.minCaps);
      var top = pool.length;
      if (o.mode === "exact") { floor = o.attacks; top = o.attacks; }
      else if (o.mode === "min") { floor = Math.max(floor, o.attacks); }
      if (top > pool.length || floor > top) return;

      // On descend en taille : dès qu'une taille donne des plans, on ne
      // regarde qu'UN cran en dessous (alternatives) puis on s'arrête —
      // l'objectif est le plus gros plan possible, pas tous les plans.
      var bestSize = null;
      for (var k = top; k >= floor; k--) {
        if (bestSize != null && k < bestSize - 1) break;
        var found = 0;
        forEachCombo(pool, k, o.uniquePlayers, function (subset) {
          scanned++;
          var plan = evaluate(subset, v, o);
          if (!plan) return;
          found++;
          if (seen[plan.key]) return;
          seen[plan.key] = true;
          plans.push(plan);
        });
        if (found && bestSize == null) bestSize = k;
      }
    });

    plans.sort(compare);
    return {
      plans: plans.slice(0, o.limit),
      total: plans.length,
      scanned: scanned,
    };
  }

  // Rien trouvé ? Renvoie la plus petite fenêtre de tir qui donnerait un plan.
  // (Cas fréquent : le bot génère en 20 s, le site cherche en 8 s.)
  function suggestWindow(parsed, options) {
    var o = defaults(options);
    var ladder = [10, 12, 14, 16, 18, 20, 25, 30];
    for (var i = 0; i < ladder.length; i++) {
      if (ladder[i] <= o.fireWindow) continue;
      var probe = search(parsed, extend(o, { fireWindow: ladder[i], limit: 1 }));
      if (probe.total) return { window: ladder[i], total: probe.total };
    }
    return null;
  }

  window.VariantPicker = {
    parseFile: parseFile,
    playerList: playerList,
    search: search,
    suggestWindow: suggestWindow,
  };
})();
