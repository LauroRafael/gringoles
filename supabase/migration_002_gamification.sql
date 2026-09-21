-- Gringolês — migração 002 (rodar no SQL Editor após schema.sql)
-- Gamificação por usuário + troca de senha obrigatória + role do admin.

alter table public.profiles
  add column if not exists xp int not null default 0,
  add column if not exists day_streak int not null default 0,
  add column if not exists best_streak int not null default 0,
  add column if not exists last_study_date text not null default '',
  add column if not exists must_change_password boolean not null default false;

-- Promove o admin (login: admin@admin.com) e exige troca da senha inicial.
update public.profiles
set role = 'admin', must_change_password = true
where id = (select id from auth.users where email = 'admin@admin.com');
