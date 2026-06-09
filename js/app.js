/* ============================================================
   APP — interface, navigation, création/édition des nukes.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- CONFIG ---------------------------------------------------
     Mot de passe commun à l'entrée du site.
     👉 Pour le changer : remplace la valeur ci-dessous.
     (Note honnête : côté navigateur, ce mot de passe empêche le visiteur
      lambda d'entrer, mais quelqu'un de technique peut le contourner.
      Pour ton usage de guilde c'est suffisant ; la vraie barrière
      viendra avec la version en ligne.)                                   */
  var PASSWORD = "guerre2026";

  var SIDES = ["RIGHT", "LEFT", "FRONT", "BACK"];

  var el = {
    gate: document.getElementById("gate"),
    gateInput: document.getElementById("gate-input"),
    gateBtn: document.getElementById("gate-btn"),
    gateError: document.getElementById("gate-error"),
    app: document.getElementById("app"),
    view: document.getElementById("view"),
    modal: document.getElementById("modal"),
    modalContent: document.getElementById("modal-content"),
  };

  /* ---------- Utilitaires ---------------------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Icône Lucide (rendue après coup par refreshIcons)
  function ic(name) { return '<i data-lucide="' + name + '"></i>'; }
  function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }

  // Devine le type de formation (50 / 90 / 110 / Barrack) depuis le texte
  // d'une ligne de joueur ("90 form", "110 form", "Barrack", …). null sinon.
  function formTypeOf(formation) {
    var s = String(formation || "").toLowerCase();
    if (/barrack/.test(s)) return "Barrack";
    var m = s.match(/\b(110|90|50)\b/);
    return m ? m[1] : null;
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function showErr(e) {
    alert("Error: " + (e && e.message ? e.message : e) +
      "\n\n(Check your internet connection and that Supabase is properly configured.)");
  }

  function openModal(html) {
    el.modalContent.innerHTML = html;
    el.modal.classList.remove("hidden");
    refreshIcons();
  }
  function closeModal() {
    el.modal.classList.add("hidden");
    el.modalContent.innerHTML = "";
  }

  /* ---------- Porte (mot de passe) ------------------------------------- */

  function tryEnter() {
    if (el.gateInput.value === PASSWORD) {
      sessionStorage.setItem("gwp_ok", "1");
      showApp();
    } else {
      el.gateError.textContent = "Incorrect password.";
      el.gateInput.value = "";
      el.gateInput.focus();
    }
  }

  function showApp() {
    el.gate.classList.add("hidden");
    el.app.classList.remove("hidden");
    el.view.innerHTML = '<div class="empty">Loading data…</div>';
    Store.init().then(function () {
      route("home");
    }).catch(function (e) {
      el.view.innerHTML = '<div class="empty">⚠ Unable to load data.<br><br>' +
        "Details: " + esc(e && e.message ? e.message : e) + "<br><br>" +
        "If this is the very first launch, make sure the SQL script has been run in Supabase.</div>";
    });
  }

  /* ---------- Routing -------------------------------------------------- */

  var current = "home";
  var homeFilter = ""; // filtre "joueur visé" sur la liste des nukes (persistant)

  function route(name, param) {
    current = name;
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.route === name);
    });
    if (name === "home") renderHome();
    else if (name === "formations") renderFormations();
    else if (name === "nuke") renderNukeDetail(param);
    updateCounts();
    refreshIcons();
  }

  function updateCounts() {
    var c = document.getElementById("nav-count-nukes");
    if (c) c.textContent = Store.getNukes().length;
  }

  /* ---------- Vue : Accueil (cards) ------------------------------------ */

  function cardHtml(n) {
    var sideClass = "side-" + (n.side || "").toLowerCase();
    return (
      '<div class="card" data-nuke="' + n.id + '">' +
        '<div class="card-top">' +
          '<span class="card-label">TARGET</span>' +
          '<span class="card-target">' + esc(n.target || "?") + "</span>" +
          (n.targetPlayer
            ? '<span class="card-player">' + ic("user") + " " + esc(n.targetPlayer) + "</span>"
            : "") +
        "</div>" +
        '<div class="card-side ' + sideClass + '">' + esc(n.side || "—") + "</div>" +
        '<div class="card-meta">' +
          "<span>" + ic("users") + " " + n.participants.length + " players</span>" +
          (n.firstLaunch ? "<span>" + ic("rocket") + " " + esc(n.firstLaunch) + "</span>" : "") +
        "</div>" +
      "</div>"
    );
  }

  function renderHome() {
    var nukes = Store.getNukes();
    var categories = Store.getCategories();
    var hasContent = nukes.length || categories.length;

    el.view.innerHTML =
      '<div class="page-head">' +
        "<h2>Nukes</h2>" +
        '<div class="page-head-actions">' +
          '<button class="btn" id="add-cat">' + ic("folder-plus") + " New carousel</button>" +
          '<button class="btn primary" id="add-nuke">' + ic("plus") + " Add a Nuke</button>" +
        "</div>" +
      "</div>" +
      (hasContent
        ? (nukes.length
            ? '<div class="filter-bar">' + ic("search") +
                '<input id="filter-player" class="filter-input" type="text" ' +
                  'placeholder="Filter by targeted player…" value="' + esc(homeFilter) + '">' +
                '<button class="filter-clear" id="filter-clear" title="Clear filter">' + ic("x") + "</button>" +
              "</div>"
            : "") +
          '<div id="carousels-box"></div>'
        : '<div class="empty">No nukes yet. Click ' +
          '<b>“+ Add a Nuke”</b> and paste your Discord block, ' +
          'or <b>“+ New carousel”</b> to create a category first.</div>');

    document.getElementById("add-nuke").onclick = function () { openNukeForm(null); };
    document.getElementById("add-cat").onclick = createCategoryFlow;

    if (!hasContent) return;

    var box = document.getElementById("carousels-box");
    var input = document.getElementById("filter-player");

    function paint() {
      var q = homeFilter.trim().toLowerCase();
      var visible = q
        ? nukes.filter(function (n) { return (n.targetPlayer || "").toLowerCase().indexOf(q) !== -1; })
        : nukes;

      // Regroupe les nukes par catégorie
      var byCat = {};
      var uncategorized = [];
      visible.forEach(function (n) {
        if (n.categoryId && categories.some(function (c) { return c.id === n.categoryId; })) {
          (byCat[n.categoryId] = byCat[n.categoryId] || []).push(n);
        } else {
          uncategorized.push(n);
        }
      });

      var html = "";
      if (uncategorized.length) html += carouselHtml(null, "Uncategorized", uncategorized);
      categories.forEach(function (c) {
        var list = byCat[c.id] || [];
        if (q && !list.length) return; // pendant un filtre, on masque les rangées vides
        html += carouselHtml(c, c.name, list);
      });
      if (!html) html = '<div class="empty">No nuke targets “' + esc(homeFilter) + "”.</div>";

      box.innerHTML = html;
      box.querySelectorAll(".card").forEach(function (c) {
        c.onclick = function () { route("nuke", c.dataset.nuke); };
      });
      box.querySelectorAll("[data-rename-cat]").forEach(function (b) {
        b.onclick = function () { renameCategoryFlow(b.dataset.renameCat); };
      });
      box.querySelectorAll("[data-del-cat]").forEach(function (b) {
        b.onclick = function () { deleteCategoryFlow(b.dataset.delCat); };
      });
      refreshIcons();
    }

    if (input) {
      input.oninput = function () { homeFilter = input.value; paint(); };
      document.getElementById("filter-clear").onclick = function () {
        homeFilter = "";
        input.value = "";
        paint();
        input.focus();
      };
    }
    paint();
  }

  // Une rangée "carousel" : titre + tuiles qui défilent horizontalement
  function carouselHtml(category, title, list) {
    var actions = category
      ? '<div class="carousel-actions">' +
          '<button class="icon-btn-sm" data-rename-cat="' + category.id + '" title="Rename carousel">' + ic("pencil") + "</button>" +
          '<button class="icon-btn-sm" data-del-cat="' + category.id + '" title="Delete carousel">' + ic("trash-2") + "</button>" +
        "</div>"
      : "";
    var tiles = list.length
      ? list.map(cardHtml).join("")
      : '<div class="carousel-empty">Empty — pick this carousel on a nuke from its form.</div>';
    return (
      '<section class="carousel">' +
        '<div class="carousel-head">' +
          '<h3 class="carousel-title">' + esc(title) +
            ' <span class="carousel-count">' + list.length + "</span></h3>" +
          actions +
        "</div>" +
        '<div class="carousel-track">' + tiles + "</div>" +
      "</section>"
    );
  }

  /* ---------- Catégories (carousels) : créer / renommer / supprimer --- */

  function openTextPrompt(title, label, initial, okText, placeholder, onOk) {
    openModal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="x" data-close>✕</button></div>' +
      '<label class="lbl">' + esc(label) + "</label>" +
      '<input type="text" id="tp-input" class="modal-input" placeholder="' + esc(placeholder || "") +
        '" value="' + esc(initial || "") + '">' +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn primary" id="tp-ok">' + esc(okText) + "</button>" +
      "</div>"
    );
    var inp = document.getElementById("tp-input");
    inp.focus();
    function submit() {
      var v = (inp.value || "").trim();
      if (!v) { inp.focus(); return; }
      var btn = document.getElementById("tp-ok");
      btn.disabled = true;
      btn.textContent = "…";
      onOk(v, function (e) { btn.disabled = false; btn.textContent = okText; showErr(e); });
    }
    document.getElementById("tp-ok").onclick = submit;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  }

  function createCategoryFlow() {
    openTextPrompt("New carousel", "Carousel name (location)", "", "Create", "e.g. North bridge",
      function (name, onErr) {
        Store.addCategory(name).then(function () { closeModal(); renderHome(); }).catch(onErr);
      });
  }

  function renameCategoryFlow(id) {
    var cat = Store.getCategories().find(function (c) { return c.id === id; });
    openTextPrompt("Rename carousel", "Carousel name", cat ? cat.name : "", "Rename", "",
      function (name, onErr) {
        Store.renameCategory(id, name).then(function () { closeModal(); renderHome(); }).catch(onErr);
      });
  }

  function deleteCategoryFlow(id) {
    var cat = Store.getCategories().find(function (c) { return c.id === id; });
    var nm = cat ? cat.name : "";
    if (confirm("Delete carousel “" + nm + "”?\n\nIts nukes are NOT deleted — they move back to Uncategorized.")) {
      Store.deleteCategory(id).then(function () { renderHome(); }).catch(showErr);
    }
  }

  /* ---------- Vue : Détail d'une nuke ---------------------------------- */

  function renderNukeDetail(id) {
    var n = Store.getNuke(id);
    if (!n) { route("home"); return; }

    var rows = n.participants.map(function (p, idx) {
      // Cellule formation : lien direct vers le fichier .cas (côté + type)
      var ft = formTypeOf(p.formation);
      var files = ft ? Store.getFormations(n.side, ft) : [];
      var formCell;
      if (files.length) {
        formCell = '<a class="form-link" href="' + files[0].dataUrl + '" download="' +
          esc(files[0].name) + '" title="Download ' + esc(files[0].name) + '">' +
          ic("download") + " " + esc(p.formation) + "</a>";
      } else {
        formCell = esc(p.formation) +
          (ft ? ' <span class="form-missing" title="No ' + esc(n.side) + "/" +
            esc(ft) + ' file loaded">⚠</span>' : "");
      }
      var manualMark = p.manual
        ? ' <span class="manual-dot" title="Added manually">' + ic("user-plus") + "</span>"
        : "";
      return (
        "<tr>" +
          "<td>" + esc(p.id) + "</td>" +
          "<td class='strong'>" + esc(p.name) + manualMark + "</td>" +
          "<td><span class='tag tag-" + esc(p.type) + "'>" + esc(p.type) + "</span></td>" +
          "<td>" + esc(p.qty) + "</td>" +
          "<td>" + esc(p.march) + "</td>" +
          "<td>" + esc(p.offset) + "</td>" +
          "<td>" + formCell + "</td>" +
          "<td class='strong'>" + esc(p.launch) + "</td>" +
          "<td class='row-action'><button class='row-del' data-del-row='" + idx +
            "' title='Remove this player'>" + ic("x") + "</button></td>" +
        "</tr>"
      );
    }).join("");

    var sideForms = Store.getFormations(n.side) || {};
    var anyFile = Store.FORM_TYPES.some(function (t) {
      return (sideForms[t] || []).length;
    });
    var formationFiles = anyFile
      ? Store.FORM_TYPES.map(function (t) {
          var files = sideForms[t] || [];
          var chips = files.length
            ? files.map(function (f) {
                return '<a class="file-chip" href="' + f.dataUrl + '" download="' +
                  esc(f.name) + '">' + ic("paperclip") + " " + esc(f.name) + "</a>";
              }).join("")
            : '<span class="muted small">—</span>';
          return '<div class="form-type-row"><span class="form-type-badge">' + esc(t) +
            "</span>" + '<div class="file-list">' + chips + "</div></div>";
        }).join("")
      : '<span class="muted">No files for the ' + esc(n.side || "?") +
        ' side. Add them in the <b>Formations</b> tab.</span>';

    var img = n.targetImage
      ? '<img class="target-img" src="' + n.targetImage + '" alt="target castle" data-zoom="' + n.targetImage + '">'
      : '<div class="target-img placeholder">No screenshot</div>';

    el.view.innerHTML =
      '<button class="btn ghost" id="back">' + ic("arrow-left") + ' Back</button>' +
      '<div class="detail">' +
        '<div class="detail-head">' +
          "<div>" +
            "<div class='detail-target'>TARGET " + esc(n.target || "?") + "</div>" +
            (n.targetPlayer
              ? "<div class='detail-player'>" + ic("user") + " " + esc(n.targetPlayer) + "</div>"
              : "") +
            "<div class='detail-sub'>" +
              "<span class='side-" + esc((n.side||"").toLowerCase()) + " pill'>" + esc(n.side || "—") + "</span>" +
              "<span class='muted'>SPREAD : " + esc(n.spread || "—") + "</span>" +
            "</div>" +
          "</div>" +
          "<div class='detail-actions'>" +
            '<button class="btn" id="edit-nuke">' + ic("square-pen") + ' Edit</button>' +
            '<button class="btn danger" id="del-nuke">' + ic("trash-2") + ' Delete</button>' +
          "</div>" +
        "</div>" +

        '<div class="detail-grid">' +
          '<div class="detail-table-wrap">' +
            '<table class="ptable"><thead><tr>' +
              "<th>ID</th><th>Player</th><th>Type</th><th>Qty</th>" +
              "<th>March</th><th>Off.</th><th>Formation</th><th>Launch</th><th></th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>" +
            '<button class="btn add-row" id="add-row">' + ic("plus") + " Add a row</button>" +
          "</div>" +
          '<div class="detail-aside">' +
            "<h4>Target castle</h4>" + img +
          "</div>" +
        "</div>" +

        '<div class="formations-box">' +
          "<h4>" + ic("paperclip") + " Formations (" + esc(n.side || "?") + ") — loaded automatically</h4>" +
          '<div class="file-list">' + formationFiles + "</div>" +
        "</div>" +
      "</div>";

    document.getElementById("back").onclick = function () { route("home"); };
    document.getElementById("edit-nuke").onclick = function () { openNukeForm(n); };
    document.getElementById("del-nuke").onclick = function () {
      if (confirm("Delete this nuke?")) {
        Store.deleteNuke(n.id).then(function () { route("home"); }).catch(showErr);
      }
    };
    document.getElementById("add-row").onclick = function () { openParticipantForm(n); };
    el.view.querySelectorAll("[data-del-row]").forEach(function (b) {
      b.onclick = function () {
        var idx = parseInt(b.dataset.delRow, 10);
        var who = n.participants[idx] ? (n.participants[idx].name || "this row") : "this row";
        if (confirm("Remove " + who + " from the nuke?")) {
          n.participants.splice(idx, 1);
          n.firstLaunch = computeFirstLaunch(n.participants);
          Store.saveNuke(n).then(function () { renderNukeDetail(n.id); }).catch(showErr);
        }
      };
    });
    var zoom = el.view.querySelector("[data-zoom]");
    if (zoom) zoom.onclick = function () {
      openModal('<img class="zoomed" src="' + zoom.dataset.zoom + '">');
    };
    refreshIcons();
  }

  // Heure de lancement la plus tôt (pour la card)
  function computeFirstLaunch(participants) {
    return participants
      .map(function (p) { return p.launch; })
      .filter(Boolean)
      .sort()[0] || "";
  }

  /* ---------- Formulaire : ajouter une ligne de joueur ----------------- */

  function openParticipantForm(nuke) {
    var typeOpts = ["army", "cap"].map(function (t) {
      return '<option value="' + t + '">' + t + "</option>";
    }).join("");
    var formOpts = Store.FORM_TYPES.map(function (t) {
      return '<option value="' + t + '">';
    }).join("");

    openModal(
      '<div class="modal-head"><h3>Add a player</h3>' +
        '<button class="x" data-close>✕</button></div>' +
      '<div class="pform">' +
        '<div class="pf"><label>Player *</label><input id="pf-name" placeholder="Nickname"></div>' +
        '<div class="pf"><label>ID</label><input id="pf-id" placeholder="2571"></div>' +
        '<div class="pf"><label>Type</label><select id="pf-type">' + typeOpts + "</select></div>" +
        '<div class="pf"><label>Quantity</label><input id="pf-qty" placeholder="x4"></div>' +
        '<div class="pf"><label>March</label><input id="pf-march" placeholder="16m32s"></div>' +
        '<div class="pf"><label>Offset</label><input id="pf-offset" placeholder="+0s"></div>' +
        '<div class="pf"><label>Formation</label><input id="pf-form" list="pf-forms" placeholder="90">' +
          '<datalist id="pf-forms">' + formOpts + "</datalist></div>" +
        '<div class="pf"><label>Launch (HH:MM)</label><input id="pf-launch" placeholder="16:36"></div>' +
      "</div>" +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn primary" id="pf-save">Add</button>' +
      "</div>"
    );

    function val(id) { return (document.getElementById(id).value || "").trim(); }

    document.getElementById("pf-save").onclick = function () {
      var name = val("pf-name");
      if (!name) { alert("The player's nickname is required."); return; }
      nuke.participants.push({
        id: val("pf-id"),
        name: name,
        type: val("pf-type").toLowerCase(),
        qty: val("pf-qty"),
        march: val("pf-march"),
        offset: val("pf-offset"),
        formation: val("pf-form"),
        launch: val("pf-launch"),
        manual: true,
      });
      nuke.firstLaunch = computeFirstLaunch(nuke.participants);
      var btn = document.getElementById("pf-save");
      btn.disabled = true;
      btn.textContent = "Adding…";
      Store.saveNuke(nuke).then(function () {
        closeModal();
        renderNukeDetail(nuke.id);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Add";
        showErr(e);
      });
    };
  }

  /* ---------- Formulaire création / édition d'une nuke ----------------- */

  function openNukeForm(existing) {
    var raw = existing ? (existing.raw || "") : "";
    var imgPreview = existing && existing.targetImage
      ? '<img class="mini-preview" src="' + existing.targetImage + '">' : "";

    var existingCat = existing ? existing.categoryId : null;
    var catOpts = '<option value="">— Uncategorized —</option>' +
      Store.getCategories().map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === existingCat ? " selected" : "") +
          ">" + esc(c.name) + "</option>";
      }).join("");

    openModal(
      '<div class="modal-head"><h3>' + (existing ? "Edit" : "New") +
        ' nuke</h3><button class="x" data-close>✕</button></div>' +
      '<label class="lbl">Targeted player (enemy):</label>' +
      '<input type="text" id="target-player" class="modal-input" placeholder="Enemy player name" value="' +
        esc(existing ? (existing.targetPlayer || "") : "") + '">' +
      '<label class="lbl">Carousel (category):</label>' +
      '<select id="nuke-cat" class="modal-input">' + catOpts + "</select>" +
      '<label class="lbl">Paste the Discord block here:</label>' +
      '<textarea id="raw" class="raw" placeholder="TARGET : 61667&#10;SIDE : RIGHT&#10;SPREAD : 7 seconds&#10;&#10;2571 [nickname] | army | x4 | 16m32s | +4s - 90 form - &quot;Launch&quot; at 16:36">' +
        esc(raw) + "</textarea>" +
      '<button class="btn" id="preview-btn">' + ic("eye") + ' Parse preview</button>' +
      '<div id="preview" class="preview-zone"></div>' +
      '<label class="lbl">Target castle screenshot (optional):</label>' +
      '<input type="file" id="img" accept="image/*"> ' + imgPreview +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn primary" id="save-nuke">Save</button>' +
      "</div>"
    );

    var existingImage = existing ? existing.targetImage : null;
    var imgFile = null; // nouveau fichier choisi (sera envoyé au stockage)

    document.getElementById("img").onchange = function (e) {
      imgFile = e.target.files[0] || null;
    };

    document.getElementById("preview-btn").onclick = function () {
      var parsed = NukeParser.parseNuke(document.getElementById("raw").value);
      renderPreview(parsed);
    };

    document.getElementById("save-nuke").onclick = function () {
      var parsed = NukeParser.parseNuke(document.getElementById("raw").value);
      if (!parsed.target && parsed.participants.length === 0) {
        alert("The block looks empty or malformed. Check the format.");
        return;
      }
      var btn = document.getElementById("save-nuke");
      btn.disabled = true;
      btn.textContent = "Saving…";

      // 1) envoyer l'image si une nouvelle a été choisie, sinon garder l'ancienne
      var imgStep = imgFile
        ? Store.uploadFile("targets", imgFile)
        : Promise.resolve(existingImage);

      // Joueur visé : saisie manuelle prioritaire, sinon en-tête PLAYER du bloc
      var manualPlayer = (document.getElementById("target-player").value || "").trim();
      var targetPlayer = manualPlayer || parsed.targetPlayer || "";
      var categoryId = document.getElementById("nuke-cat").value || null;

      imgStep.then(function (imageUrl) {
        var nuke = {
          id: existing ? existing.id : null,
          target: parsed.target,
          targetPlayer: targetPlayer,
          categoryId: categoryId,
          side: parsed.side,
          spread: parsed.spread,
          participants: parsed.participants,
          firstLaunch: parsed.firstLaunch,
          raw: parsed.raw,
          targetImage: imageUrl || null,
        };
        return Store.saveNuke(nuke);
      }).then(function (saved) {
        closeModal();
        route("nuke", saved.id);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Save";
        showErr(e);
      });
    };

    // Auto-preview on open when editing
    if (raw) renderPreview(NukeParser.parseNuke(raw));
  }

  function renderPreview(parsed) {
    var z = document.getElementById("preview");
    if (!parsed.target && parsed.participants.length === 0) {
      z.innerHTML = '<span class="muted">Nothing detected yet.</span>';
      return;
    }
    var rows = parsed.participants.map(function (p) {
      return "<tr><td>" + esc(p.id) + "</td><td>" + esc(p.name) + "</td><td>" +
        esc(p.type) + "</td><td>" + esc(p.qty) + "</td><td>" + esc(p.march) +
        "</td><td>" + esc(p.offset) + "</td><td>" + esc(p.formation) +
        "</td><td>" + esc(p.launch) + "</td></tr>";
    }).join("");
    z.innerHTML =
      '<div class="preview-head">' + ic("circle-check") + ' Detected: <b>TARGET ' + esc(parsed.target || "?") + "</b>" +
      (parsed.targetPlayer ? " · PLAYER <b>" + esc(parsed.targetPlayer) + "</b>" : "") +
      " · SIDE <b>" + esc(parsed.side || "?") + "</b> · SPREAD " +
      esc(parsed.spread || "?") + " · " + parsed.participants.length + " players</div>" +
      '<table class="ptable small"><thead><tr><th>ID</th><th>Player</th><th>Type</th>' +
      "<th>Qty</th><th>March</th><th>Off.</th><th>Form.</th><th>Launch</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";
    refreshIcons();
  }

  /* ---------- Vue : Formations ----------------------------------------- */

  function renderFormations() {
    var blocks = SIDES.map(function (side) {
      // Pour chaque côté : un encart par type (50 / 90 / 110 / Barrack)
      var typeRows = Store.FORM_TYPES.map(function (t) {
        var files = Store.getFormations(side, t) || [];
        var list = files.length
          ? files.map(function (f) {
              return '<div class="file-row"><a class="file-chip" href="' + f.dataUrl +
                '" download="' + esc(f.name) + '">' + ic("paperclip") + " " + esc(f.name) + "</a>" +
                '<button class="x small" data-del="' + f.id + '" data-side="' + side +
                '" data-type="' + t + '" title="Delete">✕</button></div>';
            }).join("")
          : '<span class="muted small">No files.</span>';
        return (
          '<div class="ftype">' +
            '<div class="ftype-head"><span class="form-type-badge">' + esc(t) + "</span>" +
              '<label class="upload-mini" title="Add a ' + side + "/" + t + ' file">' +
                ic("plus") + '<input type="file" data-upload-side="' + side +
                '" data-upload-type="' + t + '" hidden></label>' +
            "</div>" +
            '<div class="file-list col">' + list + "</div>" +
          "</div>"
        );
      }).join("");

      return (
        '<div class="formation-card">' +
          '<div class="formation-head"><span class="side-' + side.toLowerCase() +
            ' pill">' + side + "</span></div>" +
          '<div class="ftype-list">' + typeRows + "</div>" +
        "</div>"
      );
    }).join("");

    el.view.innerHTML =
      '<div class="page-head"><h2>Formations</h2></div>' +
      '<p class="muted intro">Organize your <b>.cas</b> files by side then by type ' +
        "(50 / 90 / 110 / Barrack). On a nuke, each player automatically gets " +
        "the file matching their side and type.</p>" +
      '<div class="formations-grid">' + blocks + "</div>";

    el.view.querySelectorAll("[data-upload-side]").forEach(function (inp) {
      inp.onchange = function (e) {
        var f = e.target.files[0];
        if (!f) return;
        var side = inp.dataset.uploadSide, type = inp.dataset.uploadType;
        Store.uploadFile("formations", f).then(function (url) {
          return Store.addFormationFile(side, type, { name: f.name, url: url });
        }).then(function () {
          renderFormations();
        }).catch(showErr);
      };
    });
    el.view.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = function () {
        Store.deleteFormationFile(b.dataset.side, b.dataset.type, b.dataset.del)
          .then(function () { renderFormations(); }).catch(showErr);
      };
    });
    refreshIcons();
  }

  /* ---------- Câblage global ------------------------------------------- */

  el.gateBtn.onclick = tryEnter;
  el.gateInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryEnter();
  });

  document.querySelectorAll("[data-route]").forEach(function (b) {
    b.onclick = function () {
      route(b.dataset.route);
      el.app.classList.remove("nav-open"); // referme le menu sur mobile
    };
  });

  // Menu escamotable (mobile)
  var menuToggle = document.getElementById("menu-toggle");
  var overlay = document.getElementById("sidebar-overlay");
  if (menuToggle) menuToggle.onclick = function () { el.app.classList.toggle("nav-open"); };
  if (overlay) overlay.onclick = function () { el.app.classList.remove("nav-open"); };

  el.modal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close") || e.target.classList.contains("modal-backdrop")) {
      closeModal();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  // Si déjà déverrouillé dans cette session
  if (sessionStorage.getItem("gwp_ok") === "1") showApp();
  else el.gateInput.focus();

  // Affiche les icônes Lucide statiques (logo de la porte, etc.)
  refreshIcons();
})();
