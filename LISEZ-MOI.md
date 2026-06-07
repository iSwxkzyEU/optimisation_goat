# ⚔️ Guild War Planner

Site de coordination d'attaques pour la guilde. Données **partagées** entre tous
les joueurs (via Supabase), hébergé sur **Vercel**.

## Accès
- Site en ligne : **https://optimisation-goat.vercel.app**
- Mot de passe d'entrée : **`guerre2026`**
  (modifiable dans `js/app.js`, ligne `var PASSWORD = ...`).

## Ce que ça fait
- **Nukes** : « + Ajouter une Nuke », colle le pavé Discord
  (TARGET / SIDE / SPREAD + lignes de joueurs), « Aperçu » pour vérifier le
  parsing, ajoute le screenshot du château cible, puis *Enregistrer*.
- Chaque nuke devient une **card** → clic → tableau complet des joueurs,
  screenshot cible, et **fichiers de formation du bon côté** (chargés auto).
- On peut **ajouter / retirer des lignes de joueurs** à la main dans une nuke.
- **Formations** : dépose les fichiers `.cas` par côté (RIGHT / LEFT / FRONT /
  BACK) **et par type** (50 / 90 / 110 / Barrack). Chaque joueur récupère
  automatiquement le fichier de son côté + son type.

## Architecture
```
index.html        page principale
css/styles.css    design
js/parser.js      transforme le pavé Discord en données
js/store.js       stockage partagé (Supabase : base + fichiers)
js/app.js         interface + navigation
supabase-setup.sql  script de création des tables/buckets Supabase
```

## Mettre à jour le site
Le dépôt GitHub est connecté à Vercel : à chaque `git push` sur `main`,
Vercel redéploie automatiquement.
