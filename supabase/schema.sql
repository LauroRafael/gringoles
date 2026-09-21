-- ============================================================
-- Gringolês — schema inicial (rodar no SQL Editor do Supabase)
-- Ordem: este arquivo primeiro, depois seed_bank.sql
-- ============================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- ---------- cards ----------
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  en text not null,
  pt text not null,
  phonetic_br text not null default '',
  ipa text not null default '',
  example_en text not null default '',
  example_pt text not null default '',
  emoji text not null default '📚',
  photo_url text,
  gradient text not null default 'from-violet-500 to-fuchsia-500',
  category text not null default 'Minhas',
  pile text not null default 'new' check (pile in ('new', 'learning', 'known')),
  box int not null default 0 check (box between 0 and 5),
  next_review_at timestamptz not null default now(),
  correct_streak int not null default 0,
  seen_count int not null default 0,
  bank_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists cards_user_next_idx on public.cards (user_id, next_review_at);
create unique index if not exists cards_user_en_unique on public.cards (user_id, lower(en));

-- ---------- study_days ----------
create table if not exists public.study_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  studied int not null default 0,
  known int not null default 0,
  primary key (user_id, date)
);

-- ---------- word_bank (lote diário, leitura pública) ----------
create table if not exists public.word_bank (
  bank_id text primary key,
  en text not null,
  pt text not null,
  phonetic_br text not null default '',
  ipa text not null default '',
  example_en text not null default '',
  example_pt text not null default '',
  emoji text not null default '📚',
  category text not null default 'Banco',
  active boolean not null default true
);

-- ---------- helper is_admin ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------- auto-criar profile no signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.study_days enable row level security;
alter table public.word_bank enable row level security;

-- profiles: cada um lê o próprio; atualiza só display_name (role só via SQL/admin)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- cards: dono total; admin total
drop policy if exists "cards_owner_all" on public.cards;
create policy "cards_owner_all" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cards_admin_all" on public.cards;
create policy "cards_admin_all" on public.cards
  for all using (public.is_admin()) with check (public.is_admin());

-- study_days: dono total; admin leitura
drop policy if exists "days_owner_all" on public.study_days;
create policy "days_owner_all" on public.study_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "days_admin_read" on public.study_days;
create policy "days_admin_read" on public.study_days
  for select using (public.is_admin());

-- word_bank: leitura pública (inclusive anon), escrita só admin
drop policy if exists "bank_read_all" on public.word_bank;
create policy "bank_read_all" on public.word_bank
  for select using (true);

drop policy if exists "bank_admin_write" on public.word_bank;
create policy "bank_admin_write" on public.word_bank
  for insert with check (public.is_admin());

drop policy if exists "bank_admin_update" on public.word_bank;
create policy "bank_admin_update" on public.word_bank
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bank_admin_delete" on public.word_bank;
create policy "bank_admin_delete" on public.word_bank
  for delete using (public.is_admin());

-- ============================================================
-- Storage: bucket card-photos (pastas por user_id)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_owner_write" on storage.objects;
create policy "photos_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'card-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "photos_owner_update" on storage.objects;
create policy "photos_owner_update" on storage.objects
  for update using (
    bucket_id = 'card-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'card-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "photos_public_read" on storage.objects;
create policy "photos_public_read" on storage.objects
  for select using (bucket_id = 'card-photos');

drop policy if exists "photos_owner_delete" on storage.objects;
create policy "photos_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'card-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
