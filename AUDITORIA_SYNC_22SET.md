# Auditoria — por que o sync falhava e o que o "modelo Planilha" corrige

Pedido do Gregory (áudio, 22/09/2026): "pesquisa como o Google Planilhas e o
Excel deixam várias pessoas mexerem ao mesmo tempo, até em versões diferentes,
e funciona — quero o nosso sistema parecido. Faz auditoria pra ver o que está
fazendo o sistema falhar e aplica esse novo sistema."

**Importante — não invento conclusão que o código não sustenta**: esta
auditoria é sobre o `index.html` **como ele está agora**, nesta sessão de
22/09/2026, depois de 3 rodadas de fixes já aplicadas hoje mais cedo (commits
`a274309`, `a7f7cd3`, `953a6f3`, `256e6d3`). Boa parte do que o pedido do
Gregory descreve como "o novo sistema" **já estava implementada** antes desta
sessão começar — o trabalho de hoje fechou uma lacuna concreta que sobrou
(seção 5) e não uma reescrita do zero.

## Os 5 princípios do Sheets/Excel, contra o código atual

### 1. Operações, não estado — ✅ já implementado
`_peGravaDelta` (index.html, ~linha 6060) + `PECore.montarGravacao`/
`deltaCampo` (pe-core.js) nunca gravam o mapa `estoque`/`produzindo`/`meta`
inteiro. `deltaCampo` compara `payload` contra a `base` que a sessão
realmente viu e só inclui no objeto final as chaves que mudaram — o
`.set(ref, delta, {merge:true})` do Firestore só toca essas chaves. Uma aba
com estado local cheio de zeros nunca consegue "zerar o resto" porque o
resto nem entra no payload.

### 2. Servidor como fonte da verdade / histórico canônico — ✅ já implementado
Toda mutação de `estoque`/`produzindo`/`lotesProducao` passa por
`peDiffMapas(antes,depois)` antes de gravar e gera uma entrada em
`historico` via `arrayUnion` — endurecido no commit `a274309` (fechou 6
caminhos que gravavam sem logar: `peConfirmarProduzir`, `peLotePronto`,
`_peReceberAplicar`, `peExcluirLote`, `peSalvarLote`,
`peAplicarLotesProntos`) e no `256e6d3` (fechou os últimos 3: salvar layout
de etiqueta `_salvaLayoutAlvo`, publicar portal `pePublicar`, write-back da
migração do doc legado em `peCarregarEstoques`). Grep nesta sessão (ver
"Verificação" abaixo) não achou nenhum `.set()` em `ls_pe` fora do funil.

### 3. Granularidade de célula / conflito por chave — ✅ já implementado
`montarGravacao` já dá "duas abas editando chaves diferentes nunca
conflitam" (teste existente: `tests/test_pe.mjs`, "duas abas editando chaves
diferentes: as duas sobrevivem") e "mesma chave, último grava vence, e cada
gravação deixa seu próprio rastro no historico" (teste novo desta sessão:
"mesma chave editada por duas abas..."). A transação do Firestore
(`_db.runTransaction`, lê o doc atual antes de decidir o delta) evita que
duas escritas simultâneas colidam sem que uma veja a outra.

### 4. localStorage rebaixado a cache de exibição — ✅ já verdadeiro para o
módulo pe (auditado nesta sessão, não precisou de mudança)
`estoque`/`produzindo`/`ordens`/`lotesProducao` **nunca são persistidos em
`localStorage`** — vivem só em memória (`_peEstoqueCache[fid]`), alimentados
exclusivamente por `onSnapshot`/`.get()` do Firestore (index.html, ~linha
5802 e 5815). Não existe "boot a partir do cache local" pra esses campos,
então não existe "local vence por ts" pra eles. Os únicos usos de
`localStorage` ligados ao módulo pe são: tokens/acesso (`loretto_pe_tokens`,
`loretto_pe_acesso`), config de etiqueta/fornecedor (`loretto_pe_etq`,
`loretto_pe_forn_modelos`) e perfil de quem está logado na fábrica
(`loretto_fab_perfil_<fid>`, só UI de "quem é você"). Os três primeiros já
foram corrigidos no commit `a7f7cd3` (merge que sempre prefere o servidor —
`PECore.mergePreferindoServidor`, `PECore.deveGravarNaInicializacao`) e são
só gravados de volta no Firestore por AÇÃO explícita do usuário
(`peSalvarAcesso`, `peSalvarEtqConfig`, `peToken`), nunca automaticamente no
boot. Confirmado via grep nesta sessão — nenhuma chave de `localStorage`
guarda um mapa de estoque/produzindo.

### 5. Idempotência (opId, fila, rebase) — ⚠️ era a lacuna real, fechada hoje
Este era o único dos 5 princípios genuinamente ausente. Antes desta sessão,
se `_peGravaDelta` falhasse (offline, erro de rede), a operação se perdia:
sem fila, sem retry — e pior, `peFabSalvar` (autosave da grade da fábrica,
index.html ~linha 5361) **limpava o marcador `data-dirty` do campo ANTES de
saber se a gravação tinha dado certo** (o `i.removeAttribute('data-dirty')`
rodava síncrono, dentro do mesmo `forEach` que montava o payload, antes do
`_peGravaDelta(...)` assíncrono sequer ser chamado).

Isso é o bug concreto mais provável para o padrão "número volta pro valor
antigo sozinho" (cenário Ana Flora/Manutt citado no pedido): o guard
`devePularRenderFabrica` — que já existe desde uma sessão anterior e
protege a tela contra redesenhar em cima de um campo sujo/focado — parava de
proteger aquele campo assim que ele era marcado como "limpo", mesmo que o
valor digitado nunca tivesse chegado no servidor. Um `onSnapshot` chegando
nesse intervalo (qualquer outra mudança no mesmo doc, de outra pessoa)
redesenhava a grade com o valor antigo do servidor por cima do que tinha
acabado de ser digitado — sem nenhum erro visível, porque o toast de "NÃO
SALVOU" já tinha rodado, mas o campo não estava mais marcado como pendente
pra proteção nenhuma.

**Não afirmo que foi ESTE bug especificamente que causou os zeramentos
documentados no historico dos incidentes anteriores** (esses já foram
atribuídos, com evidência, aos caminhos de escrita fechados nos commits
`a274309`/`256e6d3`) — mas é uma lacuna real e independente que ficava
exposta sempre que a rede falhasse durante uma digitação, e bate com a
descrição verbal do padrão "o número volta sozinho".

## O que foi corrigido nesta sessão (22/09/2026, tarde)

1. **`peFabSalvar` só limpa `data-dirty` no `.then()` de sucesso.** Se a
   gravação falhar, o campo continua "sujo" e protegido pelo guard de
   render existente (`devePularRenderFabrica`). index.html, função
   `peFabSalvar`.
2. **Fila de operações pendentes dentro de `_peGravaDelta`** (o funil único
   já existente, sem mudar nenhum call site). Toda chamada grava
   `{opId, path, base, payload, ts}` em `localStorage['loretto_pe_fila']`
   ANTES de tentar a rede, e só remove quando o servidor confirma
   (`.then`) ou quando o erro é "versão antiga" (nunca vai passar, não
   adianta reter). `_peFilaRebase()` reenvia o que ficou pendente quando a
   aba volta a ficar `online`. A fila guarda só **operações**, nunca o
   estado — consistente com a regra do Gregory ("localStorage só como fila
   de ops, jamais como estado"). Idempotência não precisou de comparação
   por opId no servidor porque o payload já é sempre "valor final por
   chave" (deltaCampo faz SET, não soma) — reenviar a mesma operação dá o
   mesmo resultado, não duplica. Provado em `tests/test_pe.mjs`.

## Verificação: nenhum caminho de escrita em `ls_pe` fora do funil

```
grep -n "_db\.collection('ls_pe')\.doc(.*)\.set(" index.html
```
Não retorna nenhum resultado nesta sessão (todos os `.set(` em `ls_pe`
passam por `_peGravaDelta`, inclusive os 3 fechados no commit `256e6d3` mais
cedo hoje).

## O que fica documentado como fase 2 (não construído, por escopo)

- **Fila cobre só a coleção `ls_pe`** (a única que `_peGravaDelta` grava).
  `ls_pe_tokens`/`ls_rep_fotos`/`ls_rep_cfg` continuam com `.set()` direto
  (têm proteção própria — `mergePreferindoServidor`,
  `deveGravarNaInicializacao` — mas não passam pela mesma fila/retry). Se
  aparecer um caso real de perda por causa disso, dá pra estender o mesmo
  padrão pra lá.
- **Sem cap dinâmico/backoff na fila** — cap fixo de 200 operações
  (`_peFilaGravar`, descarta as mais velhas). Não houve indício de fila
  crescendo sem ser drenada; se acontecer, é hora de investigar por que o
  rebase não está rodando, não de aumentar o cap.
- **Firestore Security Rules** (bloqueio do lado do servidor pra alguém que
  chame o SDK direto do console, ignorando `_peGravaDelta`) — já registrado
  em `PENDENCIAS_GREGORY.md`, continua fora do escopo deste ambiente.
