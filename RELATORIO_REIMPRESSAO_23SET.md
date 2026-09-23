# Relatório — Reimprimir etiquetas depois da produção já lançada — 23/09/2026

## Pedido do Gregory
"Quero um botão para gerar o PDF de etiquetas dos que estão EM PRODUÇÃO,
mesmo depois que a produção já foi lançada." Hoje as etiquetas só saem na
hora de confirmar o "Produzir" ou pelo botão de um pedido da loja — se a
fábrica fechou a aba ou o PDF saiu bugado, não tinha como gerar de novo.

## O que mudou

### 1. Botão por lote — "imprimir etiquetas"
Todo card de "EM PRODUÇÃO" (fábrica, aba Pronta-entrega → seção **Em
produção**) ganhou um botão **"imprimir etiquetas"** ao lado de "corrigir" e
"excluir". Funciona pro lote **aplicado ou não** — inclusive um lote já
recebido/no estoque há semanas continua reimprimível, exatamente como o
Gregory pediu ("mesmo depois que a produção já foi lançada").

Caminho: `fabImprimirLote(fid, loteId)` → `PECore.gradeDoLotePorId` (acha o
lote pelo id, devolve a grade dele) → `fabAplicarEtqConfig()` +
`peImprimirEtiquetas(grade)` — **o mesmo fluxo já corrigido** que gera as
etiquetas do pedido da loja (`fabImprimirPedido`) e o do "Produzir" — nenhum
caminho novo de geração/renderização de PDF foi criado.

### 2. Botão geral — "Imprimir etiquetas do produzindo atual"
No cabeçalho da seção "Em produção" aparece **"Imprimir etiquetas do
produzindo atual"** quando existe produção digitada direto na grade
(linha "Produzindo" editável célula a célula) que **não passou pelo botão
"Produzir"** e por isso não virou um card de lote — caso já documentado
(ver `[[project-centralestoque-pe-incidents]]`, item 4). O botão some
sozinho quando não há nada assim pra imprimir.

Caminho: `fabImprimirProduzindoAtual(fid)` → `PECore.gradeProduzindoAtual`
(filtra só as chaves do mapa `produzindo` com qtd > 0) →
`fabAplicarEtqConfig()` + `peImprimirEtiquetas(grade)` — mesmo fluxo.

### Posição escolhida
Botão do lote: dentro do próprio card (`.fab-acts`), ao lado das outras
ações do lote — é onde a fábrica já olha pra receber/corrigir/excluir.
Botão geral: no cabeçalho da seção "Em produção" (não em cada lote, porque
não é de um lote específico) — mesmo padrão visual já usado no cabeçalho de
"Pedidos da loja" (botões "Produzir"/"Enviar").

### Visão da Loretto
A visão da Loretto de uma fábrica específica (`peRenderFabrica`) **não**
lista os cards de lotesProducao hoje (só a visão de login da própria
fábrica, `renderModoFabrica`, mostra) — não havia lugar pra duplicar o botão
lá. Registrado, não é uma lacuna nova desta sessão.

## Como usar (fábrica)
1. Aba **Pronta-entrega** → seção **Em produção**.
2. Abra o lote (mesmo já recebido/no estoque) e toque **"imprimir
   etiquetas"** — gera o PDF de novo, igual da primeira vez.
3. Se tiver numeração solta na linha "Produzindo" sem lote, o botão
   **"Imprimir etiquetas do produzindo atual"** aparece no topo da seção.

## Validação
- `PECore.gradeDoLotePorId`/`PECore.gradeProduzindoAtual` são lógica pura
  (sem DOM/Firebase) — 6 testes novos em `tests/test_pe.mjs` (lote
  encontrado, lote **aplicado**, lote inexistente → `null`, cópia
  independente do lote original, filtro de qtd ≤ 0, mapa vazio). Suíte
  inteira: **51 passaram, 0 falharam**.
- Testei o **clique real do botão no DOM**: abri o `index.html` de verdade
  num Chrome controlado (mcp chrome-devtools), injetei o lote real da
  Manutt `lp1787593888686` (296 pares, 64 SKUs, `aplicado:false`, dados
  batidos com `backup_manutt_22set_tarde.json`) em `_peEstoqueCache`,
  chamei `renderModoFabrica('manutt')` e cliquei no botão renderizado —
  gerou as 296 etiquetas sem erro. Repeti pro botão geral com um mapa
  `produzindo` sintético (`{3, 0, -1}`) — só imprimiu o valor > 0 (3), e o
  botão sumiu quando `produzindo` ficou vazio.
- Gerei o **PDF pelo caminho novo** em Chrome headless: capturei o HTML que
  `fabImprimirLote` manda pro popup de impressão (interceptando
  `window.open`) e rodei `google-chrome --headless --print-to-pdf` nele —
  **296 páginas** (1 etiqueta por página, igual ao total de pares do lote).
  Conferi visualmente a 1ª, a 150ª (meio) e a 296ª (última) página — todas
  completas, sem fatiamento (confirma que o fix de `break-inside:avoid` do
  e18 continua valendo no caminho de reimpressão). PNGs em
  `validacao_etiquetas/`: `reimpressao_pg-001.png`, `reimpressao_meio-150.png`,
  `reimpressao_pg-296.png`.
- A renderização em si (`peGradeParaEtiquetas`, `montaEtiqueta`,
  `imprimirEtiquetasPopup`) **não foi alterada** — só o código novo que
  acha a grade certa (lote ou produzindo) e chama esse fluxo já validado.

## Regras seguidas
- Nenhuma escrita em `estoque`/`produzindo`/`ordens`/`lotesProducao` no
  Firebase — os botões só leem `_peEstoqueCache` (já em memória) e imprimem.
- Doc `_ujl3p9sjjv` não tocado.

## Versão
app-ver e18 → **e19**. Gate `appVerMin=e19` só sobe depois de confirmar via
curl que o GitHub Pages já serve e19 (rito de sempre) — script
`_write_gate_e19.py`, roda por último.
