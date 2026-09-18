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

### M2. Pacotes de config "1 doc pra vários campos" fora do módulo pronta-entrega
Grep de `.set(` sem `merge:true` achou vários dentro de `renderFinanceiro`, consertos,
conferências, catálogo. Na maioria são docs 1-por-registro (`ls_fin_entradas/{id}`,
`ls_consertos/{id}`) — cada doc representa 1 lançamento e só é editado por quem abre o
modal daquele lançamento; overwrite total é o comportamento certo aí, risco baixo.
Achei também alguns "pacotes" (`_fRef`, `_pRef`, `_cRef`, `_aRef`, `_rcRef`, `_rfRef`,
`_gRef`, index.html ~4005-4126) que são configs de loja (fila de etiquetas, favoritos,
catálogo, avarias, reposição, fotos, grade) editados como blob único — mesmo padrão
que já causou um bug real e documentado no código (ver comentário em 9688-9692: o
"pacote misc" de conferências sobrescrevia o histórico de quem salvasse por último, já
corrigido virando 1-doc-por-conferência). Não tive tempo de confirmar se algum desses
7 pacotes tem o mesmo risco (múltiplas pessoas editando o mesmo pacote ao mesmo
tempo) — são tipicamente mexidos só pela Loretto/admin (1 pessoa por vez), risco menor
que o pronta-entrega (várias fábricas gravando ao mesmo tempo), mas vale uma olhada.

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

## O que foi só documentado (arriscado/estrutural, não corrigido)

- C2 (ordens/producao inatingível + render morto)
- A1 (grid Produzindo desconectada de lotesProducao)
- A2 (delta calculado fora da transação)
- M1 (peAplicarLotesProntos sem chamador)
- M2 (pacotes de config 1-doc-vários-campos fora do pronta-entrega)
- M4 (duplicação do padrão de diff pro historico)

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
