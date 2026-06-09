/* ============================================================
   PARSER — transforme le pavé Discord en objet "nuke"
   Format attendu (en-tête) :
       TARGET : 61667
       SIDE   : RIGHT
       SPREAD : 7 seconds
   Puis une ligne par participant :
       2571 [varju bence]  | army |  x4  | 16m32s | +4s - 90 form - "Launch" at 16:36
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
    var idName = parts[0] || "";
    var id = "";
    var name = "";
    var bracket = idName.match(/^(\S+)?\s*\[(.+?)\]/);
    if (bracket) {
      id = (bracket[1] || "").trim();
      name = bracket[2].trim();
    } else {
      // Pas de crochets : on prend le premier token comme id, le reste comme nom
      var tokens = idName.split(/\s+/);
      id = tokens.shift() || "";
      name = tokens.join(" ");
    }

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

    var participants = text
      .split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l && isParticipantLine(l); })
      // On exclut une éventuelle ligne d'en-tête contenant un "|"
      .filter(function (l) { return !/^(target|side|spread)\s*:/i.test(l); })
      .map(parseParticipant)
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

  window.NukeParser = { parseNuke: parseNuke };
})();
