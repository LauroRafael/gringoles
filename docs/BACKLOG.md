# Backlog

> Ideias e evoluções futuras. Itens saem daqui para o desenvolvimento
> quando priorizados. Convenção de status: `TODO` · `DOING` · `DONE`.

## Monitor de acessos — evoluções (memo)

Contexto: o painel admin já conta aberturas do app (tabela `public.visits`),
inclusive de visitantes sem conta. Itens abaixo evoluem esse monitor.

- [ ] **Funil visitante → conta** `TODO`
  - Cruzar `visits.user_id` com `profiles` para medir conversão:
    quantos visitantes viraram full e em quantos dias.
  - Exibir no painel admin: taxa de conversão + tempo médio até o cadastro.

- [ ] **Origem das visitas** `TODO`
  - Agrupar `visits.referrer` por origem (WhatsApp, Google, direto…).
  - Exibir no painel admin: ranking de origens nos últimos 14/30 dias.

## Tempos verbais nas frases de exemplo (follow-up)

Contexto: cards têm presente/passado/futuro (`example*_en/pt`). Cards novos via
IA da Biblioteca já vêm com os 3 tempos; cards antigos podem receber os tempos
pelo botão "Gerar com IA" no modal de edição. Rollback documentado em
[`ROLLBACK-tempos-verbais.md`](./ROLLBACK-tempos-verbais.md).

- [ ] **Tempos no banco curado (lote diário)** `DONE em 02/10/2026`
  - Colunas adicionadas em `word_bank` (migration_004) + geração na Edge `generate-bank-words` (v6)
    + edição no painel admin. Palavras do lote já nascem com os 3 tempos.
  - Backfill 100% em 02/10/2026: `cards` 363/363 com exemplo + `word_bank` 307/307
    (via função temporária `backfill-tenses`, neutralizada após uso).

