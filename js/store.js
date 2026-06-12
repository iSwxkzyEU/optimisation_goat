/* ============================================================
   STORE — couche de stockage PARTAGÉE via Supabase.
   Les données (nukes + formations) et les fichiers (screens, .cas)
   sont stockés sur Supabase → visibles par TOUTE la guilde.

   Astuce d'architecture : on charge tout en mémoire au démarrage
   (Store.init), puis les "getters" lisent ce cache de façon
   synchrone (l'interface n'a presque pas changé). Les écritures,
   elles, partent vers Supabase puis mettent le cache à jour.
   ============================================================ */

(function () {
  "use strict";

  /* --- Configuration Supabase (clé anon = publique, normal) --------- */
  var SUPABASE_URL = "https://hmhpsojjzpncibydbgqi.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtaHBzb2pqenBuY2lieWRiZ3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4Mzk1MzgsImV4cCI6MjA5NjQxNTUzOH0.gesERetirlCoL_O3MTerFFLVq3sDslqsmqnd-NGNgN0";

  var SIDES = ["RIGHT", "LEFT", "FRONT", "BACK"];
  var FORM_TYPES = ["50", "90", "110", "Barrack"];

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Cache mémoire (rempli par init, relu par les getters synchrones)
  var cache = { nukes: [], formations: emptyFormations(), categories: [], history: [] };
  var historyAvailable = true; // false si la table nuke_history n'existe pas encore

  function emptyFormations() {
    var f = {};
    SIDES.forEach(function (s) {
      f[s] = {};
      FORM_TYPES.forEach(function (t) { f[s][t] = []; });
    });
    return f;
  }

  /* --- Chargement initial ------------------------------------------- */
  function init() {
    return Promise.all([loadNukes(), loadFormations(), loadCategories(), loadHistory()]);
  }

  // Tolérant : si la table n'existe pas encore (SQL pas relancé),
  // le reste du site fonctionne et la page History explique quoi faire.
  function loadHistory() {
    return sb.from("nuke_history").select("*").order("fired_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        cache.history = (res.data || []).map(historyFromRow);
        historyAvailable = true;
      })
      .catch(function () {
        cache.history = [];
        historyAvailable = false;
      });
  }

  function historyFromRow(r) {
    return {
      id: r.id,
      target: r.target || "",
      targetPlayer: r.target_player || "",
      side: r.side || "",
      result: r.result,
      players: r.players || 0,
      armies: r.armies == null ? null : r.armies,
      details: r.details || null,
      firedAt: r.fired_at ? new Date(r.fired_at).getTime() : 0,
    };
  }

  function loadCategories() {
    return sb.from("categories").select("*").then(function (res) {
      if (res.error) throw res.error;
      cache.categories = (res.data || []).map(function (r) {
        return { id: r.id, name: r.name, position: r.position || 0 };
      });
    });
  }

  function loadNukes() {
    return sb.from("nukes").select("*").then(function (res) {
      if (res.error) throw res.error;
      cache.nukes = (res.data || []).map(fromRow);
    });
  }

  function loadFormations() {
    return sb.from("formations").select("*").then(function (res) {
      if (res.error) throw res.error;
      var f = emptyFormations();
      (res.data || []).forEach(function (row) {
        if (!f[row.side]) f[row.side] = {};
        if (!f[row.side][row.type]) f[row.side][row.type] = [];
        f[row.side][row.type].push({ id: row.id, name: row.name, url: row.url, dataUrl: row.url });
      });
      cache.formations = f;
    });
  }

  /* --- Conversions ligne <-> objet ---------------------------------- */
  function fromRow(r) {
    return {
      id: r.id,
      target: r.target,
      targetPlayer: r.target_player || "",
      categoryId: r.category_id || null,
      priority: !!r.priority,
      side: r.side,
      spread: r.spread,
      participants: r.participants || [],
      firstLaunch: r.first_launch || "",
      raw: r.raw || "",
      targetImage: r.target_image || null,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  }

  function toRow(nuke) {
    return {
      target: nuke.target || null,
      target_player: nuke.targetPlayer || null,
      category_id: nuke.categoryId || null,
      priority: !!nuke.priority,
      side: nuke.side || null,
      spread: nuke.spread || null,
      participants: nuke.participants || [],
      first_launch: nuke.firstLaunch || null,
      raw: nuke.raw || null,
      target_image: nuke.targetImage || null,
    };
  }

  /* --- Nukes (lecture synchrone depuis le cache) -------------------- */
  function getNukes() {
    return cache.nukes.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function getNuke(id) {
    return cache.nukes.find(function (n) { return n.id === id; }) || null;
  }

  function saveNuke(nuke) {
    var row = toRow(nuke);
    var q;
    if (nuke.id) {
      row.updated_at = new Date().toISOString();
      q = sb.from("nukes").update(row).eq("id", nuke.id).select().single();
    } else {
      q = sb.from("nukes").insert(row).select().single();
    }
    return q.then(function (res) {
      if (res.error) throw res.error;
      var saved = fromRow(res.data);
      var i = cache.nukes.findIndex(function (n) { return n.id === saved.id; });
      if (i !== -1) cache.nukes[i] = saved; else cache.nukes.push(saved);
      return saved;
    });
  }

  function deleteNuke(id) {
    return sb.from("nukes").delete().eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      cache.nukes = cache.nukes.filter(function (n) { return n.id !== id; });
    });
  }

  /* --- Catégories / carousels --------------------------------------- */
  function getCategories() {
    return cache.categories.slice().sort(function (a, b) {
      return (a.position || 0) - (b.position || 0);
    });
  }

  function addCategory(name) {
    var row = { name: name, position: Date.now() };
    return sb.from("categories").insert(row).select().single().then(function (res) {
      if (res.error) throw res.error;
      var cat = { id: res.data.id, name: res.data.name, position: res.data.position || 0 };
      cache.categories.push(cat);
      return cat;
    });
  }

  function renameCategory(id, name) {
    return sb.from("categories").update({ name: name }).eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      var c = cache.categories.find(function (x) { return x.id === id; });
      if (c) c.name = name;
    });
  }

  function deleteCategory(id) {
    return sb.from("categories").delete().eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      cache.categories = cache.categories.filter(function (c) { return c.id !== id; });
      // Les nukes liées repassent en "non rangées" (la base fait ON DELETE SET NULL)
      cache.nukes.forEach(function (n) { if (n.categoryId === id) n.categoryId = null; });
    });
  }

  /* --- Historique Success / Fail ------------------------------------ */
  function getHistory() {
    return cache.history.slice().sort(function (a, b) {
      return (b.firedAt || 0) - (a.firedAt || 0);
    });
  }

  function isHistoryAvailable() { return historyAvailable; }

  // Photo de l'attaque conservée dans l'historique (pour le détail consultable)
  function historyDetails(nuke) {
    return {
      spread: nuke.spread || "",
      firstLaunch: nuke.firstLaunch || "",
      targetImage: nuke.targetImage || null,
      participants: (nuke.participants || []).map(function (p) {
        return {
          id: p.id || "", name: p.name || "", type: p.type || "", qty: p.qty || "",
          march: p.march || "", offset: p.offset || "", impact: p.impact || "",
          side: p.side || "", formation: p.formation || "",
        };
      }),
    };
  }

  // Enregistre le résultat d'une nuke tirée ("success" ou "fail").
  // armies = nombre d'armées utilisées pour réussir (null si non pertinent / fail).
  function addHistoryEntry(nuke, result, armies) {
    var row = {
      target: nuke.target || null,
      target_player: nuke.targetPlayer || null,
      side: nuke.side || null,
      result: result,
      players: (nuke.participants || []).length,
      armies: armies == null ? null : armies,
      details: historyDetails(nuke),
    };
    return sb.from("nuke_history").insert(row).select().single().then(function (res) {
      if (res.error) throw res.error;
      cache.history.unshift(historyFromRow(res.data));
      return cache.history[0];
    });
  }

  function deleteHistoryEntry(id) {
    return sb.from("nuke_history").delete().eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      cache.history = cache.history.filter(function (h) { return h.id !== id; });
    });
  }

  /* --- Formations (lecture synchrone depuis le cache) --------------- */
  function getFormations(side, type) {
    if (!side) return cache.formations;
    var s = cache.formations[side] || {};
    if (!type) return s;
    return s[type] || [];
  }

  // Envoie un fichier dans un bucket de stockage, renvoie son URL publique
  function uploadFile(bucket, file) {
    var dot = file.name ? file.name.lastIndexOf(".") : -1;
    var ext = dot !== -1 ? file.name.slice(dot) : "";
    var path = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8) + ext;
    return sb.storage.from(bucket).upload(path, file).then(function (res) {
      if (res.error) throw res.error;
      return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    });
  }

  // file = { name, url } (le fichier a déjà été envoyé via uploadFile)
  function addFormationFile(side, type, file) {
    return sb.from("formations")
      .insert({ side: side, type: type, name: file.name, url: file.url })
      .select().single().then(function (res) {
        if (res.error) throw res.error;
        var row = res.data;
        if (!cache.formations[side]) cache.formations[side] = {};
        if (!cache.formations[side][type]) cache.formations[side][type] = [];
        cache.formations[side][type].push({ id: row.id, name: row.name, url: row.url, dataUrl: row.url });
      });
  }

  function deleteFormationFile(side, type, fileId) {
    return sb.from("formations").delete().eq("id", fileId).then(function (res) {
      if (res.error) throw res.error;
      if (cache.formations[side] && cache.formations[side][type]) {
        cache.formations[side][type] = cache.formations[side][type].filter(function (f) {
          return f.id !== fileId;
        });
      }
    });
  }

  window.Store = {
    SIDES: SIDES,
    FORM_TYPES: FORM_TYPES,
    init: init,
    getNukes: getNukes,
    getNuke: getNuke,
    saveNuke: saveNuke,
    deleteNuke: deleteNuke,
    getCategories: getCategories,
    addCategory: addCategory,
    renameCategory: renameCategory,
    deleteCategory: deleteCategory,
    getHistory: getHistory,
    isHistoryAvailable: isHistoryAvailable,
    addHistoryEntry: addHistoryEntry,
    deleteHistoryEntry: deleteHistoryEntry,
    getFormations: getFormations,
    uploadFile: uploadFile,
    addFormationFile: addFormationFile,
    deleteFormationFile: deleteFormationFile,
  };
})();
