-- KRD Manga Reader v3 — для НОВОГО проекта Supabase.
-- Запускайте весь скрипт в SQL Editor один раз. Повторный запуск безопасен для схемы.
begin;
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'reader' check (role in ('reader','admin')),
  created_at timestamptz not null default now()
);
-- Список доступных ников для формы входа. Никаких паролей здесь нет.
create table if not exists public.login_names (
  username text primary key,
  login_email text not null unique,
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table if not exists public.volumes (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  title text not null,
  subtitle text not null default '',
  description text not null default '',
  contents text not null default '',
  year text not null default '',
  status text not null default 'В процессе',
  genres text[] not null default '{}',
  cover_path text,
  created_at timestamptz not null default now()
);
create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  volume_id uuid not null references public.volumes(id) on delete cascade,
  number integer not null check (number > 0),
  title text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (volume_id,number)
);
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  storage_path text not null,
  byte_size bigint not null default 0,
  unique(chapter_id,page_number)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number integer check (page_number > 0), -- NULL = комментарий к главе
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  page_number integer not null default 1 check (page_number > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id,chapter_id)
);
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  volume_id uuid not null references public.volumes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,volume_id)
);
create table if not exists public.ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  volume_id uuid not null references public.volumes(id) on delete cascade,
  stars smallint not null check(stars between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id,volume_id)
);
create index if not exists chapters_volume_idx on public.chapters (volume_id,number);
create index if not exists pages_chapter_idx on public.pages (chapter_id,page_number);
create index if not exists comments_chapter_idx on public.comments (chapter_id,page_number,created_at);
create index if not exists ratings_volume_idx on public.ratings (volume_id);

-- Только аккаунты, добавленные скриптом в profiles, могут видеть контент.
-- Это защищает библиотеку даже если регистрация через Auth API ошибочно оставлена включённой.
create or replace function public.is_reader() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles p where p.id = (select auth.uid())); $$;
revoke all on function public.is_reader() from public;
grant execute on function public.is_reader() to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin' and lower(p.username) = 'katsuro'); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.login_names enable row level security;
alter table public.volumes enable row level security;
alter table public.chapters enable row level security;
alter table public.pages enable row level security;
alter table public.comments enable row level security;
alter table public.reading_progress enable row level security;
alter table public.favorites enable row level security;
alter table public.ratings enable row level security;

-- Это отдельный новый проект: политики с префиксом krd3 не конфликтуют со старым приложением.
drop policy if exists krd3_profiles_select on public.profiles;
drop policy if exists krd3_login_names_select on public.login_names;
drop policy if exists krd3_volumes_read on public.volumes;
drop policy if exists krd3_volumes_admin on public.volumes;
drop policy if exists krd3_chapters_read on public.chapters;
drop policy if exists krd3_chapters_admin on public.chapters;
drop policy if exists krd3_pages_read on public.pages;
drop policy if exists krd3_pages_admin on public.pages;
drop policy if exists krd3_comments_read on public.comments;
drop policy if exists krd3_comments_insert on public.comments;
drop policy if exists krd3_comments_delete on public.comments;
drop policy if exists krd3_progress_select on public.reading_progress;
drop policy if exists krd3_progress_insert on public.reading_progress;
drop policy if exists krd3_progress_update on public.reading_progress;
drop policy if exists krd3_favorites_select on public.favorites;
drop policy if exists krd3_favorites_insert on public.favorites;
drop policy if exists krd3_favorites_delete on public.favorites;
drop policy if exists krd3_ratings_select on public.ratings;
drop policy if exists krd3_ratings_insert on public.ratings;
drop policy if exists krd3_ratings_update on public.ratings;

create policy krd3_profiles_select on public.profiles for select to authenticated using (public.is_reader());
create policy krd3_login_names_select on public.login_names for select to anon,authenticated using (true);
create policy krd3_volumes_read on public.volumes for select to authenticated using (public.is_reader());
create policy krd3_volumes_admin on public.volumes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy krd3_chapters_read on public.chapters for select to authenticated using (public.is_reader());
create policy krd3_chapters_admin on public.chapters for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy krd3_pages_read on public.pages for select to authenticated using (public.is_reader());
create policy krd3_pages_admin on public.pages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy krd3_comments_read on public.comments for select to authenticated using (public.is_reader());
create policy krd3_comments_insert on public.comments for insert to authenticated with check (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_comments_delete on public.comments for delete to authenticated using (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_progress_select on public.reading_progress for select to authenticated using (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_progress_insert on public.reading_progress for insert to authenticated with check (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_progress_update on public.reading_progress for update to authenticated using (user_id = (select auth.uid()) and public.is_reader()) with check (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_favorites_select on public.favorites for select to authenticated using (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_favorites_insert on public.favorites for insert to authenticated with check (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_favorites_delete on public.favorites for delete to authenticated using (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_ratings_select on public.ratings for select to authenticated using (public.is_reader());
create policy krd3_ratings_insert on public.ratings for insert to authenticated with check (user_id = (select auth.uid()) and public.is_reader());
create policy krd3_ratings_update on public.ratings for update to authenticated using (user_id = (select auth.uid()) and public.is_reader()) with check (user_id = (select auth.uid()) and public.is_reader());

-- SQL GRANT И RLS нужны одновременно.
grant usage on schema public to anon,authenticated;
grant select on public.login_names to anon,authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.volumes,public.chapters,public.pages to authenticated;
grant select,insert,delete on public.comments,public.favorites to authenticated;
grant select,insert,update on public.reading_progress,public.ratings to authenticated;

-- Приватный бакет: прямой публичной ссылки на мангу нет.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('krd-manga','krd-manga',false,52428800,array['image/png','image/jpeg','image/webp','image/avif'])
on conflict (id) do update set public=false,file_size_limit=52428800,
 allowed_mime_types=array['image/png','image/jpeg','image/webp','image/avif'];
drop policy if exists krd3_storage_select on storage.objects;
drop policy if exists krd3_storage_insert on storage.objects;
drop policy if exists krd3_storage_update on storage.objects;
drop policy if exists krd3_storage_delete on storage.objects;
create policy krd3_storage_select on storage.objects for select to authenticated using (bucket_id='krd-manga' and public.is_reader());
create policy krd3_storage_insert on storage.objects for insert to authenticated with check (bucket_id='krd-manga' and public.is_admin());
create policy krd3_storage_update on storage.objects for update to authenticated using (bucket_id='krd-manga' and public.is_admin()) with check (bucket_id='krd-manga' and public.is_admin());
create policy krd3_storage_delete on storage.objects for delete to authenticated using (bucket_id='krd-manga' and public.is_admin());
commit;
