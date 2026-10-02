# Rollback — Tempos verbais nas frases de exemplo

> Feature aditiva: `exampleEN/PT` passou a ser o **presente**; passado e futuro
> simples ficam em 4 campos novos. Nada quebra se for revertido — os campos
> simplesmente ficam inertes. Siga os passos abaixo para desfazer **só** esta feature.

## O que foi tocado

| Camada | Arquivo | O que mudou |
| --- | --- | --- |
| Banco | `public.cards` | 4 colunas novas: `example_past_en/pt`, `example_future_en/pt` (migration_004) |
| Banco | `public.word_bank` | mesmas 4 colunas (lote diário já nasce com 3 tempos) |
| Edge | `supabase/functions/complete-word/index.ts` | 3 tempos no prompt + modo `tensesFor` (gerar passado/futuro) — deployado (v4) |
| Edge | `supabase/functions/generate-bank-words/index.ts` | prompt + insert com 3 tempos — deployado (v6) |
| Tipos | `src/types.ts` | `examplePastEN/PT?`, `exampleFutureEN/PT?` |
| Cloud | `src/lib/cloud.ts` | mapeamento das colunas + `completeTenses()` + `BankRow`/`bankRowToCard` com tempos |
| UI | `src/components/Library.tsx` | bloco "Tempos verbais" no modal + botão "Gerar com IA" + bulk (20/vez) + badge ⏱ |
| UI | `src/components/StudyDeck.tsx` | abas Presente/Passado/Futuro sempre visíveis (desabilitadas quando vazias) + hint |
| Admin | `src/components/AdminPanel.tsx` | edição dos 4 campos no banco curado |
| Textos | `src/lib/i18n.ts` | chaves `lib_tenses*` / `lib_tense_*` (pt/en) |

## Rollback de código (recomendado)

Reverter os arquivos acima para o estado anterior. Como as colunas do banco são
`not null default ''` e o código antigo as ignora, **não é preciso mexer no banco**
para o app voltar a funcionar como antes.

Comandos (se estiver tudo em um único commit):

```bash
git revert <hash-do-commit>
```

Ou, se as mudanças estiverem misturadas, desfaça manualmente nos arquivos da
tabela acima.

## Rollback do banco (opcional — só se quiser apagar as colunas)

```sql
alter table public.cards
  drop column if exists example_past_en,
  drop column if exists example_past_pt,
  drop column if exists example_future_en,
  drop column if exists example_future_pt;
alter table public.word_bank
  drop column if exists example_past_en,
  drop column if exists example_past_pt,
  drop column if exists example_future_en,
  drop column if exists example_future_pt;
```

## Rollback das Edge Functions

Redeploy das versões anteriores de `complete-word` (v3) e `generate-bank-words`
(v5) — ambas estão versionadas no painel do Supabase. Enquanto não forem
redeployadas, elas apenas devolvem campos extras que o app antigo ignora —
inofensivo.

> Backfill 02/10/2026: usou função temporária `backfill-tenses` (v1–v3, com
> segredo embutido), neutralizada na v4 (retorna 410). Usuários temporários do
> backfill foram apagados. Nada a reverter aqui.
