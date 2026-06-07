/* ============================================================
   STORE — couche de stockage.
   VERSION LOCALE : tout est gardé dans le navigateur (localStorage).
   ⚠️ C'est volontaire : ça permet de voir le site fonctionner SANS
   aucun compte ni serveur. Les données ne sont visibles que sur CE
   PC / CE navigateur.
   Quand on passera en ligne, on remplacera SEULEMENT le contenu de
   ce fichier par des appels Supabase — le reste de l'app n'y verra
   que du feu (même API : getNukes, saveNuke, deleteNuke, etc.).
   ============================================================ */

(function () {
  "use strict";

  var KEY = "gwp_data_v1";

  // Côtés d'attaque et types de formation (2 niveaux : côté × type)
  var SIDES = ["RIGHT", "LEFT", "FRONT", "BACK"];
  var FORM_TYPES = ["50", "90", "110", "Barrack"];

  function load() {
    var data;
    try {
      data = JSON.parse(localStorage.getItem(KEY)) || empty();
    } catch (e) {
      data = empty();
    }
    return normalize(data);
  }

  function emptySide() {
    var s = {};
    FORM_TYPES.forEach(function (t) { s[t] = []; });
    return s;
  }

  function empty() {
    var f = {};
    SIDES.forEach(function (side) { f[side] = emptySide(); });
    return { nukes: [], formations: f };
  }

  // Garantit la structure côté × type (et migre l'ancien format à plat)
  function normalize(data) {
    if (!data.nukes) data.nukes = [];
    if (!data.formations) data.formations = {};
    SIDES.forEach(function (side) {
      var cur = data.formations[side];
      if (!cur || Array.isArray(cur)) {
        // ancien format (tableau à plat) ou absent -> on (re)crée la structure
        data.formations[side] = emptySide();
      } else {
        FORM_TYPES.forEach(function (t) {
          if (!Array.isArray(cur[t])) cur[t] = [];
        });
      }
    });
    return data;
  }

  function persist(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // --- Nukes ------------------------------------------------------------

  function getNukes() {
    return load().nukes.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function getNuke(id) {
    return load().nukes.find(function (n) { return n.id === id; }) || null;
  }

  function saveNuke(nuke) {
    var data = load();
    if (nuke.id) {
      var i = data.nukes.findIndex(function (n) { return n.id === nuke.id; });
      if (i !== -1) {
        nuke.updatedAt = Date.now();
        data.nukes[i] = nuke;
      }
    } else {
      nuke.id = uid();
      nuke.createdAt = Date.now();
      nuke.updatedAt = Date.now();
      data.nukes.push(nuke);
    }
    persist(data);
    return nuke;
  }

  function deleteNuke(id) {
    var data = load();
    data.nukes = data.nukes.filter(function (n) { return n.id !== id; });
    persist(data);
  }

  // --- Formations (bibliothèque par côté) -------------------------------

  // getFormations()            -> tout l'objet { RIGHT: {50:[],...}, ... }
  // getFormations(side)        -> { 50:[], 90:[], 110:[], Barrack:[] }
  // getFormations(side, type)  -> tableau de fichiers
  function getFormations(side, type) {
    var f = load().formations;
    if (!side) return f;
    var s = f[side] || emptySide();
    if (!type) return s;
    return s[type] || [];
  }

  function addFormationFile(side, type, file) {
    // file = { name, dataUrl }
    var data = load();
    if (!data.formations[side]) data.formations[side] = emptySide();
    if (!data.formations[side][type]) data.formations[side][type] = [];
    file.id = uid();
    data.formations[side][type].push(file);
    persist(data);
  }

  function deleteFormationFile(side, type, fileId) {
    var data = load();
    if (!data.formations[side] || !data.formations[side][type]) return;
    data.formations[side][type] = data.formations[side][type].filter(function (f) {
      return f.id !== fileId;
    });
    persist(data);
  }

  window.Store = {
    SIDES: SIDES,
    FORM_TYPES: FORM_TYPES,
    getNukes: getNukes,
    getNuke: getNuke,
    saveNuke: saveNuke,
    deleteNuke: deleteNuke,
    getFormations: getFormations,
    addFormationFile: addFormationFile,
    deleteFormationFile: deleteFormationFile,
  };
})();
