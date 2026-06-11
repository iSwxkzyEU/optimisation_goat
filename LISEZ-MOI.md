# ⚔️ Guild War Planner

Site de coordination d'attaques pour la guilde. Données **partagées** entre tous
les joueurs (via Supabase), hébergé sur **Vercel**.

## Accès
- Site en ligne : **https://optimisation-goat.vercel.app**
- Mot de passe d'entrée : **`guerre2026`**
  (modifiable dans `js/app.js`, ligne `var PASSWORD = ...`).

## Ce que ça fait
- **Nukes** : « + Ajouter une Nuke », colle le pavé Discord
  (TARGET / SIDE / SPREAD + lignes de joueurs) **ou directement le tableau
  ASCII du bot** (`| 94011[fredite] | army | x5 | 6m11s |`, avec ou sans
  colonnes Form / Mod). Target et côté se choisissent à la main dans le
  formulaire quand le bloc ne les contient pas. « Aperçu » pour vérifier le
  parsing, screenshot du château cible, puis *Enregistrer*.
- Chaque nuke devient une **card** → clic → tableau complet des joueurs,
  screenshot cible, et **fichiers de formation du bon côté** (chargés auto).
- On peut **ajouter / retirer / éditer des lignes de joueurs** à la main
  (crayon en bout de ligne : type, formation, offset…).
- **Optimize times** : optimise les temps d'impact directement dans le site
  (spread minimal ≤ 8s, décalages bornés à ±6s, CAP en dernier ~2s après la
  dernière armée, pas de doublons si possible, ordre conservé). Aperçu du
  résultat, **Apply** pour l'enregistrer dans la nuke, **Copy for Discord**
  pour coller le tableau optimisé dans Discord.
- **Success / Fail** : après le tir, clique le résultat. *Success* archive la
  nuke dans l'historique et la retire de la liste ; *Fail* l'archive mais la
  nuke reste. La page **History** affiche le taux de réussite de la guilde.
- **Formations** : dépose les fichiers `.cas` par côté (RIGHT / LEFT / FRONT /
  BACK) **et par type** (50 / 90 / 110 / Barrack). Chaque joueur récupère
  automatiquement le fichier de son côté + son type.

## Architecture
```
index.html        page principale
css/styles.css    design
js/parser.js      transforme le pavé Discord / tableau du bot en données
js/optimizer.js   optimisation des temps d'impact (spread, CAP final…)
js/store.js       stockage partagé (Supabase : base + fichiers)
js/app.js         interface + navigation
supabase-setup.sql  script de création des tables/buckets Supabase
```

## Mettre à jour le site
Le dépôt GitHub est connecté à Vercel : à chaque `git push` sur `main`,
Vercel redéploie automatiquement.

> ⚠ **Après l'ajout de l'historique (Success / Fail)** : relancer une fois le
> script `supabase-setup.sql` dans Supabase → SQL Editor (il est réexécutable
> sans risque) pour créer la table `nuke_history`. Tant que ce n'est pas fait,
> le site fonctionne mais la page History explique quoi faire.
