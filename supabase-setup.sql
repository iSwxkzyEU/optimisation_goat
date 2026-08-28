-- ============================================================
--  GUILD WAR PLANNER — configuration Supabase
--  À coller dans : Supabase -> SQL Editor -> New query -> Run
--  (réexécutable sans risque)
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.nukes (
  id            uuid primary key default gen_random_uuid(),
  target        text,
  target_player text,
  side          text,
  spread        text,
  participants  jsonb default '[]'::jsonb,
  first_launch  text,
  raw           text,
  target_image  text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Colonnes ajoutées après coup (idempotent, met à jour une table déjà créée)
alter table public.nukes add column if not exists target_player text;

-- "priority" = cibles épinglées en page d'accueil (indépendant de l'encart :
-- une nuke peut être rangée dans une localisation ET marquée prioritaire).
alter table public.nukes add column if not exists priority boolean default false;

-- "variants" = plusieurs PLANS de nuke pour un même village (onglets sur le
-- site, choix 1/2/3 ou "toutes" sur le bot). Chaque variante porte son propre
-- side / participants / spread / raw. Les colonnes side/spread/participants/...
-- au niveau ligne restent en MIROIR de la variante 1 (rétro-compat) ; au
-- chargement, une nuke sans "variants" est lue comme une variante unique
-- construite depuis ces colonnes. Forme d'un élément :
--   { "label","side","spread","participants":[...],"firstLaunch","raw" }
alter table public.nukes add column if not exists variants jsonb default '[]'::jsonb;

create table if not exists public.formations (
  id          uuid primary key default gen_random_uuid(),
  side        text not null,
  type        text not null,
  name        text,
  url         text,
  created_at  timestamptz default now()
);

-- Catégories = "carousels" nommés pour ranger les nukes (par localisation)
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    bigint default 0,
  created_at  timestamptz default now()
);

-- Lien nuke -> catégorie (null = "Uncategorized"). Supprimer une catégorie
-- ne supprime PAS ses nukes : elles repassent en non rangées.
alter table public.nukes add column if not exists category_id uuid
  references public.categories(id) on delete set null;

-- Historique des nukes tirées : trace conservée après un Success / Fail.
-- (Success supprime la nuke de la liste mais laisse cette trace.)
create table if not exists public.nuke_history (
  id            uuid primary key default gen_random_uuid(),
  target        text,
  target_player text,
  side          text,
  result        text not null check (result in ('success', 'fail')),
  players       int default 0,
  fired_at      timestamptz default now()
);

-- armies       = nombre d'armées qu'il a fallu pour réussir (saisi au Success).
-- details      = photo du tableau de l'attaque (joueurs, temps…) pour le détail
--                consultable dans l'historique en cliquant sur une ligne.
-- outside_nuke = la cible a été rasée HORS nuke (le plan n'a pas servi) :
--                ça reste un succès, mais signalé comme tel dans l'historique.
alter table public.nuke_history add column if not exists armies        int;
alter table public.nuke_history add column if not exists details       jsonb;
alter table public.nuke_history add column if not exists outside_nuke  boolean default false;
-- variant_label = quel PLAN (variante) a été tiré, pour le retrouver dans l'historique.
alter table public.nuke_history add column if not exists variant_label text;

-- ---------- /plan : sondage de disponibilité (RETIRÉ) ----------
-- PLUS UTILISÉES. La commande /plan a été retirée du bot (il ne reste que
-- /id_same_time et /link). On garde les deux tables telles quelles : les
-- supprimer effacerait l'historique des sondages déjà passés, et elles ne
-- coûtent rien. À supprimer à la main si tu es sûr de ne plus en vouloir.
--
-- Un "plan" était une opération en préparation : on collait la table d'attaque,
-- le bot en extrayait les joueurs (SHOOTERS) puis postait une grille de créneaux
-- HEURE DU JEU (06:00 -> 00:00). Chaque joueur cochait ses créneaux dispo ;
-- le bot calculait en direct le meilleur créneau commun.
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  target      text,                          -- village ID / nom de la cible
  attack_text text,                          -- table d'attaque collée (COMPO)
  players     jsonb default '[]'::jsonb,      -- [{ "id","name" }] extraits de la table
  slots       jsonb default '[]'::jsonb,      -- ["06:00","07:00",...] (heure du jeu)
  created_by  text,                           -- user id Discord du lanceur
  created_at  timestamptz default now()
);

-- Une ligne par joueur ayant voté (remplace son vote précédent). slots =
-- indices des créneaux où il est dispo (cf. plans.slots).
create table if not exists public.plan_availability (
  plan_id    uuid references public.plans(id) on delete cascade,
  user_id    text not null,
  user_name  text,
  slots      jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (plan_id, user_id)
);

-- ---------- Bouton "⚙️ Setup" du bot : brouillons de tir ----------
-- Un brouillon = une COPIE de travail d'un plan, éditée depuis Discord (side,
-- formations, joueurs retirés/ajoutés) avant de cliquer 📢 Post ou 🚀 Launch.
-- Le plan enregistré dans "nukes" n'est jamais modifié par le bot.
--   mode         = 'syncro' (optimisé) ou 'raw' (same time)
--   label        = nom du plan d'origine ("Plan 2"), vide s'il n'y en a qu'un
--   participants = [{ "id","name","type","qty","march","side","formation",
--                     "formLock" }] ; formLock = formation imposée à la main.
create table if not exists public.nuke_drafts (
  id            uuid primary key default gen_random_uuid(),
  nuke_id       uuid,
  target        text,
  target_player text,
  mode          text,
  side          text,
  label         text,
  participants  jsonb default '[]'::jsonb,
  created_by    text,
  created_at    timestamptz default now()
);

-- ---------- /link : pseudo en jeu <-> compte Discord ----------
-- Le bot associe les joueurs d'un plan à leurs membres Discord par leur pseudo.
-- Quand les deux ne correspondent pas ("Mastersnidel" en jeu, "LeBoss" sur
-- Discord), le joueur fait /link une fois et il est pingué correctement pour
-- toujours. Une ligne par couple (compte Discord, pseudo en jeu) : un joueur
-- avec plusieurs comptes en jeu peut en lier plusieurs.
--   norm = pseudo en jeu réduit à ses lettres/chiffres minuscules (recherche).
create table if not exists public.player_links (
  user_id    text not null,   -- id Discord
  norm       text not null,   -- pseudo en jeu normalisé
  player     text not null,   -- pseudo en jeu tel qu'il a été saisi
  user_name  text,            -- pseudo Discord au moment du lien (info)
  updated_at timestamptz default now(),
  primary key (user_id, norm)
);
create index if not exists player_links_norm_idx on public.player_links (norm);

-- ---------- Sécurité (RLS) ----------
-- Le site est protégé par un mot de passe commun (pas de comptes individuels),
-- donc on autorise la clé publique "anon" à tout lire/écrire.
alter table public.nukes             enable row level security;
alter table public.formations        enable row level security;
alter table public.categories        enable row level security;
alter table public.nuke_history      enable row level security;
alter table public.plans             enable row level security;
alter table public.plan_availability enable row level security;
alter table public.nuke_drafts       enable row level security;
alter table public.player_links      enable row level security;

drop policy if exists "anon all nukes"             on public.nukes;
drop policy if exists "anon all formations"        on public.formations;
drop policy if exists "anon all categories"        on public.categories;
drop policy if exists "anon all nuke_history"      on public.nuke_history;
drop policy if exists "anon all plans"             on public.plans;
drop policy if exists "anon all plan_availability" on public.plan_availability;
drop policy if exists "anon all nuke_drafts"       on public.nuke_drafts;
drop policy if exists "anon all player_links"      on public.player_links;

create policy "anon all nukes"             on public.nukes             for all using (true) with check (true);
create policy "anon all formations"        on public.formations        for all using (true) with check (true);
create policy "anon all categories"        on public.categories        for all using (true) with check (true);
create policy "anon all nuke_history"      on public.nuke_history      for all using (true) with check (true);
create policy "anon all plans"             on public.plans             for all using (true) with check (true);
create policy "anon all plan_availability" on public.plan_availability for all using (true) with check (true);
create policy "anon all nuke_drafts"       on public.nuke_drafts       for all using (true) with check (true);
create policy "anon all player_links"      on public.player_links      for all using (true) with check (true);

-- ---------- Stockage des fichiers (buckets publics) ----------
insert into storage.buckets (id, name, public) values ('targets', 'targets', true)
  on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('formations', 'formations', true)
  on conflict (id) do update set public = true;

drop policy if exists "anon read files"   on storage.objects;
drop policy if exists "anon write files"  on storage.objects;
drop policy if exists "anon update files" on storage.objects;
drop policy if exists "anon delete files" on storage.objects;

create policy "anon read files"   on storage.objects for select using (bucket_id in ('targets','formations'));
create policy "anon write files"  on storage.objects for insert with check (bucket_id in ('targets','formations'));
create policy "anon update files" on storage.objects for update using (bucket_id in ('targets','formations'));
create policy "anon delete files" on storage.objects for delete using (bucket_id in ('targets','formations'));
