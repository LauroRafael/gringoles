-- Gringolês — migração 003 (rodar no SQL Editor após schema.sql + migration_002)
-- Modelo SRS de 5 caixas: new → check → study → practice → mastered (box 0..4).
--
-- POR QUE: o schema original travava cards.pile em ('new','learning','known').
-- Sem esta migração, todo upsert/insert com as caixas novas é rejeitado pelo
-- Postgres (violates check constraint) e a fila de sincronização nunca esvazia
-- ("Some items are still pending sync" em loop).

-- 1) Solta a trava antiga
alter table public.cards drop constraint if exists cards_pile_check;

-- 2) Converte valores legados para o modelo novo
update public.cards set pile = 'practice' where pile = 'learning';
update public.cards set pile = 'mastered' where pile = 'known';
update public.cards set box = 4 where box > 4;

-- 3) Trava nova (5 caixas)
alter table public.cards
  add constraint cards_pile_check check (pile in ('new', 'check', 'study', 'practice', 'mastered'));
