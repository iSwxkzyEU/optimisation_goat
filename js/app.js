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

  // Type de formation d'une ligne de joueur. D'abord le NOM EXACT d'un type
  // existant (y compris ceux que tu as ajoutés : "120", "Wall"…), sinon on le
  // devine depuis le texte ("90 form", "F110NOCAPS", "Barrack"). null sinon.
  function formTypeOf(formation) {
    var s = String(formation || "").trim();
    if (!s) return null;
    var hit = Store.formTypes().find(function (t) {
      return t.toLowerCase() === s.toLowerCase();
    });
    if (hit) return hit;
    var lc = s.toLowerCase();
    if (/barrack/.test(lc)) return "Barrack";
    var m = lc.match(/(110|90|50)/);
    return m ? m[1] : null;
  }

  // Fichier de formation d'un joueur, pour un côté donné. On regarde d'abord
  // le NOM EXACT du fichier ("50 - Centre") : c'est ce qui permet d'avoir
  // plusieurs 50 sur un même côté et de donner le bon à chacun. Sinon, on
  // retombe sur le 1ᵉʳ fichier du type deviné ("50"). null si rien ne colle.
  function formationFileFor(side, formation) {
    var want = String(formation || "").trim().toLowerCase();
    if (!want) return null;
    var named = Store.formationFilesOfSide(side).find(function (f) {
      return String(f.name || "").trim().toLowerCase() === want;
    });
    if (named) return named;
    var ft = formTypeOf(formation);
    var files = ft ? Store.getFormations(side, ft) : [];
    return files.length ? files[0] : null;
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
  var currentParam = null;
  var homeFilter = ""; // filtre "joueur visé" sur la liste des nukes (persistant)
  var activeVar = 0;   // onglet (variante/plan) actif dans la fiche d'une nuke

  function route(name, param) {
    current = name;
    currentParam = param != null ? param : null;
    if (name === "home") renderHome();
    else if (name === "category") renderCategory(param);
    else if (name === "unsorted") renderUnsorted();
    else if (name === "formations") renderFormations();
    else if (name === "history") renderHistory();
    else if (name === "best") renderBest();
    else if (name === "nuke") renderNukeDetail(param);
    // État actif des entrées fixes (les encarts sont gérés par renderSidebar)
    document.querySelectorAll(".sidebar-nav .nav-btn[data-route]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.route !== "category" && b.dataset.route === name);
    });
    renderSidebar();
    refreshIcons();
  }

  // Re-rend la vue courante (après un changement de données : priorité, etc.)
  function rerender() { route(current, currentParam); }

  // Liste des encarts dans le menu + compteurs (priorité + par encart)
  function renderSidebar() {
    var box = document.getElementById("sidebar-cats");
    if (!box) return;
    var nukes = Store.getNukes();
    var cats = Store.getCategories();
    var homeCount = document.getElementById("nav-count-home");
    if (homeCount) {
      homeCount.textContent = nukes.filter(function (n) { return n.priority; }).length;
    }
    var html = cats.map(function (c) {
      var count = nukes.filter(function (n) { return n.categoryId === c.id; }).length;
      var active = current === "category" && currentParam === c.id ? " active" : "";
      return '<button class="nav-btn cat-nav' + active + '" data-route="category" data-cat="' + c.id + '">' +
        ic("folder") + "<span>" + esc(c.name) + "</span>" +
        '<span class="nav-count">' + count + "</span></button>";
    }).join("");

    // Filet de sécurité : nukes non rangées (aucun encart) → entrée "Unsorted"
    var unsorted = nukes.filter(function (n) { return isUncategorized(n, cats); }).length;
    if (unsorted) {
      var ua = current === "unsorted" ? " active" : "";
      html += '<button class="nav-btn cat-nav' + ua + '" data-route="unsorted">' +
        ic("inbox") + "<span>Unsorted</span>" +
        '<span class="nav-count">' + unsorted + "</span></button>";
    }

    box.innerHTML = html;
    box.querySelectorAll("[data-cat]").forEach(function (b) {
      b.onclick = function () {
        route("category", b.dataset.cat);
        el.app.classList.remove("nav-open"); // referme le menu sur mobile
      };
    });
    var ub = box.querySelector('[data-route="unsorted"]');
    if (ub) ub.onclick = function () {
      route("unsorted");
      el.app.classList.remove("nav-open");
    };
    refreshIcons();
  }

  // Une nuke est "non rangée" si elle n'a pas d'encart (ou un encart supprimé)
  function isUncategorized(n, cats) {
    return !n.categoryId || !cats.some(function (c) { return c.id === n.categoryId; });
  }

  /* ---------- Vue : Accueil (cards) ------------------------------------ */

  // Nom affiché d'une variante/plan : son label si renseigné, sinon "Plan N".
  function variantName(v, i) {
    return (v && v.label) ? v.label : "Plan " + (i + 1);
  }

  // Recherche libre sur une nuke : cible (village visé), joueur ennemi,
  // et villages participants (id + nom) de TOUTES les variantes. q est déjà
  // en minuscules + trim.
  function nukeMatches(n, q) {
    if ((n.target || "").toLowerCase().indexOf(q) !== -1) return true;
    if ((n.targetPlayer || "").toLowerCase().indexOf(q) !== -1) return true;
    return (n.variants || []).some(function (v) {
      return (v.participants || []).some(function (p) {
        return (
          (p.id || "").toLowerCase().indexOf(q) !== -1 ||
          (p.name || "").toLowerCase().indexOf(q) !== -1
        );
      });
    });
  }

  function cardHtml(n) {
    var v0 = (n.variants && n.variants[0]) || {};
    var nbVariants = (n.variants || []).length;
    var sideClass = "side-" + (v0.side || "").toLowerCase();
    var starOn = n.priority ? " on" : "";
    return (
      '<div class="card" data-nuke="' + n.id + '">' +
        '<button class="card-star' + starOn + '" data-star="' + n.id + '" title="' +
          (n.priority ? "Unpin from priority" : "Pin to priority") + '">' + ic("star") + "</button>" +
        '<div class="card-top">' +
          '<span class="card-label">TARGET</span>' +
          '<span class="card-target">' + esc(n.target || "?") + "</span>" +
          (n.targetPlayer
            ? '<span class="card-player">' + ic("user") + " " + esc(n.targetPlayer) + "</span>"
            : "") +
        "</div>" +
        '<div class="card-side ' + sideClass + '">' + esc(v0.side || "—") + "</div>" +
        '<div class="card-meta">' +
          "<span>" + ic("users") + " " + (v0.participants || []).length + " players</span>" +
          (nbVariants > 1 ? "<span>" + ic("layers") + " " + nbVariants + " plans</span>" : "") +
          (v0.firstLaunch ? "<span>" + ic("rocket") + " " + esc(v0.firstLaunch) + "</span>" : "") +
        "</div>" +
      "</div>"
    );
  }

  // Accueil = cibles prioritaires (épinglées ⭐, tous encarts confondus)
  function renderHome() {
    renderNukeList({
      title: "Priority targets",
      icon: "star",
      nukes: Store.getNukes().filter(function (n) { return n.priority; }),
      emptyHtml: 'No priority targets yet. Open a nuke and tap the ' + ic("star") +
        " star to pin it here — or add one below.",
      defaults: { priority: true, categoryId: null },
    });
  }

  // Vue d'un encart : uniquement les nukes rangées dans cette localisation
  function renderCategory(id) {
    var cat = Store.getCategories().find(function (c) { return c.id === id; });
    if (!cat) { route("home"); return; }
    renderNukeList({
      title: cat.name,
      icon: "folder",
      category: cat,
      nukes: Store.getNukes().filter(function (n) { return n.categoryId === id; }),
      emptyHtml: 'No nukes in “' + esc(cat.name) + '” yet. Click ' +
        "<b>“+ Add a Nuke”</b> to add one to this carousel.",
      defaults: { priority: false, categoryId: id },
    });
  }

  // Vue des nukes non rangées (aucun encart) — accessible via le menu
  function renderUnsorted() {
    var cats = Store.getCategories();
    renderNukeList({
      title: "Unsorted",
      icon: "inbox",
      nukes: Store.getNukes().filter(function (n) { return isUncategorized(n, cats); }),
      emptyHtml: "Nothing here — every nuke is filed into a carousel.",
      defaults: { priority: false, categoryId: null },
    });
  }

  // Rend une page-liste de nukes (accueil ou encart) : titre, actions, filtre, grille
  function renderNukeList(opts) {
    var nukes = opts.nukes;
    var catActions = opts.category
      ? '<button class="btn" id="rename-cat">' + ic("pencil") + " Rename</button>" +
        '<button class="btn danger" id="del-cat">' + ic("trash-2") + " Delete</button>"
      : "";

    el.view.innerHTML =
      '<div class="page-head">' +
        "<h2>" + ic(opts.icon) + " " + esc(opts.title) + "</h2>" +
        '<div class="page-head-actions">' +
          catActions +
          '<button class="btn primary" id="add-nuke">' + ic("plus") + " Add a Nuke</button>" +
        "</div>" +
      "</div>" +
      (nukes.length
        ? '<div class="filter-bar">' + ic("search") +
            '<input id="filter-player" class="filter-input" type="text" ' +
              'placeholder="Filter by village ID, target or player…" value="' + esc(homeFilter) + '">' +
            '<button class="filter-clear" id="filter-clear" title="Clear filter">' + ic("x") + "</button>" +
          "</div>" +
          '<div class="cards" id="cards-box"></div>'
        : '<div class="empty">' + opts.emptyHtml + "</div>");

    document.getElementById("add-nuke").onclick = function () { openNukeForm(null, opts.defaults); };
    if (opts.category) {
      document.getElementById("rename-cat").onclick = function () { renameCategoryFlow(opts.category.id); };
      document.getElementById("del-cat").onclick = function () { deleteCategoryFlow(opts.category.id); };
    }
    if (!nukes.length) return;

    var box = document.getElementById("cards-box");
    var input = document.getElementById("filter-player");

    function paint() {
      var q = homeFilter.trim().toLowerCase();
      var visible = q
        ? nukes.filter(function (n) { return nukeMatches(n, q); })
        : nukes;
      box.innerHTML = visible.length
        ? visible.map(cardHtml).join("")
        : '<div class="empty">No nuke targets “' + esc(homeFilter) + "”.</div>";
      wireCards(box);
      refreshIcons();
    }

    input.oninput = function () { homeFilter = input.value; paint(); };
    document.getElementById("filter-clear").onclick = function () {
      homeFilter = "";
      input.value = "";
      paint();
      input.focus();
    };
    paint();
  }

  // Câble les cards d'une grille : clic = ouvrir, clic sur l'étoile = épingler
  function wireCards(box) {
    box.querySelectorAll(".card").forEach(function (c) {
      c.onclick = function (e) {
        if (e.target.closest("[data-star]")) return;
        activeVar = 0; // on ouvre une fiche sur son 1ᵉʳ plan
        route("nuke", c.dataset.nuke);
      };
    });
    box.querySelectorAll("[data-star]").forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        togglePriority(b.dataset.star);
      };
    });
  }

  // Bascule l'étoile "prioritaire" d'une nuke puis rafraîchit la vue
  function togglePriority(id) {
    var n = Store.getNuke(id);
    if (!n) return;
    n.priority = !n.priority;
    Store.saveNuke(n).then(rerender).catch(showErr);
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
        Store.addCategory(name).then(function (cat) {
          closeModal();
          route("category", cat.id); // on ouvre directement le nouvel encart
        }).catch(onErr);
      });
  }

  function renameCategoryFlow(id) {
    var cat = Store.getCategories().find(function (c) { return c.id === id; });
    openTextPrompt("Rename carousel", "Carousel name", cat ? cat.name : "", "Rename", "",
      function (name, onErr) {
        Store.renameCategory(id, name).then(function () {
          closeModal();
          route("category", id);
        }).catch(onErr);
      });
  }

  function deleteCategoryFlow(id) {
    var cat = Store.getCategories().find(function (c) { return c.id === id; });
    var nm = cat ? cat.name : "";
    if (confirm("Delete carousel “" + nm + "”?\n\nIts nukes are NOT deleted — they stay in the app (and on the home page if marked priority).")) {
      Store.deleteCategory(id).then(function () { route("home"); }).catch(showErr);
    }
  }

  /* ---------- Vue : Détail d'une nuke ---------------------------------- */

  function renderNukeDetail(id) {
    var n = Store.getNuke(id);
    if (!n) { route("home"); return; }

    // Variante (plan) active : on borne l'index au cas où un plan a été supprimé.
    if (!n.variants || !n.variants.length) n.variants = [{ side: "", spread: "", participants: [], firstLaunch: "", raw: "" }];
    var vi = activeVar < 0 ? 0 : Math.min(activeVar, n.variants.length - 1);
    activeVar = vi;
    var v = n.variants[vi];

    var rows = v.participants.map(function (p, idx) {
      // Côté du joueur : le sien s'il a été personnalisé, sinon celui du plan
      var pSide = p.side || v.side;
      // Cellule formation : lien direct vers le fichier .cas (nom exact, sinon côté + type)
      var ft = formTypeOf(p.formation);
      var file = formationFileFor(pSide, p.formation);
      var formCell;
      if (file) {
        formCell = '<a class="form-link" href="' + file.dataUrl + '" download="' +
          esc(file.name) + '" title="Download ' + esc(file.name) + '">' +
          ic("download") + " " + esc(p.formation) + "</a>";
      } else {
        formCell = esc(p.formation) +
          (ft ? ' <span class="form-missing" title="No ' + esc(pSide) + "/" +
            esc(ft) + ' file loaded">⚠</span>' : "");
      }
      var sideCell = p.side
        ? "<span class='pill small-pill side-" + esc(p.side.toLowerCase()) + "'>" + esc(p.side) + "</span>"
        : "<span class='muted small'>" + esc(v.side || "—") + "</span>";
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
          "<td>" + sideCell + "</td>" +
          "<td>" + formCell + "</td>" +
          "<td class='row-action'>" +
            "<button class='row-edit' data-edit-row='" + idx +
              "' title='Edit this player'>" + ic("pencil") + "</button>" +
            "<button class='row-del' data-del-row='" + idx +
              "' title='Remove this player'>" + ic("x") + "</button>" +
          "</td>" +
        "</tr>"
      );
    }).join("");

    var sideForms = Store.getFormations(v.side) || {};
    var formTypeList = Store.formTypes();
    var anyFile = formTypeList.some(function (t) {
      return (sideForms[t] || []).length;
    });
    var formationFiles = anyFile
      ? formTypeList.map(function (t) {
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
      : '<span class="muted">No files for the ' + esc(v.side || "?") +
        ' side. Add them in the <b>Formations</b> tab.</span>';

    var img = n.targetImage
      ? '<img class="target-img" src="' + n.targetImage + '" alt="target castle" data-zoom="' + n.targetImage + '">'
      : '<div class="target-img placeholder">No screenshot</div>';

    // Barre d'onglets (plans) : un onglet par variante + bouton "ajouter".
    var multi = n.variants.length > 1;
    var tabs = n.variants.map(function (vv, i) {
      return '<button class="vtab' + (i === vi ? " active" : "") + '" data-vtab="' + i + '">' +
        ic("layers") + " " + esc(variantName(vv, i)) + "</button>";
    }).join("");
    var variantTabs =
      '<div class="variant-tabs">' + tabs +
        '<button class="vtab add" id="add-variant" title="Add another plan for this village">' +
          ic("plus") + " Plan</button>" +
        '<span class="vtab-spacer"></span>' +
        '<button class="vtab-act" id="rename-variant" title="Rename this plan">' + ic("pencil") + "</button>" +
        (multi ? '<button class="vtab-act danger" id="del-variant" title="Delete this plan">' + ic("trash-2") + "</button>" : "") +
      "</div>";

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
              "<span class='side-" + esc((v.side||"").toLowerCase()) + " pill'>" + esc(v.side || "—") + "</span>" +
              "<span class='muted'>SPREAD : " + esc(v.spread || "—") + "</span>" +
              (multi ? "<span class='muted'>" + ic("layers") + " " + esc(variantName(v, vi)) +
                " · " + n.variants.length + " plans</span>" : "") +
            "</div>" +
          "</div>" +
          "<div class='detail-actions'>" +
            '<button class="btn' + (n.priority ? " star-on" : "") + '" id="toggle-prio">' +
              ic("star") + (n.priority ? " Priority" : " Make priority") + "</button>" +
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

        variantTabs +

        '<div class="detail-grid">' +
          '<div class="detail-table-wrap">' +
            '<table class="ptable"><thead><tr>' +
              "<th>ID</th><th>Player</th><th>Type</th><th>Qty</th>" +
              "<th>March</th><th>Fire @</th><th>Side</th><th>Formation</th><th></th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>" +
            '<button class="btn add-row" id="add-row">' + ic("plus") + " Add a row</button>" +
          "</div>" +
          '<div class="detail-aside">' +
            "<h4>Target castle</h4>" + img +
          "</div>" +
        "</div>" +

        '<div class="formations-box">' +
          "<h4>" + ic("paperclip") + " Formations (" + esc(v.side || "?") + ") — loaded automatically</h4>" +
          '<div class="file-list">' + formationFiles + "</div>" +
        "</div>" +
      "</div>";

    document.getElementById("back").onclick = function () { route("home"); };
    document.getElementById("edit-nuke").onclick = function () { openNukeForm(n, null, { varIndex: vi }); };
    document.getElementById("del-nuke").onclick = function () {
      if (confirm("Delete this whole village (all its plans)?")) {
        Store.deleteNuke(n.id).then(function () { route("home"); }).catch(showErr);
      }
    };
    document.getElementById("add-row").onclick = function () { openParticipantForm(n, v); };
    document.getElementById("toggle-prio").onclick = function () {
      n.priority = !n.priority;
      Store.saveNuke(n).then(function () { renderNukeDetail(n.id); renderSidebar(); }).catch(showErr);
    };
    document.getElementById("optimize-nuke").onclick = function () { openOptimizeModal(n, v); };
    document.getElementById("nuke-success").onclick = function () { recordResult(n, v, "success"); };
    document.getElementById("nuke-fail").onclick = function () { recordResult(n, v, "fail"); };

    // Onglets (plans) : changer de variante / ajouter / renommer / supprimer
    el.view.querySelectorAll("[data-vtab]").forEach(function (b) {
      b.onclick = function () { activeVar = parseInt(b.dataset.vtab, 10); renderNukeDetail(n.id); };
    });
    document.getElementById("add-variant").onclick = function () {
      openNukeForm(n, null, { varIndex: n.variants.length, variantOnly: true });
    };
    document.getElementById("rename-variant").onclick = function () {
      openTextPrompt("Rename plan", "Plan name", v.label || "", "Rename", "e.g. Plan B, fast wave",
        function (name, onErr) {
          v.label = name;
          Store.saveNuke(n).then(function () { closeModal(); renderNukeDetail(n.id); }).catch(onErr);
        });
    };
    var delVar = document.getElementById("del-variant");
    if (delVar) delVar.onclick = function () {
      if (confirm("Delete the plan “" + variantName(v, vi) + "”? The other plans stay.")) {
        n.variants.splice(vi, 1);
        if (activeVar >= n.variants.length) activeVar = n.variants.length - 1;
        Store.saveNuke(n).then(function () { renderNukeDetail(n.id); }).catch(showErr);
      }
    };

    el.view.querySelectorAll("[data-edit-row]").forEach(function (b) {
      b.onclick = function () {
        openParticipantForm(n, v, parseInt(b.dataset.editRow, 10));
      };
    });
    el.view.querySelectorAll("[data-del-row]").forEach(function (b) {
      b.onclick = function () {
        var idx = parseInt(b.dataset.delRow, 10);
        var who = v.participants[idx] ? (v.participants[idx].name || "this row") : "this row";
        if (confirm("Remove " + who + " from the plan?")) {
          v.participants.splice(idx, 1);
          v.firstLaunch = computeFirstLaunch(v.participants);
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

  // variant = le plan ciblé. editIdx absent → ajout d'une ligne ; présent → édition.
  function openParticipantForm(nuke, variant, editIdx) {
    var editing = editIdx != null;
    var p = editing ? variant.participants[editIdx] : null;
    if (editing && !p) return;

    var typeOpts = ["army", "cap"].map(function (t) {
      var sel = p && p.type === t ? " selected" : "";
      return '<option value="' + t + '"' + sel + ">" + t + "</option>";
    }).join("");
    // Suggestions : les types (50, 90, …) ET les fichiers nommés du côté du
    // plan ("50 - Centre"), pour donner un fichier précis à ce joueur.
    var formOpts = Store.formTypes()
      .concat(Store.formationFilesOfSide((p && p.side) || variant.side)
        .map(function (f) { return f.name; }))
      .map(function (t) { return '<option value="' + esc(t) + '">'; }).join("");
    // Côté personnel : vide = celui du plan
    var sideOpts = '<option value="">Plan side (' + esc(variant.side || "—") + ")</option>" +
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
        '<div class="pf"><label>Fire</label><input id="pf-offset" placeholder="+0s" value="' + v("offset") + '"></div>' +
        '<div class="pf"><label>Side</label><select id="pf-side">' + sideOpts + "</select></div>" +
        '<div class="pf"><label>Formation</label><input id="pf-form" list="pf-forms" placeholder="90" value="' + v("formation") + '">' +
          '<datalist id="pf-forms">' + formOpts + "</datalist></div>" +
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
        side: val("pf-side"), // vide = côté du plan
        formation: val("pf-form"),
      };
      if (editing) {
        // On garde les champs non exposés (impact optimisé, marque "manual")
        Object.keys(data).forEach(function (k) { p[k] = data[k]; });
      } else {
        data.manual = true;
        variant.participants.push(data);
      }
      variant.firstLaunch = computeFirstLaunch(variant.participants);
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

  function openOptimizeModal(n, variant) {
    var res = NukeOptimizer.optimize(variant.participants);
    if (!res.rows.length) {
      alert("No readable march times (e.g. 6m11s) to optimize.");
      return;
    }

    var rows = res.rows.map(function (r) {
      return "<tr><td>" + esc(r.id) + "</td><td class='strong'>" + esc(r.name) + "</td>" +
        "<td><span class='tag tag-" + esc(r.type) + "'>" + esc(r.type) + "</span></td>" +
        "<td>" + esc(r.qty) + "</td><td>" + esc(r.current) + "</td>" +
        "<td class='strong impact'>" + esc(r.offset) + "</td>" +
        "<td><span class='form-type-badge'>" + esc(r.formation) + "</span></td></tr>";
    }).join("");

    openModal(
      '<div class="modal-head"><h3>' + ic("timer") + ' Synchronized impact times</h3>' +
        '<button class="x" data-close>✕</button></div>' +
      '<div class="opt-summary">' +
        'Fire window <b class="' + (res.fireWindow <= res.maxWindow ? "ok" : "") + '">' + res.fireWindow + "s</b>" +
        " (max " + res.maxWindow + "s)" +
        (res.impactSpread ? " · impacts spread <b>" + res.impactSpread + "s</b>" : " · <b class=\"ok\">perfectly synced</b>") +
        " · caps +" + res.capGap + "s · sorted by arrival<br>" +
        '<span class="muted">Fire @ = fire when the group countdown reaches this value (caps +' + res.capGap + "s later)</span></div>" +
      '<div class="opt-table-wrap"><table class="ptable small"><thead><tr>' +
        "<th>ID</th><th>Player</th><th>Type</th><th>Card</th>" +
        "<th>March</th><th>Fire @</th><th>Form.</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Close</button>' +
        '<button class="btn" id="opt-copy">' + ic("copy") + ' Copy for Discord</button>' +
        '<button class="btn primary" id="opt-apply">Apply to nuke</button>' +
      "</div>"
    );

    document.getElementById("opt-copy").onclick = function () {
      var txt = optimizedAsciiTable(res.rows);
      navigator.clipboard.writeText(txt).then(function () {
        document.getElementById("opt-copy").innerHTML = ic("check") + " Copied!";
        refreshIcons();
      }).catch(function () {
        window.prompt("Copy manually (Ctrl+C):", txt);
      });
    };

    document.getElementById("opt-apply").onclick = function () {
      res.rows.forEach(function (r) {
        var p = variant.participants[r.idx];
        if (!p) return;
        p.offset = r.offset;
        p.impact = r.newTime;
        p.formation = r.formation; // formation assignée automatiquement
      });
      // Réordonne le tableau selon l'ordre de tir optimisé
      // (les lignes non optimisées — temps illisible — restent en queue)
      var used = {};
      var ordered = res.rows.map(function (r) {
        used[r.idx] = true;
        return variant.participants[r.idx];
      }).filter(Boolean);
      variant.participants.forEach(function (p, i) {
        if (!used[i]) ordered.push(p);
      });
      variant.participants = ordered;
      variant.spread = res.spreadAfter + " seconds";
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
  // Générique : les colonnes dépendent de l'écran appelant.
  function asciiTable(headers, data) {
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

  // Écran "Synchronized impact times" : modèle à compte à rebours décalé.
  function optimizedAsciiTable(rows) {
    return asciiTable(["ID", "Type", "Card", "March", "Fire @", "Form"],
      rows.map(function (r) {
        return [
          (r.id || "?") + "[" + (r.name || "?") + "]",
          r.type || "", r.qty || "", r.current, r.offset, r.formation || "",
        ];
      }));
  }

  /* ---------- Résultat d'une nuke (Success / Fail) ---------------------- */

  function recordResult(n, variant, result) {
    if (!Store.isHistoryAvailable()) {
      alert("History is not set up yet.\n\nRun the updated supabase-setup.sql script " +
        "in Supabase (SQL Editor), then reload the page.");
      return;
    }
    // Un Fail reste dans la liste : simple confirmation.
    if (result === "fail") {
      if (!confirm("Mark this plan as a FAIL?\n\nIt will be saved to History and the village stays in the list.")) return;
      Store.addHistoryEntry(n, variant, "fail", {})
        .then(function () { renderNukeDetail(n.id); }).catch(showErr);
      return;
    }
    // Un Success demande le nombre d'armées utilisées (suivi dans l'historique).
    openSuccessModal(n, variant);
  }

  // Modale Success : combien d'armées a-t-il fallu pour réussir ?
  function openSuccessModal(n, variant) {
    var def = (variant.participants || []).length;
    openModal(
      '<div class="modal-head"><h3>' + ic("check") + " Nuke success</h3>" +
        '<button class="x" data-close>✕</button></div>' +
      '<p class="muted succ-intro">Target <b>' + esc(n.target || "?") + "</b>" +
        (n.targetPlayer ? " · <b>" + esc(n.targetPlayer) + "</b>" : "") +
        ". How many armies did it take to win?</p>" +
      '<label class="lbl">Armies used</label>' +
      '<input type="number" min="0" id="succ-armies" class="modal-input" value="' + def + '">' +
      '<label class="check-row"><input type="checkbox" id="succ-outside"> ' + ic("flame") +
        " Razed outside the nuke (the plan wasn’t used)</label>" +
      '<p class="muted small succ-hint">Tick this if the target was destroyed another way — ' +
        "it still counts as a success, but is flagged in the history.</p>" +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn success" id="succ-ok">' + ic("check") + " Save success</button>" +
      "</div>"
    );
    var inp = document.getElementById("succ-armies");
    var outside = document.getElementById("succ-outside");
    inp.focus();
    inp.select();

    // Rasé hors nuke → le nombre d'armées du plan n'a pas de sens, on le grise
    outside.onchange = function () {
      inp.disabled = outside.checked;
      inp.style.opacity = outside.checked ? ".5" : "";
    };

    function submit() {
      var isOutside = outside.checked;
      var armies = null;
      if (!isOutside) {
        armies = parseInt(inp.value, 10);
        if (isNaN(armies) || armies < 0) armies = def;
      }
      var btn = document.getElementById("succ-ok");
      btn.disabled = true;
      btn.textContent = "Saving…";
      Store.addHistoryEntry(n, variant, "success", { armies: armies, outsideNuke: isOutside }).then(function () {
        return Store.deleteNuke(n.id);
      }).then(function () {
        closeModal();
        route("home");
      }).catch(function (e) {
        btn.disabled = false;
        btn.innerHTML = ic("check") + " Save success";
        refreshIcons();
        showErr(e);
      });
    }
    document.getElementById("succ-ok").onclick = submit;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
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
    var outside = list.filter(function (h) { return h.outsideNuke; }).length;
    var rate = total ? Math.round((wins * 100) / total) : 0;

    var statsHtml =
      '<div class="stats-row">' +
        '<div class="stat-card"><div class="stat-big rate">' + rate + "%</div>" +
          '<div class="stat-label">Success rate</div></div>' +
        '<div class="stat-card"><div class="stat-big ok">' + wins + "</div>" +
          '<div class="stat-label">Success</div></div>' +
        '<div class="stat-card"><div class="stat-big ko">' + fails + "</div>" +
          '<div class="stat-label">Fail</div></div>' +
        '<div class="stat-card"><div class="stat-big amber">' + outside + "</div>" +
          '<div class="stat-label">Outside nuke</div></div>' +
        '<div class="stat-card"><div class="stat-big">' + total + "</div>" +
          '<div class="stat-label">Recorded</div></div>' +
      "</div>";

    var rows = list.map(function (h) {
      var d = h.firedAt ? new Date(h.firedAt) : null;
      var when = d
        ? d.toLocaleDateString() + " " +
          d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—";
      return (
        "<tr class='hist-row' data-hist='" + h.id + "' title='Click to see the attack detail'>" +
          "<td>" + esc(when) + "</td>" +
          "<td class='strong'>" + esc(h.target || "?") + "</td>" +
          "<td>" + (h.targetPlayer ? esc(h.targetPlayer) : "<span class='muted'>—</span>") + "</td>" +
          "<td><span class='side-" + esc((h.side || "").toLowerCase()) + " pill small-pill'>" +
            esc(h.side || "—") + "</span></td>" +
          "<td>" + (h.players || 0) + "</td>" +
          "<td>" + (h.armies != null ? "<b>" + h.armies + "</b>" : "<span class='muted'>—</span>") + "</td>" +
          "<td><span class='tag tag-" + h.result + "'>" + h.result + "</span>" +
            (h.outsideNuke ? " <span class='tag tag-outside' title='Razed outside the nuke'>outside</span>" : "") +
          "</td>" +
          "<td class='row-action'><button class='row-del' data-del-hist='" + h.id +
            "' title='Delete this entry'>" + ic("x") + "</button></td>" +
        "</tr>"
      );
    }).join("");

    el.view.innerHTML =
      '<div class="page-head"><h2>History</h2></div>' +
      (total
        ? statsHtml +
          '<p class="muted intro">Click a row to see the detail of that attack.</p>' +
          '<div class="detail-table-wrap">' +
          '<table class="ptable"><thead><tr>' +
            "<th>Date</th><th>Target</th><th>Player</th><th>Side</th>" +
            "<th>Players</th><th>Armies</th><th>Result</th><th></th>" +
          "</tr></thead><tbody>" + rows + "</tbody></table></div>"
        : '<div class="empty">No nuke fired yet. On a nuke, use the ' +
          "<b>Success</b> / <b>Fail</b> buttons after firing it.</div>");

    el.view.querySelectorAll("[data-hist]").forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest("[data-del-hist]")) return; // le clic "supprimer" ne l'ouvre pas
        var h = Store.getHistory().find(function (x) { return x.id === tr.dataset.hist; });
        if (h) openHistoryDetail(h);
      };
    });
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

  // Détail d'une attaque passée (depuis l'historique) : tableau des joueurs figé
  function openHistoryDetail(h) {
    var d = h.details || {};
    var parts = d.participants || [];
    var when = h.firedAt ? new Date(h.firedAt).toLocaleString() : "—";

    var rows = parts.map(function (p) {
      return "<tr><td>" + esc(p.id) + "</td><td class='strong'>" + esc(p.name) + "</td>" +
        "<td><span class='tag tag-" + esc(p.type) + "'>" + esc(p.type) + "</span></td>" +
        "<td>" + esc(p.qty) + "</td><td>" + esc(p.march) + "</td><td>" + esc(p.offset) + "</td>" +
        "<td>" + esc(p.formation || "") + "</td></tr>";
    }).join("");

    var table = parts.length
      ? '<div class="detail-table-wrap"><table class="ptable small"><thead><tr>' +
          "<th>ID</th><th>Player</th><th>Type</th><th>Qty</th><th>March</th><th>Fire @</th><th>Form.</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>"
      : '<p class="muted">No attack detail was recorded for this entry.</p>';

    openModal(
      '<div class="modal-head"><h3>' + ic("crosshair") + " Attack detail</h3>" +
        '<button class="x" data-close>✕</button></div>' +
      '<div class="hist-detail-meta">' +
        "<span class='tag tag-" + h.result + "'>" + h.result + "</span>" +
        (h.outsideNuke ? "<span class='tag tag-outside'>" + ic("flame") + " razed outside the nuke</span>" : "") +
        "<span class='side-" + esc((h.side || "").toLowerCase()) + " pill small-pill'>" +
          esc(h.side || "—") + "</span>" +
        "<span class='muted'>TARGET <b>" + esc(h.target || "?") + "</b></span>" +
        (h.targetPlayer ? "<span class='muted'>" + ic("user") + " " + esc(h.targetPlayer) + "</span>" : "") +
      "</div>" +
      '<div class="hist-detail-stats">' +
        "<div><span class='muted'>Date</span><b>" + esc(when) + "</b></div>" +
        "<div><span class='muted'>Players</span><b>" + (h.players || 0) + "</b></div>" +
        (h.armies != null ? "<div><span class='muted'>Armies used</span><b>" + h.armies + "</b></div>" : "") +
        (d.spread ? "<div><span class='muted'>Spread</span><b>" + esc(d.spread) + "</b></div>" : "") +
      "</div>" +
      table +
      (d.targetImage ? '<img class="hist-img" src="' + d.targetImage + '">' : "") +
      '<div class="modal-foot"><button class="btn ghost" data-close>Close</button></div>'
    );
  }

  /* ---------- Formulaire création / édition d'une nuke ----------------- */

  // ctx (optionnel) = { varIndex, variantOnly } :
  //   - existing null               -> nouveau village (crée la variante 0)
  //   - existing + varIndex existant -> édite ce plan + les infos du village
  //   - existing + variantOnly:true  -> ajoute un plan (champs village masqués)
  function openNukeForm(existing, defaults, ctx) {
    defaults = defaults || {};
    ctx = ctx || {};
    var variantOnly = !!ctx.variantOnly;
    var varIndex = ctx.varIndex != null ? ctx.varIndex : 0;
    var editVariant = existing && existing.variants ? existing.variants[varIndex] : null;

    var raw = editVariant ? (editVariant.raw || "") : "";
    var imgPreview = existing && existing.targetImage
      ? '<img class="mini-preview" src="' + existing.targetImage + '">' : "";

    var existingCat = existing ? existing.categoryId : (defaults.categoryId || null);
    var isPriority = existing ? existing.priority : !!defaults.priority;
    var catOpts = '<option value="">— Uncategorized —</option>' +
      Store.getCategories().map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === existingCat ? " selected" : "") +
          ">" + esc(c.name) + "</option>";
      }).join("");

    // Target + Side saisis à la main : indispensables avec le tableau du bot,
    // qui ne contient ni TARGET ni SIDE (priorité sur le bloc collé).
    // Side appartient au PLAN (variante) ; Target/Player/Category au village.
    var existingSide = editVariant ? (editVariant.side || "") : "";
    var sideOpts = '<option value="">— From pasted block —</option>' +
      SIDES.map(function (s) {
        return '<option value="' + s + '"' + (s === existingSide ? " selected" : "") + ">" + s + "</option>";
      }).join("");

    // En mode "ajout de plan", les champs du village (target/joueur/category/
    // priorité/image) sont déjà fixés : on ne montre que side + bloc collé.
    var villageFields = variantOnly ? "" : (
      '<div class="form-cols">' +
        '<div><label class="lbl">Target (castle):</label>' +
        '<input type="text" id="target-num" class="modal-input" placeholder="61667" value="' +
          esc(existing ? (existing.target || "") : "") + '"></div>' +
        '<div><label class="lbl">Side (this plan):</label>' +
        '<select id="nuke-side" class="modal-input">' + sideOpts + "</select></div>" +
      "</div>" +
      '<label class="lbl">Targeted player (enemy):</label>' +
      '<input type="text" id="target-player" class="modal-input" placeholder="Enemy player name" value="' +
        esc(existing ? (existing.targetPlayer || "") : "") + '">' +
      '<label class="lbl">Carousel (category):</label>' +
      '<select id="nuke-cat" class="modal-input">' + catOpts + "</select>" +
      '<label class="check-row"><input type="checkbox" id="nuke-prio"' + (isPriority ? " checked" : "") +
        "> " + ic("star") + " Mark as a priority target (shown on the home page)</label>"
    );

    // En mode "ajout de plan", on garde un sélecteur de Side (propre au plan).
    var variantSideField = variantOnly ? (
      '<label class="lbl">Side (this plan):</label>' +
      '<select id="nuke-side" class="modal-input">' + sideOpts + "</select>"
    ) : "";

    var title = variantOnly ? "Add a plan" : (existing ? "Edit nuke" : "New nuke");

    openModal(
      '<div class="modal-head"><h3>' + title + '</h3><button class="x" data-close>✕</button></div>' +
      villageFields +
      variantSideField +
      '<label class="lbl">' + (variantOnly
        ? "Paste this plan's block here (optional — you can also add players one by one after):"
        : "Paste the Discord block or the bot table here:") + "</label>" +
      '<textarea id="raw" class="raw" placeholder="Either:&#10;TARGET : 61667&#10;SIDE : RIGHT&#10;2571 [nickname] | army | x4 | 16m32s | +4s - 90 form&#10;&#10;Or the bot table:&#10;|   94011[fredite]   | army |  x5  | 6m11s |">' +
        esc(raw) + "</textarea>" +
      '<button class="btn" id="preview-btn">' + ic("eye") + ' Parse preview</button>' +
      '<div id="preview" class="preview-zone"></div>' +
      (variantOnly ? "" :
        '<label class="lbl">Target castle screenshot (optional):</label>' +
        '<input type="file" id="img" accept="image/*"> ' + imgPreview) +
      '<div class="modal-foot">' +
        '<button class="btn ghost" data-close>Cancel</button>' +
        '<button class="btn primary" id="save-nuke">Save</button>' +
      "</div>"
    );

    var existingImage = existing ? existing.targetImage : null;
    var imgFile = null; // nouveau fichier choisi (sera envoyé au stockage)

    // Valeur du textarea telle que le navigateur la présente à l'ouverture :
    // c'est LA référence pour savoir si l'utilisateur a modifié le bloc
    // (comparer à editVariant.raw échoue à tort : \r\n et \n de tête normalisés)
    var initialRaw = document.getElementById("raw").value;

    var imgInput = document.getElementById("img");
    if (imgInput) imgInput.onchange = function (e) {
      imgFile = e.target.files[0] || null;
    };

    function elVal(id) { var e = document.getElementById(id); return e ? e.value : ""; }

    function refreshPreview() {
      if (!document.getElementById("preview").innerHTML &&
          !document.getElementById("raw").value.trim()) return;
      renderPreview(NukeParser.parseNuke(document.getElementById("raw").value));
    }
    document.getElementById("preview-btn").onclick = refreshPreview;
    // L'aperçu reflète aussi les champs manuels (Target / Side)
    document.getElementById("nuke-side").onchange = refreshPreview;
    var targetNum = document.getElementById("target-num");
    if (targetNum) targetNum.oninput = refreshPreview;

    document.getElementById("save-nuke").onclick = function () {
      var rawText = document.getElementById("raw").value;
      var parsed = NukeParser.parseNuke(rawText);
      // Bloc inchangé en édition → on garde les participants existants
      // (lignes ajoutées/retirées à la main, offsets/temps optimisés…)
      var keepParticipants = editVariant && rawText === initialRaw;
      var manualTarget = (elVal("target-num") || "").trim();
      var manualSide = elVal("nuke-side");
      // En "ajout de plan", on autorise un plan VIDE (on le remplira ensuite via
      // "Add a row" ou un bloc colle). Sinon (nouveau village / edition), on
      // refuse un bloc vide/illisible.
      if (!variantOnly && !parsed.target && !manualTarget && parsed.participants.length === 0 && !keepParticipants) {
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

      // La variante (plan) construite/éditée depuis le formulaire.
      var newVariant = {
        label: editVariant ? (editVariant.label || "") : "",
        side: manualSide || parsed.side,
        spread: keepParticipants ? editVariant.spread : parsed.spread,
        participants: keepParticipants ? editVariant.participants : parsed.participants,
        firstLaunch: keepParticipants ? editVariant.firstLaunch : parsed.firstLaunch,
        raw: keepParticipants ? (editVariant.raw || "") : parsed.raw,
      };

      // Les variantes existantes (on remplace celle éditée ou on ajoute la nouvelle).
      var variants = existing ? existing.variants.slice() : [];
      var landedIndex = varIndex;
      if (varIndex < variants.length) variants[varIndex] = newVariant;
      else { variants.push(newVariant); landedIndex = variants.length - 1; }

      imgStep.then(function (imageUrl) {
        // En "ajout de plan", on ne touche pas aux infos du village.
        var nuke = variantOnly ? {
          id: existing.id,
          target: existing.target,
          targetPlayer: existing.targetPlayer,
          categoryId: existing.categoryId,
          priority: existing.priority,
          targetImage: existing.targetImage,
          variants: variants,
        } : {
          id: existing ? existing.id : null,
          target: manualTarget || parsed.target,
          targetPlayer: (elVal("target-player") || "").trim() || parsed.targetPlayer || "",
          categoryId: elVal("nuke-cat") || null,
          priority: !!(document.getElementById("nuke-prio") && document.getElementById("nuke-prio").checked),
          targetImage: imageUrl || null,
          variants: variants,
        };
        return Store.saveNuke(nuke);
      }).then(function (saved) {
        closeModal();
        activeVar = landedIndex;       // on atterrit sur le plan créé/édité
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
        "</td><td>" + esc(p.offset) + "</td><td>" + esc(p.formation) + "</td></tr>";
    }).join("");
    z.innerHTML =
      '<div class="preview-head">' + ic("circle-check") + ' Detected: <b>TARGET ' + esc(shownTarget || "?") + "</b>" +
      (parsed.targetPlayer ? " · PLAYER <b>" + esc(parsed.targetPlayer) + "</b>" : "") +
      " · SIDE <b>" + esc(shownSide || "?") + "</b>" +
      (parsed.spread ? " · SPREAD " + esc(parsed.spread) : "") +
      " · " + parsed.participants.length + " players</div>" +
      '<table class="ptable small"><thead><tr><th>ID</th><th>Player</th><th>Type</th>' +
      "<th>Qty</th><th>March</th><th>Fire</th><th>Form.</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";
    refreshIcons();
  }

  /* ---------- Vue : Formations ----------------------------------------- */

  function renderFormations() {
    // Types affichés : les 4 d'origine + ceux ajoutés (base ou slot vide local).
    var types = Store.formTypes();
    var blocks = SIDES.map(function (side) {
      // Pour chaque côté : un encart par type (50 / 90 / 110 / Barrack, …)
      var typeRows = types.map(function (t) {
        var files = Store.getFormations(side, t) || [];
        var list = files.length
          ? files.map(function (f) {
              return '<div class="file-row"><a class="file-chip" href="' + f.dataUrl +
                '" download="' + esc(f.name) + '">' + ic("paperclip") + " " + esc(f.name) + "</a>" +
                '<button class="row-edit" data-ren="' + f.id + '" data-side="' + esc(side) +
                '" data-type="' + esc(t) + '" title="Rename">' + ic("pencil") + "</button>" +
                '<button class="x small" data-del="' + f.id + '" data-side="' + esc(side) +
                '" data-type="' + esc(t) + '" title="Delete">✕</button></div>';
            }).join("")
          : '<span class="muted small">No files.</span>';
        // Un type ajouté par nous et encore SANS aucun fichier peut être retiré ;
        // dès qu'il a un fichier, c'est la corbeille du fichier qui le fait partir.
        var removable = !Store.isBuiltinFormType(t) && !Store.formationTypeHasFiles(t);
        var killSlot = removable
          ? '<button class="x small" data-del-type="' + esc(t) +
            '" title="Remove this empty formation">✕</button>'
          : "";
        return (
          '<div class="ftype">' +
            '<div class="ftype-head"><span class="form-type-badge">' + esc(t) + "</span>" +
              '<label class="upload-mini" title="Add a ' + esc(side) + "/" + esc(t) + ' file">' +
                ic("plus") + '<input type="file" data-upload-side="' + esc(side) +
                '" data-upload-type="' + esc(t) + '" hidden></label>' + killSlot +
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
      '<div class="page-head"><h2>Formations</h2>' +
        '<button class="btn primary" id="add-form-type">' + ic("plus") +
          " New formation</button></div>" +
      '<p class="muted intro">Organize your <b>.cas</b> files by side then by formation ' +
        "(50 / 90 / 110 / Barrack — add your own with <b>New formation</b>). " +
        "On a nuke, each player automatically gets the file matching their side " +
        "and formation.</p>" +
      '<div class="formations-grid">' + blocks + "</div>";

    document.getElementById("add-form-type").onclick = function () {
      var name = window.prompt("Name of the new formation (e.g. 120, Wall, Siege):", "");
      if (name == null) return;
      name = name.trim();
      if (!name) return;
      if (!Store.addFormationType(name)) {
        alert("“" + name + "” already exists.");
        return;
      }
      renderFormations();
    };

    el.view.querySelectorAll("[data-del-type]").forEach(function (b) {
      b.onclick = function () {
        Store.removeFormationType(b.dataset.delType);
        renderFormations();
      };
    });

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
    el.view.querySelectorAll("[data-ren]").forEach(function (b) {
      b.onclick = function () {
        var files = Store.getFormations(b.dataset.side, b.dataset.type) || [];
        var cur = (files.find(function (f) { return f.id === b.dataset.ren; }) || {}).name || "";
        var name = window.prompt(
          "Name of this formation (e.g. “" + b.dataset.type + " - Centre”):", cur);
        if (name == null) return;
        name = name.trim();
        if (!name || name === cur) return;
        Store.renameFormationFile(b.dataset.side, b.dataset.type, b.dataset.ren, name)
          .then(function () { renderFormations(); }).catch(showErr);
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

  /* ---------- Sélecteur de variantes ("Best nuke") -----------------------
     Le bot Discord peut proposer des centaines de variantes d'une même nuke.
     Cet écran cherche dedans le meilleur plan jouable.

     Un seul onglet, volontairement : "trouve-moi la plus grosse nuke" et
     "trouve-moi une nuke avec ces 3 joueurs connectés" sont la MÊME
     recherche, à un filtre près. En faire deux écrans ne créait qu'un
     doublon à maintenir.

     Le calcul (js/variants.js) est synchrone : quelques ms, même à 500
     variantes, donc les filtres se règlent en direct.                      */

  var picker = {
    parsed: null,
    token: 0,          // change à chaque fichier chargé (invalide le cache)
    error: "",
    mode: "max",       // max | min | exact
    attacks: 6,
    minArmies: 2,
    minCaps: 1,
    unique: true,      // un joueur ne peut pas apparaître deux fois dans le plan
    fastest: false,    // classer les plans par nuke la plus RAPIDE (durée du tir
                       // au dernier impact) plutôt que par plan le plus gros
    include: [],       // joueurs imposés (les "connectés")
    exclude: [],       // joueurs écartés de la recherche
    only: false,       // n'utiliser QUE les joueurs imposés
    open: null,        // clé du plan déplié dans le classement
    // Joueur ciblé, SAISI À LA MAIN. Le fichier du bot ne le contient pas :
    // le `Dist "…"` de son en-tête est l'ALLIANCE, pas le défenseur. On le
    // reprenait tel quel et la nuke naissait avec un nom faux. Vide = on
    // bloque la création tant que ce n'est pas renseigné.
    targetPlayer: "",
    playerError: false, // true après un clic "Create" sans nom saisi
  };

  function pickerOpts() {
    return {
      mode: picker.mode,
      attacks: picker.attacks,
      minArmies: picker.minArmies,
      minCaps: picker.minCaps,
      uniquePlayers: picker.unique,
      fastest: picker.fastest,
      include: picker.include,
      exclude: picker.exclude,
      only: picker.only && picker.include.length ? picker.include : null,
      limit: 25,
    };
  }

  // La recherche est relancée à chaque rendu : on la mémorise pour que
  // déplier un plan ne recalcule pas tout.
  var pickerCache = { key: "", out: null };

  function pickerSearch() {
    var o = pickerOpts();
    var key = picker.token + "|" + JSON.stringify(o);
    if (pickerCache.key === key && pickerCache.out) return pickerCache.out;
    var out = VariantPicker.search(picker.parsed, o);
    pickerCache = { key: key, out: out };
    return out;
  }

  /* --- Import du fichier (bloc commun aux deux onglets) --- */

  function pickerImportHtml() {
    if (picker.parsed) {
      var p = picker.parsed;
      return '<div class="vp-loaded">' + ic("file-check") +
        " <b>" + p.variants.length + "</b> variants loaded" +
        (p.target ? " · target <b>" + esc(p.target) + "</b>" : "") +
        (p.sourceWindow ? " · bot window <b>" + p.sourceWindow + "s</b>" : "") +
        '<button class="btn ghost small" id="vp-reset">' + ic("x") + " Change file</button></div>" +
        pickerPlayerHtml();
    }
    return '<div class="vp-import">' +
      '<textarea id="vp-text" class="vp-text" placeholder="Paste the bot&#39;s variants file here…&#10;&#10;⚔️ Dist &quot;…&quot; → 12345 (all, window 20s) [Variant 1 (8 attacks)]&#10;+-----------+------+------+--------+&#10;|     ID    | Type | Card |  Time  |"></textarea>' +
      '<div class="vp-import-foot">' +
        '<label class="btn ghost">' + ic("upload") + " Choose a file" +
          '<input type="file" id="vp-file" accept=".txt,.log,text/plain" hidden></label>' +
        '<button class="btn primary" id="vp-go">' + ic("search") + " Analyze</button>" +
      "</div>" +
      (picker.error ? '<p class="vp-err">' + ic("alert-triangle") + " " + esc(picker.error) + "</p>" : "") +
      "</div>";
  }

  // Le joueur ciblé, à SAISIR. Le fichier du bot n'a que `Dist "…"`, qui est le
  // nom de l'ALLIANCE : le reprendre donnait une nuke au mauvais nom, invisible
  // à la recherche et trompeuse sur Discord. On le montre donc à titre indicatif
  // et on demande le vrai nom avant de créer quoi que ce soit.
  function pickerPlayerHtml() {
    var hint = picker.parsed && picker.parsed.targetPlayer;
    return '<div class="vp-owner' + (picker.playerError ? " err" : "") + '">' +
        '<label for="vp-owner-in">' + ic("user") + " <b>Target player</b>" +
          '<span class="muted small"> — who owns village ' +
          esc((picker.parsed && picker.parsed.target) || "?") + "?</span></label>" +
        '<input id="vp-owner-in" type="text" maxlength="60" autocomplete="off" ' +
          'placeholder="Defender\'s in-game name" value="' + esc(picker.targetPlayer) + '">' +
        '<p class="muted small">' +
          (hint
            ? "The file says <b>" + esc(hint) + "</b> — that's the alliance from the " +
              "<code>Dist</code> line, not the defender. Type the real name."
            : "The bot's file doesn't carry the defender's name — type it here.") +
        "</p>" +
        (picker.playerError
          ? '<p class="vp-err">' + ic("alert-triangle") +
            " Fill in the target player before creating the nuke.</p>"
          : "") +
      "</div>";
  }

  // Saisie libre : on la garde dans `picker` car chaque clic (joueur, filtre…)
  // re-rend toute la page et effacerait sinon le champ. Pas de re-rendu à la
  // frappe — ce serait perdre le focus à chaque caractère.
  function bindPickerPlayer() {
    var input = document.getElementById("vp-owner-in");
    if (!input) return;
    input.oninput = function () {
      picker.targetPlayer = input.value;
      if (picker.playerError && input.value.trim()) {
        picker.playerError = false;
        var box = input.parentNode;
        if (box) box.classList.remove("err");
        var msg = box && box.querySelector(".vp-err");
        if (msg) msg.remove();
      }
    };
  }

  function loadPickerText(text, rerenderFn) {
    var parsed;
    try {
      parsed = VariantPicker.parseFile(text);
    } catch (e) {
      picker.error = "Could not read this file: " + (e && e.message ? e.message : e);
      rerenderFn();
      return;
    }
    if (!parsed.variants.length) {
      picker.error = "No variant found. Expected the bot's format: " +
        'a "[Variant N (K attacks)]" line followed by its ASCII table.';
      rerenderFn();
      return;
    }
    picker.parsed = parsed;
    picker.error = "";
    picker.token++;
    picker.open = null;
    picker.include = [];
    picker.exclude = [];
    // Nouveau fichier = nouvelle cible : on ne garde PAS le nom du précédent,
    // ce serait le meilleur moyen de créer une nuke au nom du voisin.
    picker.targetPlayer = "";
    picker.playerError = false;
    rerenderFn();
  }

  function bindPickerImport(rerenderFn) {
    var go = document.getElementById("vp-go");
    if (go) go.onclick = function () {
      var ta = document.getElementById("vp-text");
      var txt = ta ? ta.value : "";
      if (!txt.trim()) { picker.error = "Paste the file first (or pick it with the button)."; rerenderFn(); return; }
      loadPickerText(txt, rerenderFn);
    };

    var file = document.getElementById("vp-file");
    if (file) file.onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { loadPickerText(String(r.result), rerenderFn); };
      r.onerror = function () { picker.error = "Could not read the file."; rerenderFn(); };
      r.readAsText(f);
    };

    var reset = document.getElementById("vp-reset");
    if (reset) reset.onclick = function () {
      picker.parsed = null;
      picker.include = [];
      picker.open = null;
      picker.targetPlayer = "";
      picker.playerError = false;
      rerenderFn();
    };

    bindPickerPlayer();
  }

  /* --- Filtres --- */

  function sel(id, value, options) {
    return '<select id="' + id + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' +
        (String(o[0]) === String(value) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }

  function num(id, value, min, max) {
    return '<input type="number" id="' + id + '" value="' + value +
      '" min="' + min + '" max="' + max + '">';
  }

  function pickerFiltersHtml() {
    var modes = [["max", "Largest possible"], ["min", "At least…"], ["exact", "Exactly…"]];
    var needK = picker.mode !== "max";
    return '<div class="vp-filters">' +
      '<label class="vp-f"><span>Attacks</span>' + sel("vp-mode", picker.mode, modes) + "</label>" +
      (needK ? '<label class="vp-f"><span>How many</span>' + num("vp-attacks", picker.attacks, 2, 20) + "</label>" : "") +
      '<label class="vp-f"><span>Min armies</span>' + num("vp-armies", picker.minArmies, 0, 20) + "</label>" +
      '<label class="vp-f"><span>Min caps</span>' + num("vp-caps", picker.minCaps, 0, 20) + "</label>" +
      // Décoché : un joueur peut fournir deux armées au même plan. Ça ouvre
      // beaucoup plus de plans (49 variantes sur 62 contiennent un doublon),
      // au prix de mobiliser deux fois la même personne.
      '<label class="vp-f check"><input type="checkbox" id="vp-unique"' +
        (picker.unique ? " checked" : "") + "><span>No duplicate player</span></label>" +
      // Classement par VITESSE : la nuke qui tombe le plus tôt après le tir
      // passe en tête. Ça ne change pas les plans trouvés, juste leur ordre —
      // on ne rétrécit jamais un plan pour gagner quelques secondes.
      '<label class="vp-f check fast" title="Rank by how soon the nuke lands ' +
        '(fire → last impact) instead of by plan size">' +
        '<input type="checkbox" id="vp-fastest"' + (picker.fastest ? " checked" : "") +
        "><span>" + ic("zap") + " Fastest nukes first</span></label>" +
      // Pas de filtre de temps ici : le fichier du bot porte déjà SES
      // restrictions temporelles, en rajouter une par-dessus ne ferait que
      // jeter des plans que le bot juge tenables. L'écart de tir réel de
      // chaque plan reste affiché dans ses statistiques, à titre indicatif.
      "</div>";
  }

  // Joueurs présents plus d'une fois dans un plan (quand les doublons sont permis).
  function planDupes(p) {
    var seen = {}, dupes = [];
    p.rows.forEach(function (r) {
      if (seen[r.name] && dupes.indexOf(r.name) === -1) dupes.push(r.name);
      seen[r.name] = true;
    });
    return dupes;
  }

  function bindPickerFilters(rerenderFn) {
    function on(id, fn) {
      var e = document.getElementById(id);
      if (e) e.onchange = function () { picker.open = null; fn(e); rerenderFn(); };
    }
    on("vp-mode", function (e) { picker.mode = e.value; });
    on("vp-attacks", function (e) { picker.attacks = Math.max(2, parseInt(e.value, 10) || 2); });
    on("vp-armies", function (e) { picker.minArmies = Math.max(0, parseInt(e.value, 10) || 0); });
    on("vp-caps", function (e) { picker.minCaps = Math.max(0, parseInt(e.value, 10) || 0); });
    on("vp-unique", function (e) { picker.unique = e.checked; });
    on("vp-fastest", function (e) { picker.fastest = e.checked; });
  }

  /* --- Rendu d'un plan --- */

  // Durée d'une nuke : du tir au dernier impact (= la plus longue marche, tout
  // le monde tirant en même temps). C'est ce que classe "Fastest nukes first".
  function durLabel(sec) {
    return NukeOptimizer.toTime(sec || 0);
  }

  function planStatsHtml(p) {
    return '<div class="vp-stats">' +
      '<span class="vp-stat"><b>' + p.attacks + "</b> attacks</span>" +
      '<span class="vp-stat"><b>' + p.armies + "</b> armies</span>" +
      '<span class="vp-stat"><b>' + p.caps + "</b> caps</span>" +
      // Mise en avant quand c'est le critère de classement retenu.
      '<span class="vp-stat' + (picker.fastest ? " good" : "") + '">' +
        "lands in <b>" + esc(durLabel(p.duration)) + "</b></span>" +
      '<span class="vp-stat' + (p.spread <= 4 ? " good" : "") + '">impacts spread over <b>' +
        p.spread + "s</b></span>" +
      '<span class="vp-stat">speed cards <b>' + p.cards + "</b></span>" +
      '<span class="vp-stat faint">variant ' + p.variant + "</span>" +
      (function () {
        var d = planDupes(p);
        return d.length
          ? '<span class="vp-stat warn">' + ic("users") + " twice: <b>" +
            esc(d.join(", ")) + "</b></span>"
          : "";
      })() +
      "</div>";
  }

  // "Lands" = écart d'impact avec le premier coup. Tout le monde tirant en
  // même temps, c'est la marche qui fait l'ordre : cette colonne rend cet
  // ordre lisible au lieu de le laisser deviner.
  function landsLabel(sec) {
    return sec === 0 ? "first" : "+" + sec + "s";
  }

  function planTableHtml(p) {
    var last = p.rows.length - 1;
    var rows = p.rows.map(function (r, i) {
      return "<tr><td>" + esc(r.id) + "</td><td class='strong'>" + esc(r.name) + "</td>" +
        "<td><span class='tag tag-" + esc(r.type) + "'>" + esc(r.type) + "</span></td>" +
        "<td>" + esc(r.qty) + "</td><td>" + esc(r.march) + "</td>" +
        "<td class='strong impact'>" + esc(landsLabel(r.landsSec)) +
          (i === last ? " " + ic("flag") : "") + "</td>" +
        "<td><span class='form-type-badge'>" + esc(r.formation) + "</span></td></tr>";
    }).join("");
    return '<div class="opt-table-wrap"><table class="ptable small"><thead><tr>' +
      "<th>ID</th><th>Player</th><th>Type</th><th>Card</th>" +
      "<th>Time</th><th>Lands</th><th>Form.</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  // Le plan tel qu'on le colle dans Discord. Pas de "Fire @" : tout le monde
  // tire en même temps, seule la colonne Time compte.
  function planAsciiTable(p) {
    return asciiTable(["ID", "Type", "Card", "Time", "Lands", "Form"],
      p.rows.map(function (r) {
        return [
          (r.id || "?") + "[" + (r.name || "?") + "]",
          r.type || "", r.qty || "", r.march, landsLabel(r.landsSec), r.formation || "",
        ];
      }));
  }

  function pickerResultsHtml() {
    if (!picker.parsed) return "";
    var out = pickerSearch();

    if (!out.total) {
      return '<div class="vp-none">' + ic("search-x") +
        " <b>No plan matches these filters.</b><br>" +
        "Try fewer attacks, fewer required players, or allow a duplicate player." +
        "</div>";
    }

    var best = out.plans[0];
    var rest = out.plans.slice(1);

    var list = rest.map(function (p, i) {
      var opened = picker.open === p.key;
      var who = p.rows.map(function (r) {
        return "<span class='vp-who" + (r.type === "cap" ? " cap" : "") + "'>" + esc(r.name) + "</span>";
      }).join("");
      return '<div class="vp-row' + (opened ? " open" : "") + '" data-plan="' + esc(p.key) + '">' +
          '<div class="vp-row-head">' +
            '<span class="vp-rank">#' + (i + 2) + "</span>" +
            '<span class="vp-row-who">' + who + "</span>" +
            '<span class="vp-row-meta">' + p.attacks + " att · " + p.armies + "a/" +
              p.caps + "c · " + esc(durLabel(p.duration)) + " · " +
              p.spread + "s spread · V" + p.variant + "</span>" +
            ic(opened ? "chevron-up" : "chevron-down") +
          "</div>" +
          (opened ? '<div class="vp-row-body">' + planStatsHtml(p) + planTableHtml(p) +
            '<button class="btn primary small" data-create="' + esc(p.key) + '">' +
            ic("plus") + " Create nuke from this plan</button></div>" : "") +
        "</div>";
    }).join("");

    return '<div class="vp-results">' +
        '<div class="vp-winner">' +
          '<div class="vp-winner-head">' + ic(picker.fastest ? "zap" : "trophy") +
            " <h3>" + (picker.fastest ? "Fastest plan" : "Best plan") + "</h3>" +
            '<span class="muted small">' + out.total + " valid plan" + (out.total > 1 ? "s" : "") +
            " found · " + out.scanned + " combinations tested</span></div>" +
          planStatsHtml(best) +
          planTableHtml(best) +
          '<div class="vp-winner-foot">' +
            '<button class="btn primary" id="vp-create-all">' +
              ic("layers") + " Create nuke with all " + out.plans.length + " plans</button>" +
            '<button class="btn ghost" data-create="' + esc(best.key) + '">' +
              ic("plus") + " Only this plan</button>" +
            '<button class="btn ghost" id="vp-copy">' + ic("copy") + " Copy for Discord</button>" +
          "</div>" +
        "</div>" +
        (rest.length ? '<h4 class="vp-sub">Runners-up</h4><div class="vp-list">' + list + "</div>" : "") +
      "</div>";
  }

  function bindPickerResults(rerenderFn) {
    if (!picker.parsed) return;
    var out = pickerSearch();
    function planByKey(k) {
      for (var i = 0; i < out.plans.length; i++) if (out.plans[i].key === k) return out.plans[i];
      return null;
    }

    el.view.querySelectorAll("[data-plan]").forEach(function (row) {
      row.querySelector(".vp-row-head").onclick = function () {
        picker.open = picker.open === row.dataset.plan ? null : row.dataset.plan;
        rerenderFn();
      };
    });

    el.view.querySelectorAll("[data-create]").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var p = planByKey(b.dataset.create);
        if (p) createNukeFromPlan(p, b);
      };
    });

    var createAll = document.getElementById("vp-create-all");
    if (createAll && out.plans.length) createAll.onclick = function () {
      createNukeFromAllPlans(out.plans, createAll);
    };

    var copy = document.getElementById("vp-copy");
    if (copy && out.plans.length) copy.onclick = function () {
      var txt = planAsciiTable(out.plans[0]);
      navigator.clipboard.writeText(txt).then(function () {
        copy.innerHTML = ic("check") + " Copied!";
        refreshIcons();
      }).catch(function () {
        window.prompt("Copy manually (Ctrl+C):", txt);
      });
    };
  }

  // Un plan (sortie du picker) -> une variante enregistrable. `rank` sert au
  // libellé : 0 = "Best", sinon "#N". Tout le monde tire en même temps, donc pas
  // d'offset ; les lignes sont dans l'ORDRE D'ARRIVÉE, capitaine en dernier.
  function planToVariant(plan, rank) {
    return {
      label: (rank === 0 ? (picker.fastest ? "Fastest" : "Best") : "#" + (rank + 1)) +
        " · variant " + plan.variant,
      side: "",
      spread: plan.spread + " seconds",
      firstLaunch: "",
      raw: "",
      participants: plan.rows.map(function (r) {
        return {
          id: r.id, name: r.name, type: r.type, qty: r.qty,
          march: r.march, offset: "", impact: landsLabel(r.landsSec),
          side: "", formation: r.formation,
        };
      }),
    };
  }

  // Enregistre une nuke depuis une liste de variantes déjà construites, puis
  // ouvre sa fiche. `label` = texte de repli du bouton en cas d'erreur.
  // Renvoie false si on a refusé de créer (nom du joueur ciblé manquant).
  function saveNukeVariants(variants, btn, label) {
    var p = picker.parsed;
    var owner = (picker.targetPlayer || "").trim();
    // On ne crée PAS une nuke anonyme : sans le nom du défenseur, elle est
    // introuvable à la recherche et le bot affiche une cible sans propriétaire.
    if (!owner) {
      picker.playerError = true;
      renderBest();
      var input = document.getElementById("vp-owner-in");
      if (input) { input.focus(); input.scrollIntoView({ block: "center" }); }
      return false;
    }
    var nuke = {
      target: p.target || "",
      targetPlayer: owner,
      categoryId: null,
      priority: false,
      targetImage: null,
      variants: variants,
    };
    btn.disabled = true;
    btn.textContent = "Creating…";
    Store.saveNuke(nuke).then(function (saved) {
      route("nuke", saved.id);
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      showErr(e);
    });
  }

  // Transforme le plan retenu en vraie nuke (1 seule variante), puis ouvre sa fiche.
  function createNukeFromPlan(plan, btn) {
    saveNukeVariants([planToVariant(plan, 0)], btn, "Only this plan");
  }

  // Garde EN STOCK toutes les possibilités trouvées : une seule nuke dont les
  // variantes sont tous les plans classés (le meilleur en variante 1). C'est ce
  // stock que le bot Discord fait défiler (◀ / Suivant) sur /id_* et /launch_*.
  function createNukeFromAllPlans(plans, btn) {
    saveNukeVariants(plans.map(planToVariant), btn,
      "Create nuke with all " + plans.length + " plans");
  }

  function renderBest() {
    el.view.innerHTML =
      '<div class="page-head"><h2>' + ic("crosshair") + " Best nuke</h2></div>" +
      '<p class="muted intro">Paste the bot\'s variants file: the site tests every ' +
        "combination of players inside each variant and keeps only the valid plans — " +
        "<b>no player twice</b>, and <b>a captain landing last</b>. Everyone fires at " +
        "the same moment, so the <b>Time</b> column alone decides the order of impacts.<br>" +
        "Leave the players untouched to simply get the biggest plan. Click the ones who " +
        "are <b>online</b> to require them, click again to <b>rule someone out</b>.<br>" +
        "Tick <b>Fastest nukes first</b> to rank the same plans by how soon they land " +
        "(fire → last impact) instead of by size.<br>" +
        "The file doesn't say <b>who owns the target</b> — you'll be asked for that name " +
        "before the nuke is created. A new nuke starts <b>unsorted</b>: open it and pick a " +
        "carousel (Netherland…) to file it, or find it under " +
        "<b>Unsorted</b> here and in the Discord menu.</p>" +
      pickerImportHtml() +
      (picker.parsed
        ? pickerPlayersHtml() + pickerFiltersHtml() + pickerResultsHtml()
        : "");

    bindPickerImport(renderBest);
    bindPickerPlayers(renderBest);
    bindPickerFilters(renderBest);
    bindPickerResults(renderBest);
    refreshIcons();
  }

  // Pastilles joueurs à TROIS états, parcourus par clics successifs :
  //   neutre  → requis (le plan doit le contenir)
  //           → exclu (le plan ne doit pas le contenir)
  //           → neutre…
  function pickerPlayersHtml() {
    var names = VariantPicker.playerList(picker.parsed);
    var chips = names.map(function (n) {
      var state = picker.include.indexOf(n) !== -1 ? " req"
                : picker.exclude.indexOf(n) !== -1 ? " ban" : "";
      return '<button class="pchip' + state + '" data-player="' + esc(n) + '">' +
        esc(n) + '<span class="pchip-n">' + picker.parsed.players[n] + "</span></button>";
    }).join("");

    var touched = picker.include.length + picker.exclude.length;
    return '<div class="vp-players">' +
        '<div class="vp-players-head"><span>Players</span>' +
          '<span class="vp-legend"><i class="dot req"></i>required' +
            '<i class="dot ban"></i>excluded<em>click a player to cycle</em></span>' +
          (picker.include.length
            ? '<label class="vp-only"><input type="checkbox" id="vp-onlyck"' +
              (picker.only ? " checked" : "") + "> Use only the required ones</label>"
            : "") +
          (touched ? '<button class="btn ghost small" id="vp-clear">Clear</button>' : "") +
        "</div>" +
        '<div class="pchips">' + chips + "</div>" +
      "</div>";
  }

  function bindPickerPlayers(rerenderFn) {
    el.view.querySelectorAll("[data-player]").forEach(function (b) {
      b.onclick = function () {
        var n = b.dataset.player;
        var i = picker.include.indexOf(n);
        var j = picker.exclude.indexOf(n);
        if (i !== -1) {                       // requis -> exclu
          picker.include.splice(i, 1);
          picker.exclude.push(n);
        } else if (j !== -1) {                // exclu -> neutre
          picker.exclude.splice(j, 1);
        } else {                              // neutre -> requis
          picker.include.push(n);
        }
        picker.open = null;
        rerenderFn();
      };
    });

    var only = document.getElementById("vp-onlyck");
    if (only) only.onchange = function () {
      picker.only = only.checked;
      picker.open = null;
      rerenderFn();
    };

    var clear = document.getElementById("vp-clear");
    if (clear) clear.onclick = function () {
      picker.include = [];
      picker.exclude = [];
      picker.open = null;
      rerenderFn();
    };
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

  // Créer un encart depuis le menu
  var addCatBtn = document.getElementById("sidebar-add-cat");
  if (addCatBtn) addCatBtn.onclick = createCategoryFlow;

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
