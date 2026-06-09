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

-- ---------- Sécurité (RLS) ----------
-- Le site est protégé par un mot de passe commun (pas de comptes individuels),
-- donc on autorise la clé publique "anon" à tout lire/écrire.
alter table public.nukes      enable row level security;
alter table public.formations enable row level security;
alter table public.categories enable row level security;

drop policy if exists "anon all nukes"      on public.nukes;
drop policy if exists "anon all formations" on public.formations;
drop policy if exists "anon all categories" on public.categories;

create policy "anon all nukes"      on public.nukes      for all using (true) with check (true);
create policy "anon all formations" on public.formations for all using (true) with check (true);
create policy "anon all categories" on public.categories for all using (true) with check (true);

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
