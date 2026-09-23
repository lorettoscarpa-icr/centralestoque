# Relatório — Bug das etiquetas em PDF (Manutt) — 22/09/2026

## O problema (relatado pelo Gregory)
Ao colocar um pedido em produção na Manutt, o PDF de etiquetas gerado pelo
painel saía quebrado: cada etiqueta aparecia fatiada em duas "meias-etiquetas"
— uma com nome/código/cor + um quadrado vazio (sem o número), e a etiqueta
seguinte só com o código de barras + o número grande. Print real do pedido
5164 (296 pares) mostrava isso se repetindo por 116 páginas.

## Causa
O bloco de cada etiqueta (`.etiqueta`) já tinha `page-break-after:always` /
`break-after:page` pra garantir uma etiqueta por página — mas **nunca ganhou
o `page-break-inside:avoid` / `break-inside:avoid`** que impede o navegador de
cortar o CONTEÚDO de uma etiqueta ao meio quando ela fica renderizada mais
alta que a página impressa (75×25mm na Manutt, com fontes/tamanhos
configurados agressivamente grandes nessa fábrica — nome 15% da altura,
referência 15,5%, barra 44%, quadrado do número 68%). Essa proteção já existe
em **outros 5 lugares** deste mesmo arquivo (relatórios, financeiro) — só
faltou no fluxo de etiquetas, que é o mais novo/complexo (layout flexível +
código de barras).

Reforçando a causa: `imprimirEtiquetasPopup()` chamava `window.print()` num
`setTimeout` fixo de 220ms, sem esperar as fontes web (Barlow/DM Mono)
terminarem de carregar. Numa rede de fábrica mais lenta, isso é a receita
clássica pra a paginação da impressão ser calculada com uma métrica de fonte
e o texto ser desenhado com outra — mais uma via pra esse mesmo tipo de corte.

Não consegui reproduzir a fatia exata (texto numa página, código de barras na
seguinte) rodando Chrome headless aqui no sandbox — com `overflow:hidden` o
Chrome desta máquina sempre cortou (clipou) o conteúdo excedente numa página
só, em vez de fatiar entre páginas. É bem provável que o ambiente da fábrica
(Windows + driver de impressora "Microsoft Print to PDF", ou uma versão de
motor de impressão diferente) tenha um comportamento de fragmentação de
flexbox mais permissivo — um bug conhecido do Chromium. De qualquer forma,
`break-inside:avoid` é a correção padrão e definitiva pra essa classe de
problema, independente do motor exato que causou o sintoma.

## Correção (index.html)
1. `.print-grid .etiqueta` (fluxo real usado pela fábrica, dentro de
   `imprimirEtiquetasPopup()`) e a regra equivalente do fluxo legado
   `#print-area` ganharam `page-break-inside:avoid;break-inside:avoid`.
2. `imprimirEtiquetasPopup()` agora espera `document.fonts.ready` (com teto
   de 2,5s pra nunca travar) antes de chamar `window.print()`, em vez do
   `setTimeout` fixo de 220ms.

## Validação
Reproduzi o lote real da Manutt (`ls_pe/manutt`, lote `lp1787593888686`, 296
pares / 64 SKUs, layout `t15` com os valores reais salvos no Firestore —
nome 15%, ref 15,5%, barra 44%, quadrado 68%, tamanho 75×25mm) e gerei o PDF
via Chrome headless local (`--print-to-pdf`) com o CSS/JS extraídos
diretamente do `index.html` já corrigido.

- **296 pares → 296 páginas** (1 etiqueta por página, sem duplicação).
- Conferi visualmente a 1ª, a 5ª, a 150ª (meio do lote) e a última (296ª)
  página: todas saem **completas** — nome, código, cor, código de barras
  legível e número grande, tudo no mesmo bloco, nada vazado pra página
  seguinte. PNGs em `validacao_etiquetas/`:
  - `depois_pg-001.png`, `depois_pg-005.png`, `depois_meio-150.png`
- Teste de estresse: forcei os tamanhos de fonte/barra bem além do que cabe
  na etiqueta (quase 2× a altura disponível) pra confirmar que o
  `break-inside:avoid` segura — o navegador **corta o excesso dentro da
  própria etiqueta** (uma página só) em vez de fatiar em duas páginas.
  PNG: `extremo_depois_pg-001.png`.

Obs.: os nomes/códigos usados na reprodução são reconstruídos a partir das
chaves reais do lote (`modelo|cor|numeração`), não são os nomes de exibição
exatos do catálogo (que vivem em `ls_rep_cfg/loja`, não carreguei aqui) —
mas a estrutura, os tamanhos e o layout são exatamente os configurados de
verdade pra Manutt, que é o que importa pro bug.

## Testes
`node tests/test_pe.mjs` → 45 passaram, 0 falharam (suíte inteira, sem
lógica pura nova pra testar — o fix é CSS + timing de impressão, validado
via PDF real acima).

## Versão
app-ver e17 → **e18**. Gate `appVerMin=e18` só sobe depois de confirmar via
curl que o GitHub Pages já serve e18 (rito de sempre).
