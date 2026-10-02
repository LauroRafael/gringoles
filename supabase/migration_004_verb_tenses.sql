-- Gringolês — migração 004 (tempos verbais nas frases de exemplo)
-- Ideia original: exampleEN/PT passa a ser o PRESENTE simples; passado e futuro
-- simples ficam em 4 colunas novas. Aditivo e reversível: código antigo ignora
-- as colunas; rollback = docs/ROLLBACK-tempos-verbais.md.
--
-- POR QUE IF NOT EXISTS em tudo: as colunas de public.cards já foram aplicadas
-- via SQL avulso (Oct/2026) antes deste arquivo existir; este arquivo apenas
-- versiona o estado + estende o mesmo modelo ao word_bank (lote diário).

-- 1) cards: 4 colunas (idempotente — não quebra se já existirem)
alter table public.cards
  add column if not exists example_past_en text not null default '',
  add column if not exists example_past_pt text not null default '',
  add column if not exists example_future_en text not null default '',
  add column if not exists example_future_pt text not null default '';

-- 2) word_bank: mesmo modelo, para o lote diário já nascer com os 3 tempos
alter table public.word_bank
  add column if not exists example_past_en text not null default '',
  add column if not exists example_past_pt text not null default '',
  add column if not exists example_future_en text not null default '',
  add column if not exists example_future_pt text not null default '';
