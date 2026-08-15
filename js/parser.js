/* ============================================================
   PARSER — transforme le pavé Discord en objet "nuke"
   Format attendu (en-tête) :
       TARGET : 61667
       SIDE   : RIGHT
       SPREAD : 7 seconds
   Puis une ligne par participant :
       2571 [varju bence]  | army |  x4  | 16m32s | +4s - 90 form - "Launch" at 16:36
   Accepte AUSSI le tableau ASCII du bot :
       +----------------+------+------+-------+
       |       ID       | Type | Card |  Time |
       +----------------+------+------+-------+
       | 94011[fredite] | army |  x5  | 6m11s |
   (bordures et ligne d'en-tête ignorées, pipes externes retirés)
   Le parser est volontairement TOLÉRANT : espaces variables,
   formation en numéro ("90 form") ou en texte ("bacdoor titty slap"),
   tirets collés, etc.
   ============================================================ */

(function () {
  "use strict";

  // --- Helpers ----------------------------------------------------------

  function headerValue(text, key) {
    // Cherche "KEY : valeur" (insensible à la casse, espaces souples)
    var re = new RegExp("^\\s*" + key + "\\s*:\\s*(.+?)\\s*$", "im");
    var m = text.match(re);
    return m ? m[1].trim() : "";
  }

  // Une ligne participant contient au moins un "|"
  function isParticipantLine(line) {
    return line.indexOf("|") !== -1;
  }

  // Retire les pipes externes du format tableau : "| a | b |" -> "a | b"
  function stripOuterPipes(line) {
    return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").trim();
  }

  // Ligne d'en-tête du tableau ASCII : "| ID | Type | Card | Time |"
  // (avec éventuellement Form, Mod… selon le bot)
  function isTableHeader(line) {
    var cells = line.split("|").map(function (c) { return c.trim().toLowerCase(); });
    return cells[0] === "id" && cells.indexOf("type") !== -1;
  }

  // "94011[fredite]" ou "2571 [varju bence]" -> { id, name }
  function parseIdName(idName) {
    var bracket = idName.match(/^(\S+)?\s*\[(.+?)\]/);
    if (bracket) {
      return { id: (bracket[1] || "").trim(), name: bracket[2].trim() };
    }
    // Pas de crochets : premier token = id, le reste = nom
    var tokens = idName.split(/\s+/);
    return { id: tokens.shift() || "", name: tokens.join(" ") };
  }

  // Participant d'un tableau ASCII dont on connaît l'en-tête :
  // chaque cellule est lue à la position de sa colonne (Form, Mod…).
  function parseMappedParticipant(line, cols) {
    var parts = line.split("|").map(function (p) { return p.trim(); });
    function cell(names) {
      for (var i = 0; i < names.length; i++) {
        var at = cols.indexOf(names[i]);
        if (at !== -1) return parts[at] || "";
      }
      return "";
    }
    var idName = parseIdName(cell(["id"]));

    // Mod : "+8" / "-3" / "+4s" -> normalisé en "+8s"
    var offset = "";
    var om = cell(["mod", "offset", "off", "off."]).match(/^([+\-]?)\s*(\d+)/);
    if (om) offset = (om[1] || "") + om[2] + "s";

    return {
      id: idName.id,
      name: idName.name,
      type: cell(["type"]).toLowerCase(),
      qty: cell(["card", "qty"]).replace(/\s+/g, ""),
      march: cell(["time", "march"]).replace(/\s+/g, ""),
      offset: offset,
      formation: cell(["form", "formation"]),
      launch: cell(["launch"]),
    };
  }

  // Parse le 5e segment : "+4s - 90 form - \"Launch\" at 16:36"
  function parseTail(tail) {
    var offset = "";
    var launch = "";
    var formation = "";

    // 1) Heure de lancement : "Launch" at HH:MM   (guillemets optionnels)
    var launchRe = /["“”']?\s*launch\s*["“”']?\s*at\s*([0-2]?\d:[0-5]\d)/i;
    var lm = tail.match(launchRe);
    if (lm) {
      launch = lm[1];
      tail = tail.replace(launchRe, "");
    }

    // 2) Offset en tête : +4s / -2s / +0sec / +2 seconds / 0sec …
    //    Unité tolérante (s / sec / secs / second / seconds), normalisée en "s".
    //    On garde le signe tel quel (peut être absent) et on recolle "<signe><nombre>s".
    var offsetRe = /^\s*([+\-]?)\s*(\d+)\s*(?:seconds|second|secs|sec|s)\b/i;
    var om = tail.match(offsetRe);
    if (om) {
      offset = (om[1] || "") + om[2] + "s"; // ex : "+2sec" -> "+2s", "0 seconds" -> "0s"
      tail = tail.replace(offsetRe, "");
    }

    // 3) Ce qu'il reste = formation. On nettoie tirets/guillemets/espaces.
    formation = tail
      .replace(/^[\s\-–|"“”']+/, "")
      .replace(/[\s\-–|"“”']+$/, "")
      .trim();

    return { offset: offset, formation: formation, launch: launch };
  }

  function parseParticipant(line) {
    var parts = line.split("|").map(function (p) { return p.trim(); });

    // parts[0] = "2571 [varju bence]"
    var idName = parseIdName(parts[0] || "");
    var id = idName.id;
    var name = idName.name;

    var type = (parts[1] || "").toLowerCase();        // army / cap
    var qty = (parts[2] || "").replace(/\s+/g, "");    // x4
    var march = (parts[3] || "").replace(/\s+/g, "");  // 16m32s
    var tail = parseTail(parts.slice(4).join(" | "));  // reste

    return {
      id: id,
      name: name,
      type: type,
      qty: qty,
      march: march,
      offset: tail.offset,
      formation: tail.formation,
      launch: tail.launch,
    };
  }

  // --- API publique -----------------------------------------------------

  function parseNuke(rawText) {
    var text = String(rawText || "").replace(/\r\n/g, "\n");

    var target = headerValue(text, "TARGET");
    // Joueur ennemi visé : en-tête optionnel "PLAYER" ou "ENEMY"
    var targetPlayer = headerValue(text, "PLAYER") || headerValue(text, "ENEMY");
    var side = headerValue(text, "SIDE").toUpperCase();
    var spread = headerValue(text, "SPREAD");

    var lines = text
      .split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l && isParticipantLine(l); })
      // On exclut une éventuelle ligne d'en-tête contenant un "|"
      .filter(function (l) { return !/^(target|side|spread)\s*:/i.test(l); })
      .map(stripOuterPipes)
      .filter(Boolean);

    // Si le tableau a une ligne d'en-tête, elle donne l'ordre des colonnes
    // (ID / Type / Card / Time / Form / Mod…) ; sinon format Discord classique.
    var cols = null;
    lines.forEach(function (l) {
      if (!cols && isTableHeader(l)) {
        cols = l.split("|").map(function (c) { return c.trim().toLowerCase(); });
      }
    });

    var participants = lines
      .filter(function (l) { return !isTableHeader(l); })
      .map(function (l) {
        return cols ? parseMappedParticipant(l, cols) : parseParticipant(l);
      })
      .filter(function (p) { return p.name || p.id; });

    return {
      target: target,
      targetPlayer: targetPlayer,
      side: side,
      spread: spread,
      participants: participants,
      raw: rawText,
      // Heure de lancement la plus tôt, pour l'affichage sur la card
      firstLaunch: participants
        .map(function (p) { return p.launch; })
        .filter(Boolean)
        .sort()[0] || "",
    };
  }

  // Parse un bloc de lignes formant UN tableau ASCII -> liste de participants.
  // (bordures + ligne d'en-tête ignorées, comme dans parseNuke)
  // Utilisé par le sélecteur de variantes, qui découpe un fichier en N tableaux.
  function parseTableBlock(lines) {
    var kept = (lines || [])
      .map(function (l) { return String(l).trim(); })
      .filter(function (l) { return l && isParticipantLine(l); })
      .map(stripOuterPipes)
      .filter(Boolean);

    var cols = null;
    kept.forEach(function (l) {
      if (!cols && isTableHeader(l)) {
        cols = l.split("|").map(function (c) { return c.trim().toLowerCase(); });
      }
    });

    return kept
      .filter(function (l) { return !isTableHeader(l); })
      .map(function (l) { return cols ? parseMappedParticipant(l, cols) : parseParticipant(l); })
      .filter(function (p) { return p.name || p.id; });
  }

  window.NukeParser = { parseNuke: parseNuke, parseTableBlock: parseTableBlock };
})();
