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
      outsideNuke: !!r.outside_nuke,
      variantLabel: r.variant_label || "",
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

  /* --- Variantes (plans multiples par village) ----------------------- */
  // Une variante = un PLAN de nuke : son propre side/participants/spread/raw.
  // Forme normalisée (camelCase) utilisée partout côté front.
  function normVariant(v) {
    v = v || {};
    return {
      label: v.label || "",
      side: v.side || "",
      spread: v.spread || "",
      participants: v.participants || [],
      firstLaunch: v.firstLaunch || v.first_launch || "",
      raw: v.raw || "",
    };
  }

  // Liste de variantes d'une ligne : soit la colonne "variants", soit (rétro-
  // compat) une variante unique reconstruite depuis les colonnes de la ligne.
  function variantsFromRow(r) {
    if (Array.isArray(r.variants) && r.variants.length) return r.variants.map(normVariant);
    return [normVariant({
      side: r.side, spread: r.spread, participants: r.participants,
      firstLaunch: r.first_launch, raw: r.raw,
    })];
  }

  /* --- Conversions ligne <-> objet ---------------------------------- */
  function fromRow(r) {
    return {
      id: r.id,
      target: r.target,
      targetPlayer: r.target_player || "",
      categoryId: r.category_id || null,
      priority: !!r.priority,
      variants: variantsFromRow(r),
      targetImage: r.target_image || null,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  }

  function toRow(nuke) {
    var variants = (nuke.variants && nuke.variants.length
      ? nuke.variants : [normVariant({})]).map(normVariant);
    var v0 = variants[0]; // miroir rétro-compat : la variante 1 alimente les colonnes de la ligne
    return {
      target: nuke.target || null,
      target_player: nuke.targetPlayer || null,
      category_id: nuke.categoryId || null,
      priority: !!nuke.priority,
      variants: variants,
      side: v0.side || null,
      spread: v0.spread || null,
      participants: v0.participants || [],
      first_launch: v0.firstLaunch || null,
      raw: v0.raw || null,
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

  // Photo de l'attaque conservée dans l'historique (pour le détail consultable).
  // `variant` = le PLAN effectivement tiré (side/participants/spread figés).
  function historyDetails(nuke, variant) {
    variant = variant || {};
    return {
      spread: variant.spread || "",
      firstLaunch: variant.firstLaunch || "",
      targetImage: nuke.targetImage || null,
      participants: (variant.participants || []).map(function (p) {
        return {
          id: p.id || "", name: p.name || "", type: p.type || "", qty: p.qty || "",
          march: p.march || "", offset: p.offset || "", impact: p.impact || "",
          side: p.side || "", formation: p.formation || "",
        };
      }),
    };
  }

  // Enregistre le résultat d'une nuke tirée ("success" ou "fail").
  // `variant` = le PLAN tiré (sa side / ses participants / son label sont figés).
  // opts = { armies, outsideNuke } :
  //   armies      = nombre d'armées utilisées (null si non pertinent / fail / hors nuke)
  //   outsideNuke = la cible a été rasée hors nuke (le plan n'a pas servi)
  function addHistoryEntry(nuke, variant, result, opts) {
    opts = opts || {};
    variant = variant || (nuke.variants && nuke.variants[0]) || {};
    var row = {
      target: nuke.target || null,
      target_player: nuke.targetPlayer || null,
      side: variant.side || null,
      result: result,
      players: (variant.participants || []).length,
      armies: opts.armies == null ? null : opts.armies,
      outside_nuke: !!opts.outsideNuke,
      variant_label: variant.label || null,
      details: historyDetails(nuke, variant),
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

  /* --- Types de formation (50 / 90 / 110 / Barrack + les tiens) ------
     La colonne "type" de la table formations est libre : ajouter un type
     ne demande AUCUNE migration. Un type n'existe vraiment en base qu'à
     partir de son 1ᵉʳ fichier, donc on garde les slots encore VIDES dans le
     navigateur pour qu'ils survivent à un rechargement de la page. */
  var EXTRA_TYPES_KEY = "gwp.formTypes";

  function loadExtraTypes() {
    try {
      var arr = JSON.parse(window.localStorage.getItem(EXTRA_TYPES_KEY) || "[]");
      return arr && arr.length ? arr : [];
    } catch (e) { return []; }
  }
  function saveExtraTypes(list) {
    try { window.localStorage.setItem(EXTRA_TYPES_KEY, JSON.stringify(list)); } catch (e) { /* mode privé */ }
  }

  // Liste complète, sans doublon, dans un ordre stable : les 4 d'origine,
  // puis ceux trouvés en base, puis les slots vides créés localement.
  function formTypes() {
    var out = [], seen = {};
    function push(t) {
      t = String(t == null ? "" : t).trim();
      var k = t.toLowerCase();
      if (!t || seen[k]) return;
      seen[k] = true;
      out.push(t);
    }
    FORM_TYPES.forEach(push);
    Object.keys(cache.formations).forEach(function (side) {
      Object.keys(cache.formations[side] || {}).forEach(push);
    });
    loadExtraTypes().forEach(push);
    return out;
  }

  // Crée un slot vide. false si le nom est vide ou déjà pris.
  function addFormationType(name) {
    name = String(name || "").trim();
    if (!name) return false;
    var taken = formTypes().some(function (t) {
      return t.toLowerCase() === name.toLowerCase();
    });
    if (taken) return false;
    var extra = loadExtraTypes();
    extra.push(name);
    saveExtraTypes(extra);
    return true;
  }

  // Retire un slot vide créé localement (un type qui a des fichiers reste
  // tant qu'il en reste au moins un).
  function removeFormationType(name) {
    saveExtraTypes(loadExtraTypes().filter(function (t) {
      return String(t).toLowerCase() !== String(name).toLowerCase();
    }));
  }

  // Ce type a-t-il au moins un fichier, tous côtés confondus ?
  function formationTypeHasFiles(type) {
    return Object.keys(cache.formations).some(function (side) {
      return ((cache.formations[side] || {})[type] || []).length > 0;
    });
  }

  // Type d'origine (non supprimable) ?
  function isBuiltinFormType(type) {
    return FORM_TYPES.some(function (t) {
      return t.toLowerCase() === String(type || "").toLowerCase();
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
    formTypes: formTypes,
    addFormationType: addFormationType,
    removeFormationType: removeFormationType,
    formationTypeHasFiles: formationTypeHasFiles,
    isBuiltinFormType: isBuiltinFormType,
    uploadFile: uploadFile,
    addFormationFile: addFormationFile,
    deleteFormationFile: deleteFormationFile,
  };
})();
