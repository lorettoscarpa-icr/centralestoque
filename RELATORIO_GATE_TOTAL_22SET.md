# Gate total de versão — 22/09/2026

Ordem do Gregory: "Se alguém tentar usar uma versão antiga, aparece botão que
pede para atualizar e se não atualizar NÃO FUNCIONA." Motivação: a Manutt teve
o `produzindo` zerado DE NOVO no dia 22/09 (79 chaves / 356 pares perdidos,
restaurados manualmente pela Lia), **sem nenhuma entrada no historico** — sinal
de que existia um caminho de escrita que não passava pelo gate de versão já
existente (commit `953a6f3`, que só bloqueava dentro de `_peGravaDelta`).

## O que já existia (antes de hoje)

- `PECore.versaoBloqueiaEscrita(appVerMin, versaoLocal)` (pe-core.js): compara
  o `appVerMin` gravado no doc `ls_pe/{fabrica}` com o `app-ver` local da aba.
- `_peGravaDelta` (index.html): checava esse gate só na hora de escrever —
  uma aba velha continuava livre pra navegar, ver dados, digitar.
- Banner "Tem versão nova do sistema" (não bloqueante, precisa clique).

## Auditoria: caminhos de escrita em `ls_pe` que NÃO passavam pelo gate

Busquei todo `_db.collection('ls_pe')...set(` no index.html. Achei 3 pontos
gravando direto, fora de `_peGravaDelta`:

1. **`_salvaLayoutAlvo`** (index.html, salvar layout de etiqueta) — só grava
   `etqLayout`, sem risco de zerar estoque/produzindo, mas bypassava o gate.
2. **`pePublicar`** (publicar portal da fábrica: `fabrica`, `modelos`,
   `publicadoEm`) — mesma situação, sem risco de zerar dados de produção, mas
   bypassava o gate.
3. **Write-back da migração do doc legado** (dentro de `peCarregarEstoques`,
   acionado automaticamente no boot quando o doc principal está vazio e o doc
   legado tem dados — `PECore.mergeLegado` / `deveGravarLegado`) — **este é o
   suspeito mais forte para o zeramento de hoje**: grava `estoque`,
   `produzindo`, `meta` e `ordens` inteiros, sem transação, sem gate de
   versão, e sem log no historico. É exatamente o padrão "sem rastro" que a
   Lia viu na Manutt.

  **Importante — não inventei conclusão**: não consegui confirmar no código
  que foi ESSE caminho especificamente que rodou hoje na Manutt (o gate
  `deveGravarLegado` só dispara quando o doc principal está vazio, e o doc da
  Manutt não deveria estar vazio agora). Pode ter sido esse caminho disparando
  numa janela de corrida, ou pode existir mais alguma versão de aba antiga
  rodando um `.set()` direto que já não está mais no código atual (código já
  foi reescrito/corrigido várias vezes nesta semana). O que dá pra afirmar com
  certeza: os 3 pontos acima bypassavam o gate e agora não bypassam mais.

Todos os 3 foram fechados hoje: passam a chamar `_peGravaDelta` (pontos 1 e 2)
ou `_peGravaDelta` com diff registrado no historico (ponto 3, igual ao padrão
já usado nos lotes de produção automáticos).

## O que foi feito hoje

### 1. `pe-core.js` — `PECore.deveMostrarGateTotal(appVerMin, versaoLocal, leituraOk)`
Reaproveita `versaoBloqueiaEscrita` pra decidir se a tela deve travar.
Diferença: só bloqueia quando `leituraOk` é `true` — se a leitura do
`appVerMin` no Firestore falhar (offline, sem permissão, erro de rede), a
função devolve `false` e o app degrada pro gate de escrita de sempre, **nunca
trava sozinho por falta de conexão**. Testado em `tests/test_pe.mjs` (3 casos
novos, 36 testes no total, todos passando).

### 2. Overlay bloqueante (index.html, dentro do IIFE "AVISO DE VERSÃO NOVA")
- Lê `appVerMin` do doc **global** `ls_pe_config/loja` (não de cada doc de
  fábrica — ver decisão abaixo).
- Checa no boot (3s depois de carregar), a cada 60s, e quando a aba volta ao
  foco (`visibilitychange`).
- Se `PECore.deveMostrarGateTotal` disser que precisa travar: cria
  `#lsGateTotal`, `position:fixed;inset:0`, `z-index:999999` (acima do
  banner de aviso, que usa `99999`), sem botão de fechar, com
  "Versão desatualizada — clique em ATUALIZAR para continuar" + botão
  ATUALIZAR. `document.documentElement.style.overflow='hidden'` bloqueia
  scroll; o overlay cobre 100% da tela então nenhum clique chega no que está
  atrás; um listener de `keydown` prende o foco no botão (Tab não escapa).
- O botão ATUALIZAR reaproveita a função `atualizar()` já existente (limpa
  cache/service worker e recarrega) — não duplica lógica.
- Se a leitura falhar (`.catch`), não faz nada — degrada pro gate de escrita.
- Ponto 4 do pedido (não perder o que a pessoa está digitando): o overlay
  aparece por cima de tudo mas não mexe no DOM de baixo nem dispara nenhum
  reload sozinho — quem decide recarregar é a pessoa, clicando. O que já
  estava salvo no Firestore continua salvo; o que não foi salvo fica só
  visualmente coberto até ela atualizar.

### 3. Decisão: `appVerMin` do overlay vem de `ls_pe_config/loja`, não do doc da fábrica
O gate de ESCRITA (`_peGravaDelta`) continua lendo `appVerMin` do próprio doc
`ls_pe/{fabrica}` que está sendo gravado (não mudei isso). Mas pro overlay de
UI eu precisava de UMA fonte que tanto o painel da Loretto (que carrega várias
fábricas) quanto o painel de cada fábrica (que só enxerga o próprio doc)
conseguissem ler igual, sem ter que decidir "qual fábrica checar" ou tirar o
máximo entre várias. `ls_pe_config/loja` já é um doc compartilhado que os dois
lados leem no boot (`peCarregarEstoques`, usado hoje pra `critPct` e `leao`) —
reaproveitei ele em vez de criar uma coleção nova. Gravei `appVerMin=e14` nos
3 docs de fábrica (pro gate de escrita, que já esperava isso) E em
`ls_pe_config/loja` (pro overlay).

### 4. Fechamento dos 3 caminhos de escrita legados (ver auditoria acima)

### 5. Gravação em produção (`_write_gate_total.py`, script uvx + firebase-admin)
Transação por doc, só tocando `appVerMin` (+ `ArrayUnion` de uma entrada de
historico `"gate de versão total ativado"` nos 3 docs de fábrica — não no
config global, que não tem historico). Nenhum outro campo foi lido ou
regravado. Confirmado por leitura depois da escrita:
```
ls_pe/manutt: appVerMin='e14' historico(len)=65
ls_pe/tarragona: appVerMin='e14' historico(len)=134
ls_pe/tchwm-industria-e-comercio-de-calcados-ltda: appVerMin='e14' historico(len)=569
ls_pe_config/loja: appVerMin='e14'
```

### 6. Bump de versão
`<meta name="app-ver">` `e13` → `e14`.

## Testes
`node tests/test_pe.mjs` — **36 passaram, 0 falharam** (33 já existentes +
3 novos casos de `deveMostrarGateTotal`). Todos os `<script>` inline do
index.html foram parseados com `new Function()` pra garantir que não ficou
erro de sintaxe.

## O que NÃO foi feito / limitações conhecidas
- Não achei (nem inventei) confirmação de que o caminho de migração legada
  foi exatamente o que zerou a Manutt hoje — só que era o único caminho de
  escrita de `estoque`/`produzindo`/`ordens` no arquivo atual que bypassava
  tanto o gate quanto o historico. Está fechado de qualquer forma, porque
  bypassar o gate é o problema que o Gregory pediu pra fechar,
  independentemente de confirmar a causa exata de hoje.
- O overlay não impede 100% teclas de atalho do navegador (ex.: abrir DevTools
  e chamar uma função JS direto no console) — isso é browser, não dá pra
  bloquear de dentro da própria página. O que ele bloqueia é o uso normal
  (clique, toque, navegação) e, com o gate de escrita ainda ativo em paralelo
  (belt-and-suspenders), qualquer escrita em `ls_pe` continua rejeitada pelo
  servidor... exceto que "servidor" aqui é o cliente Firestore SDK rodando no
  navegador, não uma regra de segurança do lado do Firebase — alguém abrindo
  o console e chamando o SDK diretamente ainda poderia, em teoria, escrever
  sem passar pelo `_peGravaDelta`. Isso só se fecha de verdade com Firestore
  **Security Rules** do lado do servidor (fora do escopo deste arquivo —
  ficou registrado em `PENDENCIAS_GREGORY.md`).
