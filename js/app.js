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
  var PASSWORD = "family";

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
  // d'une ligne de joueur ("90 form", "F110NOCAPS", "Barrack", …). null sinon.
  function formTypeOf(formation) {
    var s = String(formation || "").toLowerCase();
    if (/barrack/.test(s)) return "Barrack";
    var m = s.match(/(110|90|50)/);
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
    else if (name === "history") renderHistory();
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
      // Côté du joueur : le sien s'il a été personnalisé, sinon celui de la nuke
      var pSide = p.side || n.side;
      // Cellule formation : lien direct vers le fichier .cas (côté + type)
      var ft = formTypeOf(p.formation);
      var files = ft ? Store.getFormations(pSide, ft) : [];
      var formCell;
      if (files.length) {
        formCell = '<a class="form-link" href="' + files[0].dataUrl + '" download="' +
          esc(files[0].name) + '" title="Download ' + esc(files[0].name) + '">' +
          ic("download") + " " + esc(p.formation) + "</a>";
      } else {
        formCell = esc(p.formation) +
          (ft ? ' <span class="form-missing" title="No ' + esc(pSide) + "/" +
            esc(ft) + ' file loaded">⚠</span>' : "");
      }
      var sideCell = p.side
        ? "<span class='pill small-pill side-" + esc(p.side.toLowerCase()) + "'>" + esc(p.side) + "</span>"
        : "<span class='muted small'>" + esc(n.side || "—") + "</span>";
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
          "<td class='strong impact'>" + esc(p.impact || "") + "</td>" +
          "<td>" + sideCell + "</td>" +
          "<td>" + formCell + "</td>" +
          "<td class='strong'>" + esc(p.launch) + "</td>" +
          "<td class='row-action'>" +
            "<button class='row-edit' data-edit-row='" + idx +
              "' title='Edit this player'>" + ic("pencil") + "</button>" +
            "<button class='row-del' data-del-row='" + idx +
              "' title='Remove this player'>" + ic("x") + "</button>" +
          "</td>" +
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
            '<button class="btn" id="optimize-nuke">' + ic("timer") + ' Optimize times</button>' +
            '<button class="btn" id="edit-nuke">' + ic("square-pen") + ' Edit</button>' +
            '<button class="btn danger" id="del-nuke">' + ic("trash-2") + ' Delete</button>' +
          "</div>" +
          "<div class='detail-result'>" +
            '<span class="result-label">Nuke fired?</span>' +
            '<button class="btn success" id="nuke-success">' + ic("check") + ' Success</button>' +
            '<button class="btn fail" id="nuke-fail">' + ic("x") + ' Fail</button>' +
          "</div>" +
        "</div>" +

        '<div class="detail-grid">' +
          '<div class="detail-table-wrap">' +
            '<table class="ptable"><thead><tr>' +
              "<th>ID</th><th>Player</th><th>Type</th><th>Qty</th>" +
              "<th>March</th><th>Off.</th><th>Impact</th><th>Side</th><th>Formation</th><th>Launch</th><th></th>" +
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
    document.getElementById("optimize-nuke").onclick = function () { openOptimizeModal(n); };
    document.getElementById("nuke-success").onclick = function () { recordResult(n, "success"); };
    document.getElementById("nuke-fail").onclick = function () { recordResult(n, "fail"); };
    el.view.querySelectorAll("[data-edit-row]").forEach(function (b) {
      b.onclick = function () {
        openParticipantForm(n, parseInt(b.dataset.editRow, 10));
      };
    });
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

  /* ---------- Formulaire : ajouter / éditer une ligne de joueur -------- */

  // editIdx absent → ajout d'une ligne ; présent → édition de la ligne idx
  function openParticipantForm(nuke, editIdx) {
    var editing = editIdx != null;
    var p = editing ? nuke.participants[editIdx] : null;
    if (editing && !p) return;

    var typeOpts = ["army", "cap"].map(function (t) {
      var sel = p && p.type === t ? " selected" : "";
      return '<option value="' + t + '"' + sel + ">" + t + "</option>";
    }).join("");
    var formOpts = Store.FORM_TYPES.map(function (t) {
      return '<option value="' + t + '">';
    }).join("");
    // Côté personnel : vide = celui de la nuke
    var sideOpts = '<option value="">Nuke side (' + esc(nuke.side || "—") + ")</option>" +
      SIDES.map(function (s) {
        var sel = p && p.side === s ? " selected" : "";
        return '<option value="' + s + '"' + sel + ">" + s + "</option>";
      }).join("");
    function v(field) { return esc(p ? (p[field] || "") : ""); }

    openModal(
      '<div class="modal-head"><h3>' + (editing ? "Edit " + esc(p.name || "player") : "Add a player") + "</h3>" +
        '<button class="x" data-close>✕</button></div>' +
      '<div class="pform">' +
        '<div class="pf"><label>Player *</label><input id="pf-name" placeholder="Nickname" value="' + v("name") + '"></div>' +
        '<div class="pf"><label>ID</label><input id="pf-id" placeholder="2571" value="' + v("id") + '"></div>' +
        '<div class="pf"><label>Type</label><select id="pf-type">' + typeOpts + "</select></div>" +
        '<div class="pf"><label>Quantity</label><input id="pf-qty" placeholder="x4" value="' + v("qty") + '"></div>' +
        '<div class="pf"><label>March</label><input id="pf-march" placeholder="16m32s" value="' + v("march") + '"></div>' +
        '<div class="pf"><label>Offset</label><input id="pf-offset" placeholder="+0s" value="' + v("offset") + '"></div>' +
        '<div class="pf"><label>Side</label><select id="pf-side">' + sideOpts + "</select></div>" +
        '<div class="pf"><label>Formation</label><input id="pf-form" list="pf-forms" placeholder="90" value="' + v("formation") + '">' +
          '<datalist id="pf-forms">' + formOpts + "</datalist></div>" +
        '<div class="pf"><label>Launch (HH:MM)</label><input id="pf-launch" placeholder="16:36" value="' + v("launch") + '"></div>' +
      "</div>" +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn primary" id="pf-save">' + (editing ? "Save" : "Add") + "</button>" +
      "</div>"
    );

    function val(id) { return (document.getElementById(id).value || "").trim(); }

    document.getElementById("pf-save").onclick = function () {
      var name = val("pf-name");
      if (!name) { alert("The player's nickname is required."); return; }
      var data = {
        id: val("pf-id"),
        name: name,
        type: val("pf-type").toLowerCase(),
        qty: val("pf-qty"),
        march: val("pf-march"),
        offset: val("pf-offset"),
        side: val("pf-side"), // vide = côté de la nuke
        formation: val("pf-form"),
        launch: val("pf-launch"),
      };
      if (editing) {
        // On garde les champs non exposés (impact optimisé, marque "manual")
        Object.keys(data).forEach(function (k) { p[k] = data[k]; });
      } else {
        data.manual = true;
        nuke.participants.push(data);
      }
      nuke.firstLaunch = computeFirstLaunch(nuke.participants);
      var btn = document.getElementById("pf-save");
      btn.disabled = true;
      btn.textContent = "Saving…";
      Store.saveNuke(nuke).then(function () {
        closeModal();
        renderNukeDetail(nuke.id);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = editing ? "Save" : "Add";
        showErr(e);
      });
    };
  }

  /* ---------- Optimisation des temps d'impact --------------------------- */

  // "20:30" / "20:30:15" -> secondes depuis minuit (null si illisible)
  function clockToSec(str) {
    var m = String(str || "").trim().match(/^(\d{1,2})[:hH](\d{2})(?:[:mM](\d{2}))?$/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
  }

  function secToClock(s) {
    s = ((s % 86400) + 86400) % 86400;
    function p(x) { return (x < 10 ? "0" : "") + x; }
    return p(Math.floor(s / 3600)) + ":" + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60);
  }

  // Heure de tir d'une ligne pour une heure d'impact donnée (horloge) :
  // launch = impact horloge de la ligne - sa marche
  function launchClockFor(row, res, clockSec) {
    return secToClock(clockSec + (row.impactSec - res.impactSec) - row.marchSec);
  }

  function openOptimizeModal(n) {
    var res = NukeOptimizer.optimize(n.participants);
    if (!res.rows.length) {
      alert("No readable march times (e.g. 6m11s) to optimize.");
      return;
    }

    var rows = res.rows.map(function (r, i) {
      var cls = r.offsetSec > 0 ? "off-plus" : (r.offsetSec < 0 ? "off-minus" : "");
      return "<tr><td>" + esc(r.id) + "</td><td class='strong'>" + esc(r.name) + "</td>" +
        "<td><span class='tag tag-" + esc(r.type) + "'>" + esc(r.type) + "</span></td>" +
        "<td>" + esc(r.qty) + "</td><td>" + esc(r.current) + "</td>" +
        "<td class='strong " + cls + "'>" + esc(r.offset) + "</td>" +
        "<td class='strong impact'>" + esc(r.newTime) + "</td>" +
        "<td class='strong' data-launch-cell='" + i + "'>—</td></tr>";
    }).join("");

    var warn = res.warnings.length
      ? '<div class="opt-warnings">' + res.warnings.map(function (w) {
          return "<div>" + ic("triangle-alert") + " " + esc(w) + "</div>";
        }).join("") + "</div>"
      : "";

    openModal(
      '<div class="modal-head"><h3>' + ic("timer") + ' Synchronized impact times</h3>' +
        '<button class="x" data-close>✕</button></div>' +
      '<div class="opt-summary">' +
        (res.impactTime ? 'All armies impact at <b class="ok">' + esc(res.impactTime) + "</b>" : "") +
        (res.capTime ? " · final CAP at <b>" + esc(res.capTime) + "</b>" : "") +
        " · spread <b>" + res.spreadBefore + "s → " + res.spreadAfter + "s</b></div>" +
      warn +
      '<div class="opt-clock">' +
        '<label class="lbl" for="opt-clock">Armies impact at (clock, optional):</label>' +
        '<input id="opt-clock" class="modal-input" placeholder="20:30:00" ' +
          'title="HH:MM or HH:MM:SS — fills the Launch column: when each player must fire">' +
      "</div>" +
      '<div class="opt-table-wrap"><table class="ptable small"><thead><tr>' +
        "<th>ID</th><th>Player</th><th>Type</th><th>Card</th>" +
        "<th>March</th><th>Send delay</th><th>Impact</th><th>Launch</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Close</button>' +
        '<button class="btn" id="opt-copy">' + ic("copy") + ' Copy for Discord</button>' +
        '<button class="btn primary" id="opt-apply">Apply to nuke</button>' +
      "</div>"
    );

    // Heure d'impact (horloge) -> remplit la colonne Launch en direct
    var clockInput = document.getElementById("opt-clock");
    function currentClock() { return clockToSec(clockInput.value); }
    clockInput.oninput = function () {
      var c = currentClock();
      res.rows.forEach(function (r, i) {
        var cell = document.querySelector("[data-launch-cell='" + i + "']");
        if (cell) cell.textContent = c == null ? "—" : launchClockFor(r, res, c);
      });
    };

    document.getElementById("opt-copy").onclick = function () {
      var txt = optimizedAsciiTable(res.rows, currentClock(), res);
      navigator.clipboard.writeText(txt).then(function () {
        document.getElementById("opt-copy").innerHTML = ic("check") + " Copied!";
        refreshIcons();
      }).catch(function () {
        window.prompt("Copy manually (Ctrl+C):", txt);
      });
    };

    document.getElementById("opt-apply").onclick = function () {
      var c = currentClock();
      res.rows.forEach(function (r) {
        var p = n.participants[r.idx];
        if (!p) return;
        p.offset = r.offset;
        p.impact = r.newTime;
        if (c != null) p.launch = launchClockFor(r, res, c);
      });
      // Réordonne le tableau selon l'ordre de tir optimisé
      // (les lignes non optimisées — temps illisible — restent en queue)
      var used = {};
      var ordered = res.rows.map(function (r) {
        used[r.idx] = true;
        return n.participants[r.idx];
      }).filter(Boolean);
      n.participants.forEach(function (p, i) {
        if (!used[i]) ordered.push(p);
      });
      n.participants = ordered;
      n.spread = res.spreadAfter + " seconds";
      n.firstLaunch = computeFirstLaunch(n.participants);
      var btn = document.getElementById("opt-apply");
      btn.disabled = true;
      btn.textContent = "Applying…";
      Store.saveNuke(n).then(function () {
        closeModal();
        renderNukeDetail(n.id);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Apply to nuke";
        showErr(e);
      });
    };
  }

  // Tableau ASCII (style bot) prêt à coller dans Discord, en bloc de code.
  // clockSec (optionnel) ajoute la colonne Launch (heure de tir par joueur).
  function optimizedAsciiTable(rows, clockSec, res) {
    var headers = ["ID", "Type", "Card", "Time", "Offset", "New time"];
    if (clockSec != null) headers.push("Launch");
    var data = rows.map(function (r) {
      var cells = [
        (r.id || "?") + "[" + (r.name || "?") + "]",
        r.type || "", r.qty || "", r.current, r.offset, r.newTime,
      ];
      if (clockSec != null) cells.push(launchClockFor(r, res, clockSec));
      return cells;
    });
    var widths = headers.map(function (h, i) {
      return data.reduce(function (w, d) {
        return Math.max(w, String(d[i]).length);
      }, h.length);
    });
    function center(s, w) {
      var pad = w - s.length;
      var left = Math.floor(pad / 2);
      return new Array(left + 1).join(" ") + s + new Array(pad - left + 1).join(" ");
    }
    function border() {
      return "+" + widths.map(function (w) {
        return new Array(w + 3).join("-");
      }).join("+") + "+";
    }
    function row(cells) {
      return "|" + cells.map(function (c, i) {
        return " " + center(String(c), widths[i]) + " ";
      }).join("|") + "|";
    }
    var out = [border(), row(headers), border()];
    data.forEach(function (d) { out.push(row(d)); });
    out.push(border());
    return "```\n" + out.join("\n") + "\n```";
  }

  /* ---------- Résultat d'une nuke (Success / Fail) ---------------------- */

  function recordResult(n, result) {
    if (!Store.isHistoryAvailable()) {
      alert("History is not set up yet.\n\nRun the updated supabase-setup.sql script " +
        "in Supabase (SQL Editor), then reload the page.");
      return;
    }
    var msg = result === "success"
      ? "Mark this nuke as a SUCCESS?\n\nIt will be saved to History and removed from the list."
      : "Mark this nuke as a FAIL?\n\nIt will be saved to History and the nuke stays in the list.";
    if (!confirm(msg)) return;

    Store.addHistoryEntry(n, result).then(function () {
      if (result === "success") {
        return Store.deleteNuke(n.id).then(function () { route("home"); });
      }
      renderNukeDetail(n.id);
    }).catch(showErr);
  }

  /* ---------- Vue : Historique (taux de réussite) ----------------------- */

  function renderHistory() {
    if (!Store.isHistoryAvailable()) {
      el.view.innerHTML =
        '<div class="page-head"><h2>History</h2></div>' +
        '<div class="empty">⚠ History table missing.<br><br>' +
        "Run the updated <b>supabase-setup.sql</b> script in Supabase " +
        "(SQL Editor), then reload the page.</div>";
      return;
    }

    var list = Store.getHistory();
    var total = list.length;
    var wins = list.filter(function (h) { return h.result === "success"; }).length;
    var fails = total - wins;
    var rate = total ? Math.round((wins * 100) / total) : 0;

    var statsHtml =
      '<div class="stats-row">' +
        '<div class="stat-card"><div class="stat-big rate">' + rate + "%</div>" +
          '<div class="stat-label">Success rate</div></div>' +
        '<div class="stat-card"><div class="stat-big ok">' + wins + "</div>" +
          '<div class="stat-label">Success</div></div>' +
        '<div class="stat-card"><div class="stat-big ko">' + fails + "</div>" +
          '<div class="stat-label">Fail</div></div>' +
        '<div class="stat-card"><div class="stat-big">' + total + "</div>" +
          '<div class="stat-label">Nukes fired</div></div>' +
      "</div>";

    var rows = list.map(function (h) {
      var d = h.firedAt ? new Date(h.firedAt) : null;
      var when = d
        ? d.toLocaleDateString() + " " +
          d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—";
      return (
        "<tr>" +
          "<td>" + esc(when) + "</td>" +
          "<td class='strong'>" + esc(h.target || "?") + "</td>" +
          "<td>" + (h.targetPlayer ? esc(h.targetPlayer) : "<span class='muted'>—</span>") + "</td>" +
          "<td><span class='side-" + esc((h.side || "").toLowerCase()) + " pill small-pill'>" +
            esc(h.side || "—") + "</span></td>" +
          "<td>" + (h.players || 0) + "</td>" +
          "<td><span class='tag tag-" + h.result + "'>" + h.result + "</span></td>" +
          "<td class='row-action'><button class='row-del' data-del-hist='" + h.id +
            "' title='Delete this entry'>" + ic("x") + "</button></td>" +
        "</tr>"
      );
    }).join("");

    el.view.innerHTML =
      '<div class="page-head"><h2>History</h2></div>' +
      (total
        ? statsHtml +
          '<div class="detail-table-wrap">' +
          '<table class="ptable"><thead><tr>' +
            "<th>Date</th><th>Target</th><th>Player</th><th>Side</th>" +
            "<th>Players</th><th>Result</th><th></th>" +
          "</tr></thead><tbody>" + rows + "</tbody></table></div>"
        : '<div class="empty">No nuke fired yet. On a nuke, use the ' +
          "<b>Success</b> / <b>Fail</b> buttons after firing it.</div>");

    el.view.querySelectorAll("[data-del-hist]").forEach(function (b) {
      b.onclick = function () {
        if (confirm("Delete this history entry?")) {
          Store.deleteHistoryEntry(b.dataset.delHist)
            .then(function () { renderHistory(); refreshIcons(); }).catch(showErr);
        }
      };
    });
    refreshIcons();
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

    // Target + Side saisis à la main : indispensables avec le tableau du bot,
    // qui ne contient ni TARGET ni SIDE (priorité sur le bloc collé).
    var existingSide = existing ? (existing.side || "") : "";
    var sideOpts = '<option value="">— From pasted block —</option>' +
      SIDES.map(function (s) {
        return '<option value="' + s + '"' + (s === existingSide ? " selected" : "") + ">" + s + "</option>";
      }).join("");

    openModal(
      '<div class="modal-head"><h3>' + (existing ? "Edit" : "New") +
        ' nuke</h3><button class="x" data-close>✕</button></div>' +
      '<div class="form-cols">' +
        '<div><label class="lbl">Target (castle):</label>' +
        '<input type="text" id="target-num" class="modal-input" placeholder="61667" value="' +
          esc(existing ? (existing.target || "") : "") + '"></div>' +
        '<div><label class="lbl">Side:</label>' +
        '<select id="nuke-side" class="modal-input">' + sideOpts + "</select></div>" +
      "</div>" +
      '<label class="lbl">Targeted player (enemy):</label>' +
      '<input type="text" id="target-player" class="modal-input" placeholder="Enemy player name" value="' +
        esc(existing ? (existing.targetPlayer || "") : "") + '">' +
      '<label class="lbl">Carousel (category):</label>' +
      '<select id="nuke-cat" class="modal-input">' + catOpts + "</select>" +
      '<label class="lbl">Paste the Discord block or the bot table here:</label>' +
      '<textarea id="raw" class="raw" placeholder="Either:&#10;TARGET : 61667&#10;SIDE : RIGHT&#10;2571 [nickname] | army | x4 | 16m32s | +4s - 90 form&#10;&#10;Or the bot table:&#10;|   94011[fredite]   | army |  x5  | 6m11s |">' +
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

    // Valeur du textarea telle que le navigateur la présente à l'ouverture :
    // c'est LA référence pour savoir si l'utilisateur a modifié le bloc
    // (comparer à existing.raw échoue à tort : \r\n et \n de tête normalisés)
    var initialRaw = document.getElementById("raw").value;

    document.getElementById("img").onchange = function (e) {
      imgFile = e.target.files[0] || null;
    };

    function refreshPreview() {
      if (!document.getElementById("preview").innerHTML &&
          !document.getElementById("raw").value.trim()) return;
      renderPreview(NukeParser.parseNuke(document.getElementById("raw").value));
    }
    document.getElementById("preview-btn").onclick = refreshPreview;
    // L'aperçu reflète aussi les champs manuels (Target / Side)
    document.getElementById("nuke-side").onchange = refreshPreview;
    document.getElementById("target-num").oninput = refreshPreview;

    document.getElementById("save-nuke").onclick = function () {
      var rawText = document.getElementById("raw").value;
      var parsed = NukeParser.parseNuke(rawText);
      // Bloc inchangé en édition → on garde les participants existants
      // (lignes ajoutées/retirées à la main, offsets/temps optimisés…)
      var keepParticipants = existing && rawText === initialRaw;
      var manualTarget = (document.getElementById("target-num").value || "").trim();
      var manualSide = document.getElementById("nuke-side").value;
      if (!parsed.target && !manualTarget && parsed.participants.length === 0) {
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
          target: manualTarget || parsed.target,
          targetPlayer: targetPlayer,
          categoryId: categoryId,
          side: manualSide || parsed.side,
          spread: keepParticipants ? existing.spread : parsed.spread,
          participants: keepParticipants ? existing.participants : parsed.participants,
          firstLaunch: keepParticipants ? existing.firstLaunch : parsed.firstLaunch,
          raw: keepParticipants ? (existing.raw || "") : parsed.raw,
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
    // Les champs manuels du formulaire priment sur le bloc collé
    var manualTarget = (document.getElementById("target-num") || {}).value || "";
    var manualSide = (document.getElementById("nuke-side") || {}).value || "";
    var shownTarget = manualTarget.trim() || parsed.target;
    var shownSide = manualSide || parsed.side;
    if (!shownTarget && parsed.participants.length === 0) {
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
      '<div class="preview-head">' + ic("circle-check") + ' Detected: <b>TARGET ' + esc(shownTarget || "?") + "</b>" +
      (parsed.targetPlayer ? " · PLAYER <b>" + esc(parsed.targetPlayer) + "</b>" : "") +
      " · SIDE <b>" + esc(shownSide || "?") + "</b>" +
      (parsed.spread ? " · SPREAD " + esc(parsed.spread) : "") +
      " · " + parsed.participants.length + " players</div>" +
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
