/* ============================================================
   VARIANTS — choisit le MEILLEUR plan dans le fichier de
   variantes du bot (⚔️ Dist "X" → 12345 … [Variant N (K attacks)]).

   MODÈLE : TOUT LE MONDE TIRE EN MÊME TEMPS. Personne ne décale son
   envoi — l'ordre d'arrivée est donc exactement l'ordre des temps de
   marche. (À ne pas confondre avec optimize() de optimizer.js, qui
   suppose un compte à rebours où chacun tire à SON instant.)

   Le bot propose des dizaines/centaines de variantes, déjà générées
   avec ses propres restrictions temporelles. On ne re-filtre donc pas
   sur le temps : ce serait écarter des plans qu'il juge tenables.
   Ce module se contente de choisir DANS ce qu'il propose :

     1. il découpe le fichier en variantes (tableaux ASCII) ;
     2. pour chaque variante il teste les SOUS-ENSEMBLES de joueurs
        (c'est comme ça qu'on élimine un joueur en double, ou qu'on
        obtient un capitaine en dernier) ;
     3. il ne garde que ceux dont la marche la plus LONGUE est celle
        d'un capitaine — sinon la nuke finirait sur une armée ;
     4. il classe et renvoie les meilleurs.

   Mesuré sur un vrai fichier de 62 variantes : piocher n'importe
   quels K (plutôt que couper la queue du tableau) trouve plus du
   DOUBLE de plans valides. D'où l'énumération complète ci-dessous.
   ============================================================ */

(function () {
  "use strict";

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
      uniquePlayers: opts.uniquePlayers !== false,
      include: opts.include || [],           // joueurs OBLIGATOIRES
      only: opts.only || null,               // si non vide : piocher UNIQUEMENT là-dedans
      exclude: opts.exclude || [],           // joueurs interdits
      fastest: !!opts.fastest,               // classer par nuke la plus RAPIDE
      limit: opts.limit || DEFAULT_LIMIT,
    };
  }

  function extend(base, over) {
    var out = {};
    for (var k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
    for (var j in over) if (over.hasOwnProperty(j)) out[j] = over[j];
    return out;
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

  // TOUT LE MONDE TIRE EN MÊME TEMPS. Personne ne décale son envoi, donc
  // l'ordre d'arrivée est EXACTEMENT l'ordre des temps de marche : la marche
  // la plus courte frappe en premier, la plus longue en dernier.
  // Conséquence directe : "un capitaine en dernier" veut dire que la marche
  // la plus LONGUE doit être celle d'un capitaine.
  //
  // À marche égale, l'armée est placée avant le capitaine : ils tombent
  // ensemble, et un capi qui tombe AVEC les armées ne ferme pas la nuke.
  function orderByArrival(subset) {
    return subset.slice().sort(function (a, b) {
      return a.marchSec - b.marchSec ||
             (a.type === "cap" ? 1 : 0) - (b.type === "cap" ? 1 : 0);
    });
  }

  // Formations déduites de l'ordre d'impact (cf. LOGIQUE-METIER.txt §6) :
  //   1re armée à frapper = 90 · autres armées = 110
  //   CAP qui frappe après TOUTES les armées = 50 · sinon (avec/avant) = 110
  function withFormations(rows) {
    var maxArmy = null;
    rows.forEach(function (r) {
      if (r.type !== "cap" && (maxArmy == null || r.marchSec > maxArmy)) maxArmy = r.marchSec;
    });
    var t0 = rows[0].marchSec;
    var firstArmyDone = false;
    return rows.map(function (r) {
      var form;
      if (r.type === "cap") {
        form = (maxArmy != null && r.marchSec > maxArmy) ? "50" : "110";
      } else if (!firstArmyDone) {
        form = "90";
        firstArmyDone = true;
      } else {
        form = "110";
      }
      return {
        id: r.id, name: r.name, type: r.type, qty: r.qty,
        march: r.march, marchSec: r.marchSec,
        landsSec: r.marchSec - t0,          // écart d'impact avec le 1er coup
        formation: form,
      };
    });
  }

  // Un sous-ensemble devient un "plan" seulement s'il passe TOUT : quotas
  // armées/capis, joueurs imposés, et surtout un capitaine STRICTEMENT en
  // dernier (aucune armée ne doit frapper aussi tard ou plus tard que lui).
  function evaluate(subset, variant, o) {
    var armies = 0, caps = 0, cards = 0, names = {}, i;
    var maxArmy = null, maxCap = null;

    for (i = 0; i < subset.length; i++) {
      var p = subset[i];
      if (p.type === "cap") {
        caps++;
        if (maxCap == null || p.marchSec > maxCap) maxCap = p.marchSec;
      } else {
        armies++;
        if (maxArmy == null || p.marchSec > maxArmy) maxArmy = p.marchSec;
      }
      cards += p.cards || 0;
      names[p.name] = true;
    }

    if (armies < o.minArmies || caps < o.minCaps) return null;
    for (i = 0; i < o.include.length; i++) {
      if (!names[o.include[i]]) return null;
    }
    // Le dernier impact doit être un capitaine, sans ex aequo avec une armée.
    if (maxCap == null || (maxArmy != null && maxCap <= maxArmy)) return null;

    var rows = withFormations(orderByArrival(subset));
    var ids = subset.map(function (x) { return x.id; }).slice().sort();

    return {
      variant: variant.no,
      rows: rows,
      attacks: rows.length,
      armies: armies,
      caps: caps,
      cards: cards,
      // Étalement réel des impacts : du premier coup au dernier.
      spread: rows[rows.length - 1].marchSec - rows[0].marchSec,
      // Durée totale de la nuke : tout le monde tirant en même temps, c'est la
      // marche la plus LONGUE (celle du capitaine qui ferme) — le temps qui
      // sépare le tir du dernier impact. Plus c'est court, moins le défenseur
      // a de temps pour réagir.
      duration: rows[rows.length - 1].marchSec,
      key: ids.join(","),
    };
  }

  // Plus la nuke est GROSSE, mieux c'est (plus d'armées + de capis frappent) :
  // le nombre total d'attaques prime. À taille égale, on PRIORISE LES CAPIS
  // (un capitaine de plus vaut mieux qu'un plan plus resserré). Ensuite seulement
  // les impacts les plus serrés, puis le moins de cartes de vitesse consommées.
  // (À attaques ET capis égaux, le nombre d'armées est identique — inutile de
  // le départager.)
  function compare(a, b) {
    return b.attacks - a.attacks ||
           b.caps - a.caps ||
           a.spread - b.spread ||
           a.cards - b.cards ||
           a.variant - b.variant;
  }

  // Variante "la plus RAPIDE d'abord" (case à cocher côté site) : on classe
  // sur la DURÉE de la nuke — du tir au dernier impact — avant tout le reste.
  // Les critères habituels (taille, capis, resserrement…) ne font plus que
  // départager deux plans qui tombent au même moment.
  // NB : la taille des plans reste celle décidée par les filtres ; cocher la
  // case ne va pas chercher un plan plus petit pour gagner du temps.
  function compareFast(a, b) {
    return a.duration - b.duration ||
           b.attacks - a.attacks ||
           b.caps - a.caps ||
           a.spread - b.spread ||
           a.cards - b.cards ||
           a.variant - b.variant;
  }

  /* ---------- Sélection DIVERSIFIÉE (pour enchaîner les nukes) --------
     Les meilleurs plans par qualité se ressemblent presque tous (un joueur
     d'écart). Or l'intérêt de garder 25 variantes, c'est d'avoir des rosters
     DIFFÉRENTS : après une 1ʳᵉ nuke, les mêmes joueurs sont cramés, il faut
     une 2ᵉ compo qui pioche ailleurs. On garde donc le MEILLEUR plan en n°1,
     puis on ajoute à chaque fois celui dont les joueurs diffèrent le PLUS de
     ceux déjà retenus (distance de Jaccard sur les IDs). La qualité ne sert
     plus qu'à départager deux candidats aussi différents l'un que l'autre. */

  // IDs de joueurs UNIQUES d'un plan (un même joueur en double ne compte qu'une fois).
  function uniqIds(plan) {
    var seen = {}, out = [];
    for (var i = 0; i < plan.rows.length; i++) {
      var id = plan.rows[i].id;
      if (!seen[id]) { seen[id] = true; out.push(id); }
    }
    return out;
  }

  // Distance de Jaccard entre deux jeux d'IDs : 0 = mêmes joueurs, 1 = aucun
  // joueur commun (le rêve pour enchaîner deux nukes sans réutiliser personne).
  function jaccardDist(aIds, bIds) {
    var setB = {}, i, inter = 0;
    for (i = 0; i < bIds.length; i++) setB[bIds[i]] = true;
    for (i = 0; i < aIds.length; i++) if (setB[aIds[i]]) inter++;
    var uni = aIds.length + bIds.length - inter;
    return uni ? 1 - inter / uni : 0;
  }

  // Poids de la qualité dans le choix des 24 suivants : petit, pour que la
  // DIFFÉRENCE de roster domine et que la qualité ne fasse que départager.
  var DIVERSITY_QUALITY_WEIGHT = 0.15;

  // À partir des plans triés par qualité (le meilleur en tête), renvoie `limit`
  // plans : le meilleur, puis les plus dissemblables les uns des autres.
  function selectDiverse(sorted, limit) {
    if (sorted.length <= limit) return sorted;

    // On diversifie dans un VIVIER de bons plans (pas parmi tout, sinon on
    // remonterait des plans faibles juste parce qu'ils sont exotiques).
    var pool = sorted.slice(0, Math.min(sorted.length, Math.max(limit * 8, 200)));
    var ids = pool.map(uniqIds);

    var chosen = [0];              // n°1 = la BEST NUKE EVER
    var taken = { 0: true };
    while (chosen.length < limit) {
      var bestI = -1, bestScore = -Infinity;
      for (var i = 0; i < pool.length; i++) {
        if (taken[i]) continue;
        var minD = Infinity;      // distance au plan déjà retenu le PLUS proche
        for (var c = 0; c < chosen.length; c++) {
          var d = jaccardDist(ids[i], ids[chosen[c]]);
          if (d < minD) minD = d;
        }
        var qual = 1 - i / pool.length;                 // 1 = meilleur du vivier
        var score = minD + DIVERSITY_QUALITY_WEIGHT * qual;
        if (score > bestScore) { bestScore = score; bestI = i; }
      }
      if (bestI < 0) break;
      chosen.push(bestI);
      taken[bestI] = true;
    }
    return chosen.map(function (i) { return pool[i]; });
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

      pool = orderByArrival(pool);

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

    var cmp = o.fastest ? compareFast : compare;
    plans.sort(cmp);

    // La sélection reste DIVERSIFIÉE (des rosters différents, pour enchaîner
    // les nukes), mais quand on a demandé "les plus rapides d'abord", on la
    // re-classe : sinon la liste sortirait dans l'ordre de diversification et
    // la case cochée n'aurait l'air d'agir que sur le plan n°1.
    var picked = selectDiverse(plans, o.limit);
    if (o.fastest) picked = picked.slice().sort(cmp);

    return {
      plans: picked,
      total: plans.length,
      scanned: scanned,
    };
  }

  window.VariantPicker = {
    parseFile: parseFile,
    playerList: playerList,
    search: search,
  };
})();
