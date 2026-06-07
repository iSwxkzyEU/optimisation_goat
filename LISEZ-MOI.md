# ⚔️ Guild War Planner — version locale

Site de coordination d'attaques pour la guilde. **Aucune installation.**

## Ouvrir le site
- Double-clique sur **`Ouvrir le site.bat`** (ou sur `index.html`).
- Mot de passe d'entrée : **`guerre2026`**
  (modifiable dans `js/app.js`, ligne `var PASSWORD = ...`).

## Ce que ça fait
- **Nukes** : clique sur *« + Ajouter une Nuke »*, colle ton pavé Discord
  (TARGET / SIDE / SPREAD + les lignes de joueurs), clique *« Aperçu »* pour
  vérifier le parsing, ajoute le screenshot du château cible, puis *Enregistrer*.
- Chaque nuke devient une **card**. Au clic → tableau complet des joueurs +
  screenshot cible + **fichiers de formation du bon côté** (chargés auto).
- **Formations** : dépose tes fichiers `.cas` (ou images) par côté
  (RIGHT / LEFT / FRONT / BACK). Ils s'affichent ensuite sur toutes les
  nukes du même côté.

## ⚠️ Important — version locale
- Les données sont stockées **dans ton navigateur, sur ce PC uniquement**.
  Les autres joueurs ne les voient pas encore.
- C'est normal : c'est la maquette pour valider le fonctionnement et la
  direction. La **version partagée en ligne** (Supabase + hébergement gratuit)
  viendra ensuite — il suffira de remplacer le fichier `js/store.js`.

## Structure
```
index.html        page principale
css/styles.css    design
js/parser.js      transforme le pavé Discord en données
js/store.js       stockage (local pour l'instant -> Supabase plus tard)
js/app.js         interface + navigation
```
