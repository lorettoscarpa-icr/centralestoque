# Auditoria do painel (index.html + pe-core.js) — 18/09/2026

Pedido do Gregory: "análise do código inteiro, procure bugs, o que pode ser
melhorado". Escopo: `index.html` inteiro (11313 linhas, todos os módulos —
pronta-entrega, consertos, financeiro, conferências, catálogo, etiquetas), mais
`pe-core.js` e `marca/` (só assets de imagem, sem código — nada a auditar lá).

Método: leitura direta do código + grep sistemático dos padrões pedidos (`.set(` sem
merge, `FieldValue.delete`, `onSnapshot`, `setInterval`), reconstrução manual do fluxo
de dados do módulo pronta-entrega (mais crítico, por ter causado 3 incidentes em 2
dias), comparação com o incidente forense da Manutt. `node --check` nos 6 blocos
`<script>` inline do arquivo (sem erro de sintaxe). Não tenho eslint configurado no
projeto nem acesso a rodar num browser real — não pude testar a UI ao vivo.

**Limite honesto**: o arquivo tem 11 mil linhas com pelo menos 8 módulos diferentes
(pronta-entrega, consertos, financeiro, conferências, catálogo/reposição, etiquetas,
central de estoque, fila). Fiz uma auditoria **profunda** do módulo pronta-entrega
(pe*, o que causou os incidentes) e uma varredura **por amostragem** dos outros
módulos (grep dos padrões perigosos + leitura pontual dos trechos que o grep achou).
Não li linha por linha os 11 mil linhas. Onde não tenho confiança de ter coberto tudo,
digo isso explicitamente abaixo.

---

## BUGS — CRÍTICO

### C1. Seis caminhos de gravação do módulo pronta-entrega nunca escreviam no `historico`
**Corrigido nesta sessão.**

`_pePersistir` é a única função que monta a entrada de `historico` antes de gravar.
Mas isso só acontece se a chamada passar pelo parâmetro `tipo` dela. Encontrei 6
funções que gravam `estoque`/`produzindo`/`lotesProducao` direto via `_peGravaDelta`,
**pulando `_pePersistir` inteiramente** — ou seja, mudam dados reais no Firestore sem
deixar nenhum rastro de quem fez o quê:

- `peConfirmarProduzir` (index.html:6326-6350) — colocar grade em produção
- `peLotePronto` (6090-6101) — marcar lote como pronto (entra no estoque)
- `_peReceberAplicar` (6142-6156) — receber lote (parcial ou total)
- `peExcluirLote` (6069-6089) — excluir lote
- `peSalvarLote` (6173-6195) — corrigir grade de um lote já lançado
- `peAplicarLotesProntos` (6373-6390) — código morto (ver M1), mas tinha o mesmo bug

Comparado com `peFabSalvar` (grid direto) e `peMutarOrdens`/`peOrdemPronta`/
`peConfirmarEnvio` (fluxo de `ordens`), que sempre passam por `_pePersistir` e sempre
logam. O módulo de lotes de produção era a exceção.

**Por que isso importa pro incidente da Manutt**: não consegui confirmar o mecanismo
exato de como `produzindo` foi de 358 pares pra `{}` às 12:54-12:55 sem deixar
historico (ver `RECONSTRUCAO_MANUTT.md` — investiguei e não achei o caminho de código
exato que explica esse wipe específico). Mas este achado explica **por que, se
qualquer coisa do tipo acontecer de novo em qualquer um desses 6 caminhos, não vai
sobrar prova nenhuma** — que é exatamente o padrão do incidente de hoje. Fechar esse
buraco não prova o que aconteceu, mas impede que aconteça de novo sem rastro.

**Fix**: cada uma das 6 funções agora calcula o diff (`peDiffMapas`, a mesma função
que `peFabSalvar` já usa) entre o doc lido e o resultado, e grava uma entrada de
`historico` quando há mudança real — mesmo padrão que já existia, só estendido pros
caminhos que faltavam. Testado em `tests/test_pe.mjs` (4 casos novos).

### C2. `ordens` com status `'producao'` nunca aparecem em lugar nenhum da tela + não tem como chegar nesse status
**Documentado, não corrigido — ver justificativa abaixo.**

`renderModoFabrica` (tela da fábrica) computa `prods`/`prodHTML` (index.html:5402-5403,
lista de ordens com `status==='producao'`, com botão "Marcar como pronto") mas **nunca
insere esse HTML em lugar nenhum** — `_estoquePane` (5416-5421) monta `pedHTML`,
`emProdHTML`, `histHTML`, `modosHTML`, mas não `prodHTML`. A variável é computada e
descartada.

Além disso, a ÚNICA função que move uma ordem de `'pedido'` pra `'producao'` é
`peColocarProducao` (6047) — e ela não tem **nenhum** botão que a chame, nem na tela
da fábrica nem no painel admin (`peOrdensPainel`, 6762, que mostra pedido/produção/
enviado mas só tem botões de "Confirmar envio"/"Etiquetas"/"Excluir" pro pedido, sem
"colocar em produção"). Confirmei (grep no arquivo inteiro) que `peColocarProducao`
só aparece na própria definição e no `window.peColocarProducao=...` de export — zero
chamadas.

Conclusão: esse status é **inatingível hoje** — nenhuma ordem jamais chega lá pela UI
atual. Confirmei também que o fluxo real (`peConfirmarEnvio`, 6423) aceita enviar
qualquer ordem independente do status (`pedido` vai direto pra `enviado`), então a
etapa `producao` do fluxo de `ordens` não é usada na prática — o "colocar em
produção" de verdade que a fábrica usa é o botão separado "Produzir"
(`peProduzirAbrir`/`peConfirmarProduzir`), que mexe em `produzindo`/`lotesProducao`,
**não** em `ordens`.

**Por que não corrigi**: o doc da Manutt nem tem campo `ordens` (nunca recebeu pedido
da loja via `peNovaOrdem`), então isso não é a causa do incidente dela. E consertar só
o render (inserir `prodHTML`) sem religar `peColocarProducao` a algum botão não muda
nada na prática — a seção sempre mostraria "Nada em produção" porque nada nunca chega
nesse status. Decidir entre (a) apagar o status `producao` do fluxo de `ordens`
(simplificar pra `pedido → enviado` direto, que é o que já acontece) ou (b) adicionar
o botão que falta é decisão de produto, não escrevi isso sem confirmar com vocês.

---

## BUGS — ALTO

### A1. Duas representações desconectadas de "produção em andamento"
A grade da fábrica tem uma linha "Produzindo" editável célula-a-célula (mesmo padrão
da linha "Estoque", com `data-tp="p"`, `peFabSalvar` grava direto no mapa
`produzindo`). Só que a seção "Em produção" da tela (`emProdHTML`, 5406-5409) só
mostra cards vindos de `lotesProducao` — o array de lotes criados exclusivamente pelo
botão separado "Produzir" (`peProduzirAbrir`/`peConfirmarProduzir`).

Resultado: editar a célula "Produzindo" de um produto na grade muda o total (aparece
no resumo da cor e no "Total geral"), mas **nunca vira um card na seção "Em
produção"**, e não tem como confirmar recebimento desse número especificamente (só dá
pra receber por `loteId`, e essa edição não cria lote nenhum). Uma vez que o número
entra em `produzindo` por essa linha da grade, ele só sai de lá se alguém editar a
mesma célula de novo (manualmente, sem nenhuma ferramenta de "isso já chegou").

Isso bate literalmente com a queixa "pedidos de produção não estão aparecendo": é
plausível que a restauração das 09:15 (que recalculou `produzindo` diretamente, sem
criar lotes — ver `RECONSTRUCAO_MANUTT.md`) tenha caído exatamente nesse buraco — os
358 pares ficaram certos no total da grade, mas nunca apareceram como algo esperando
confirmação na seção "Em produção".

**Recomendação** (não fiz — mudança de UX/arquitetura, arriscada pra fazer sem
validar com quem usa o painel todo dia): unificar as duas representações. Ou a linha
"Produzindo" da grade vira somente-leitura (todo número em produção passa a vir de um
lote, criado pelo botão "Produzir"), ou editar essa célula direto passa a criar/
atualizar um lote automaticamente.

### A2. Delta calculado contra a leitura de FORA da transação, não de dentro
`_peGravaDelta` (index.html:6013-6027) abre uma transação (`_db.runTransaction`) e lê
o doc de novo lá dentro (`tx.get(ref)`), mas o **cálculo do delta em si**
(`PECore.montarGravacao(payload, base, atual, DEL)`) usa `atual` (a leitura de
dentro da transação) só pra decidir SE pode emitir delete (`podeDel`) — os valores do
delta são sempre `deltaCampo(base[campo], payload[campo], ...)`, comparando contra
`base`, que é o estado lido ANTES da transação abrir (às vezes minutos antes, no caso
de `peFabSalvar`, que usa o cache local `_c` como base). Ou seja: a transação garante
que a ESCRITA é atômica (não pisa em cima de outra escrita simultânea sem querer), mas
não garante que o CONTEÚDO do delta reflete o estado mais recente — se duas ações
mexerem na mesma chave numa janela pequena, a segunda a gravar usa sua própria base
desatualizada, não o que a primeira acabou de escrever.

Risco estreito (só importa se duas ações tocam a MESMA chave quase ao mesmo tempo) mas
real, e mais fácil de acontecer nas funções de lote do que no `peFabSalvar` — todas
elas fazem um `.get()` isolado imediatamente antes de montar o payload (não usam o
cache `_syncEm`), então a janela é pequena mas existe (tempo entre o `.get()` de fora
e o `tx.get()` de dentro).

**Recomendação** (não fiz — mudar isso significa mover a MONTAGEM do payload pra
dentro do corpo da transação em todo lugar que chama `_peGravaDelta`, um refactor
maior do que cabe numa correção pontual): recalcular o payload usando `atual` (a
leitura de dentro da transação) como base real, em vez de só usar `atual` pra decidir
`podeDel`.

---

## BUGS — MÉDIO

### M1. `peAplicarLotesProntos` é código morto
Grep no arquivo inteiro: `peAplicarLotesProntos(` só aparece na própria definição
(6373) — nenhuma chamada. Corrigi o logging de historico nela mesmo assim (barato,
consistente com o resto), mas ela não roda em lugar nenhum hoje. Se a intenção
original era aplicar lotes vencidos automaticamente (a função existe e faz exatamente
isso), falta ligá-la a algo — um `setInterval` (o padrão já existe no arquivo, ver
`checar()` em 11315) ou um botão manual.

### M2. Pacotes de config "1 doc pra vários campos" fora do módulo pronta-entrega — **CONFIRMADO em produção pelo Gregory, CORRIGIDO (19/09/2026)**
Esta sessão anterior só tinha tocado de raspão neste item ("vale uma olhada"). O
Gregory confirmou em produção os dois sintomas: fotos de um usuário sumindo quando
outro abre o painel, e cache antigo restaurando acesso/config velhos por cima do
servidor. Investigação a fundo confirmou o mecanismo exato:

**Causa raiz (2 antipatterns, sempre juntos):** cada um destes "pacotes" grava um
timestamp (`ts`) no documento Firestore E TAMBÉM guarda uma cópia desse `ts` no
`localStorage` do aparelho (`loretto_rep_fotos_ts`, `loretto_rep_cfg_ts`,
`ls_misc_ts`). Ao abrir o painel:
1. O `onSnapshot` só aceitava a atualização vinda do servidor se `servidor.ts >
   tsGuardadoNoLocalStorage`. Um aparelho com relógio adiantado (ou que, por
   qualquer motivo, tenha gravado esse número errado uma vez) passa a IGNORAR
   PARA SEMPRE as atualizações reais de outros usuários — porque qualquer `ts`
   novo e real do servidor parece "mais velho" que o número inflado guardado
   localmente.
2. Pior: o bootstrap então comparava esse mesmo `ts` do servidor com o do
   `localStorage` e, se achasse o local "mais novo", **empurrava o bloco inteiro
   local (`.set()`, sem merge) por cima do documento do servidor** — apagando
   dados reais que outros usuários tinham acabado de gravar, sem gerar nenhum
   aviso.

Achei e corrigi **3 instâncias** desse padrão exato:
- `_rfRef` (`ls_rep_fotos/loja`, index.html ~4109-4120) — **este é o bug das
  fotos relatado pelo Gregory.**
- `_rcRef` (`ls_rep_cfg/loja`, index.html ~4088-4108) — config/curva de
  reposição (fixos, fábrica, custo, referência por cor, catálogo, estoque).
- `_miscRef`/`miscApplyIfNewer` (`ls_misc/loja`, index.html ~3903-3917) —
  **achado nesta sessão, não estava no relato do Gregory nem citado no prompt**:
  o mesmo mecanismo protegia um bundle que inclui `loretto_usuarios` (lista de
  usuários do painel principal), `loretto_repo_config`/`loretto_repo_estoque`,
  curvas e catálogo de conferência. Risco pelo menos tão grande quanto o das
  fotos — um cache velho podia reescrever a lista de usuários do painel inteiro.

Também achei e corrigi um **segundo antipattern**, específico do acesso de
fábrica (`ls_pe_tokens/loja`, index.html ~5765-5775, relatado como "usuário com
cache antigo apaga tudo"): `_peAcesso`/`peEtqConfig` eram montados com
`Object.assign({}, remoto, local)` — o LOCAL por último, então vencia o
servidor em qualquer chave conflitante — e esse resultado (já contaminado pelo
cache velho) era regravado no servidor incondicionalmente TODA VEZ que a loja
abria o painel, mesmo quando o doc do servidor já tinha dados bons. Corrigido
invertendo a ordem do merge (servidor ganha, mesmo padrão que `_peTokens` já
usava corretamente) e travando a regravação pra só acontecer quando o doc do
servidor ainda não existe (migração de verdade, primeira vez).

**Não são o mesmo antipattern (auditados e considerados seguros):** `_fRef`
(fila de etiquetas), `_pRef` (favoritos) e `_cRef` (catálogo) — os três já
faziam bootstrap só com `if(!snp.exists)`, sem depender de nenhum `ts` do
localStorage. `_gRef` (grade por usuário, um doc por pessoa) também já usava
só um guard em memória (`_gLastPush`) pra ignorar o eco do próprio push, nunca
um valor do localStorage — correto desde antes desta sessão.

**Fix aplicado** (mesma filosofia em todos os 4 pontos, ver `pe-core.js`:
`PECore.deveGravarNaInicializacao`, `PECore.deveIgnorarSnapshotProprio`,
`PECore.mergePreferindoServidor`):
- `onSnapshot` só ignora um update se for o eco do push que a própria aba
  ACABOU de mandar (comparação em memória, nunca com valor do localStorage).
- Bootstrap só inicializa/empurra o bloco inteiro quando o doc do servidor
  **não existe** — nunca por comparação de timestamps.
- Merge de mapas tipo `{id: valor}` (pessoas/tokens/etqConfig): servidor ganha
  em toda chave que os dois têm; uma chave só local (edição desta sessão ainda
  não confirmada, ex. offline) não é apagada.
- Testes novos em `tests/test_pe.mjs` (7 casos, seção "sync de fotos/acesso não
  apaga dado de outro usuário").

**O que ficou de fora, documentado mas não mexido:** não implementei merge por
chave individual (cor a cor) para o conteúdo de `repFotos` em si — o
`onSnapshot` continua substituindo o mapa inteiro de fotos pelo do servidor
(fonte da verdade), e o push continua sendo o mapa local inteiro. Isso é
seguro dado o fix acima (o `onSnapshot` agora sempre recebe e aplica o dado
mais novo antes de qualquer push local acontecer), mas ainda existe uma janela
teórica: dois usuários editando fotos de CORES DIFERENTES do MESMO modelo, nos
poucos segundos entre a abertura do painel e a primeira sincronização, podem
fazer um sobrescrever a edição do outro (last-write-wins no nível do
`modeloId`, não da cor). Não vi evidência de que isso já tenha acontecido —
diferente do bug relatado, que era 100% causado pelo antipattern do `ts` do
localStorage, já eliminado.

### M3. `app-ver` sem disciplina automática de bump
Já era sabido (ver `RELATORIO_ZERAMENTO.md`): `app-ver` ficou parado em `e9` por todos
os commits entre 30/08 e 17/09/2026, incluindo fixes reais de bug (`8dda7e9`,
`11e0a62`, etc.) — nenhum deles avisou abas antigas. Bumped agora pra `e11` (esta
sessão). Recomendo transformar isso em regra mecânica: um teste/hook que falhe o commit
se `index.html` mudou sem o `<meta name="app-ver">` mudar junto — hoje depende de
lembrar manualmente.

### M4. Padrão de historico duplicado 7 vezes
O trecho `peDiffMapas(anteEst,novoEst).concat(peDiffMapas(anteProd,novoProd))` agora
se repete em 7 lugares (`peFabSalvar` + as 6 correções desta sessão). Baixo risco (é
código simples, já testado via `peDiffMapas`), mas seria mais fácil de manter como uma
função só em `pe-core.js` (ex.: `PECore.mudancasEstoqueProd(...)`). Não fiz — não
queria misturar refactor com a correção de bug nesta sessão; fica pra uma próxima
passada.

---

## BUGS — BAIXO

### B1. `try{}catch(){}` silenciosos em escritas secundárias
Vários pontos (`ls_pe_tokens`, prefs, fotos) engolem erro sem nem `console.error` —
aceitável pra dados não-críticos (token de acesso, preferências), mas dificulta
depuração se algum dia uma dessas escritas parar de funcionar silenciosamente.

---

## Achado positivo (não é bug — vale registrar)

O padrão "lista renderizada por `onSnapshot` + edição num modal separado" (usado em
consertos, financeiro, conferências, catálogo) é **inerentemente seguro** contra o
tipo de bug corrigido ontem no módulo pronta-entrega — como a edição não fica dentro
da árvore de DOM que é redesenhada a cada snapshot, um `onSnapshot` no meio da
digitação não pode apagar o que a pessoa está escrevendo. O módulo pronta-entrega é o
único que mistura "grid com inputs editáveis direto" e "auto-refresh por onSnapshot"
na mesma árvore — o que exigiu a guarda `devePularRenderFabrica` pra proteger. Vale
usar o padrão modal como referência pra qualquer edição ao vivo nova.

---

## MELHORIAS recomendadas (priorizadas)

1. **Unificar "Produzindo" (grid) com "lotes de produção"** (A1) — é a mudança de
   maior impacto pra resolver "pedidos de produção não aparecem" de forma definitiva,
   mas precisa de validação com quem usa o painel (decisão de UX).
2. **Mover o cálculo do delta pra dentro da transação** (A2) — fecha a janela de
   corrida remanescente nas gravações de lote.
3. **Decidir o destino do status `ordens.status==='producao'`** (C2) — remover (mais
   simples, reflete o que já acontece na prática) ou religar com um botão de verdade.
4. **Automatizar a disciplina de `app-ver`** (M3) — um hook/checagem simples evita
   repetir o incidente "fix publicado, ninguém avisado".
5. **Modularizar `index.html`** (11313 linhas, 1 arquivo só) — cada módulo (pe*, cons*,
   fin*, conf*) já é razoavelmente isolado por prefixo de função; separar em arquivos
   por módulo (como já foi feito com `pe-core.js` pra lógica pura) reduziria o custo de
   review e o risco de dois módulos colidirem numa mesma edição.
6. **Extrair `mudancasEstoqueProd` pra `pe-core.js`** (M4) — elimina a duplicação dos
   7 pontos que agora repetem o mesmo padrão de diff.

---

## O que foi corrigido nesta sessão

- `peConfirmarProduzir`, `peLotePronto`, `_peReceberAplicar`, `peExcluirLote`,
  `peSalvarLote`, `peAplicarLotesProntos`: agora sempre geram entrada de `historico`
  quando mudam `estoque`/`produzindo` de verdade (C1).
- `<meta name="app-ver">`: `e10` → `e11`.
- `tests/test_pe.mjs`: 4 casos novos garantindo que cada uma das funções de lote
  corrigidas produz um diff não-vazio (ou seja, que o ponto de gravação em
  `index.html` sempre tem algo pra logar quando algo muda). 22 testes, 0 falhas.
- `node --check` nos 6 blocos `<script>` inline: sem erro de sintaxe.

### Sessão de 19/09/2026 (continuação — M2 confirmado em produção pelo Gregory)
- `_rfRef` (fotos), `_rcRef` (config reposição), `_miscRef` (bundle misc/usuários):
  onSnapshot não ignora mais atualizações reais com base num `ts` do
  `localStorage`; bootstrap não empurra mais o bloco inteiro por cima do
  servidor com base nesse mesmo `ts` — só inicializa se o doc do servidor não
  existir (M2, ver detalhe acima).
- `ls_pe_tokens` (acesso/tokens/etqConfig de fábrica): merge corrigido pra
  servidor ganhar em conflito (era o local que ganhava); write-back automático
  no load agora só ocorre se o doc do servidor não existir (era incondicional).
- `pe-core.js`: 3 funções puras novas (`deveGravarNaInicializacao`,
  `deveIgnorarSnapshotProprio`, `mergePreferindoServidor`) reunindo a decisão
  que antes vivia espalhada e duplicada nos 4 pontos acima.
- `<meta name="app-ver">`: `e11` → `e12`.
- `tests/test_pe.mjs`: +7 casos novos (seção "sync de fotos/acesso não apaga
  dado de outro usuário"). 29 testes, 0 falhas.
- `node --check` nos 6 blocos `<script>` inline: sem erro de sintaxe (repetido
  após as mudanças desta sessão).

## O que foi só documentado (arriscado/estrutural, não corrigido)

- C2 (ordens/producao inatingível + render morto)
- A1 (grid Produzindo desconectada de lotesProducao)
- A2 (delta calculado fora da transação)
- M1 (peAplicarLotesProntos sem chamador)
- M4 (duplicação do padrão de diff pro historico)
- Dentro do próprio M2 (agora corrigido na causa raiz confirmada): o conteúdo
  de `repFotos` ainda é substituído/empurrado como mapa inteiro (por modeloId),
  não com merge cor-a-cor — ver justificativa detalhada na seção M2 acima.

## Mecanismo exato do wipe de `produzindo` às 12:54-12:55 da Manutt

**Não confirmado.** Investiguei os caminhos de escrita que tocam `produzindo` e não
achei um que, com o código atual (ou mesmo com o código de antes do commit `2ea1947`,
que já calcula delta em vez de sobrescrever o mapa inteiro), explique uma troca de 358
pares pra `{}` a partir de uma edição que só tocou "Estoque" de um produto diferente
(Derby Select Preto). O `RELATORIO_ZERAMENTO.md` já tinha descartado duas hipóteses
específicas (b: cache contaminado antes do `.set`; d: fluxo de lote zera sem repor) —
minha investigação desta sessão não achou uma terceira explicação concreta no código.
Ver `RECONSTRUCAO_MANUTT.md` pra mais detalhes e uma contradição adicional que achei
(a restauração das 09:15 cita "lotes não aplicados" como fonte, mas os 2 lotes que
existem hoje já estavam `aplicado:true` desde 11/09 — não bate). Recomendo, se
possível, puxar o histórico de versões do documento no Firestore console pra tentar
reconstituir o que aconteceu entre 09:15 e 12:54 com mais precisão do que os logs de
`historico` permitem.
