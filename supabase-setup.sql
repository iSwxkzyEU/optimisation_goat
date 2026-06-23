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

-- ---------- Sécurité (RLS) ----------
-- Le site est protégé par un mot de passe commun (pas de comptes individuels),
-- donc on autorise la clé publique "anon" à tout lire/écrire.
alter table public.nukes        enable row level security;
alter table public.formations   enable row level security;
alter table public.categories   enable row level security;
alter table public.nuke_history enable row level security;

drop policy if exists "anon all nukes"        on public.nukes;
drop policy if exists "anon all formations"   on public.formations;
drop policy if exists "anon all categories"   on public.categories;
drop policy if exists "anon all nuke_history" on public.nuke_history;

create policy "anon all nukes"        on public.nukes        for all using (true) with check (true);
create policy "anon all formations"   on public.formations   for all using (true) with check (true);
create policy "anon all categories"   on public.categories   for all using (true) with check (true);
create policy "anon all nuke_history" on public.nuke_history for all using (true) with check (true);

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
