# Relatório — zeramento de dados de fábrica (17/09 e 18/09/2026)

## Resumo

Dois incidentes de zeramento de estoque/produção do módulo pronta-entrega em dois
dias seguidos. O primeiro (TCHWM, 17/09) já tinha correção de emergência publicada
(commit `2ea1947`). O segundo (Manutt, 18/09, 09:02–09:04) aconteceu **depois** dessa
correção estar no ar. Investigando o código, a causa mais provável do segundo
incidente não é um novo bug de gravação — é que **a correção de ontem nunca chegou a
rodar no aparelho da fábrica**, porque o mecanismo de aviso de versão nova existente
não tinha como detectar essa mudança (ver Causa raiz confirmada). Além disso, achei e
corrigi um bug real e independente na renderização do modo fábrica que também podia
zerar campos sendo digitados (ver "Bug corrigido (a)"), mesmo já rodando a versão
corrigida.

## Causa raiz confirmada: o aviso de versão nova não disparou

O painel já tem, desde antes destes incidentes, um mecanismo de aviso de versão
(`<meta name="app-ver">` + checagem periódica no rodapé do `index.html`, função
`checar()`/`mostrar()` perto do fim do arquivo). Ele funciona comparando o
`app-ver` do HTML já carregado no aparelho com o `app-ver` do arquivo publicado.

**O commit `2ea1947` (fix de emergência do incidente de 17/09) mudou a lógica de
gravação (`_peGravaDelta`, write-back do doc legado) mas não bumped o
`<meta name="app-ver">`** — ele continuou em `e9` antes e depois do fix
(`git show 2ea1947 --stat` não toca a linha do `app-ver`; `git log -p` confirma que
o valor só mudou em commits anteriores, de `e1` até `e9`, nunca depois).

Consequência prática: qualquer aba/aparelho que já tivesse `index.html` carregado
antes das 15:02 do dia 17/09 (hora do deploy do fix) — ou que tivesse aberto o app
de novo mas com uma cópia em cache de HTTP com o mesmo `e9` — **nunca recebeu o
aviso "Tem versão nova do sistema"**, porque a checagem só dispara quando o `app-ver`
do servidor é diferente do carregado, e os dois eram idênticos (`e9`). Um tablet de
fábrica que fica ligado o dia inteiro sem dar F5 é exatamente esse cenário. O
incidente da Manutt aconteceu ~18h depois do deploy do fix — tempo de sobra pra uma
aba ter ficado aberta a noite toda rodando a versão de **antes** da correção
(sem a transação/gate de `_syncEm` em `_peGravaDelta`, sem a proteção no write-back
do legado).

Não tenho como confirmar 100% que foi exatamente isso que aconteceu no aparelho da
Manutt (não há log de qual versão o navegador dela tinha carregado) — mas é a
explicação mais concreta e verificável no código: **o gatilho de atualização estava
quebrado por omissão, independente de qualquer outro bug**. Corrigido agora.

### O que foi corrigido
- `<meta name="app-ver">` bumped de `e9` para `e10` neste commit (disciplina: todo
  fix de fábrica precisa bumped a versão, senão o aviso não dispara).
- O aviso, antes, **nunca recarregava sozinho** (por design: "quem toca é a pessoa,
  senão o que ela está digitando some"). Isso é uma decisão de segurança correta,
  mas na prática significa que se não tiver ninguém pra clicar "Atualizar" numa aba
  esquecida, ela nunca atualiza. Agora, **só na tela da fábrica**, se detectar
  versão nova E não tiver ninguém mexendo naquele momento (sem campo focado, sem
  numeração pendente de salvar — `data-dirty` —, sem modal aberto), o app recarrega
  sozinho. Se tiver alguém trabalhando, continua só avisando, igual antes — nunca
  interrompe quem está digitando.

## Bug corrigido (a): re-render podia apagar edição em andamento

Confirmado no código (`onSnapshot` do doc `ls_pe` no modo fábrica): a cada
atualização do Firestore, a tela **sempre** sobrescrevia `_peEstoqueCache` por
inteiro, e só pulava o `renderModoFabrica()` (que redesenha a grade do zero) se o
elemento focado no momento tivesse `data-fk`/`data-etk`. Isso cobre digitação
contínua num campo, mas **não cobre**:
- clique nos botões `+`/`-` do stepper (`peStep`): eles marcam o campo como
  `dirty` e disparam o autosave, mas **não focam o input** — o elemento focado é o
  botão, sem `data-fk`. Se um `onSnapshot` chegasse nesse instante, a guarda falhava
  e a grade era redesenhada, apagando o `data-dirty` (e o valor ainda não salvo)
  antes do timer de 1s do autosave disparar — nesse caso o dado digitado nunca
  chegava a ser gravado, silenciosamente.
- qualquer brecha de foco entre um campo e outro.

Isso não prova por si só o "zerado 2 segundos depois" da Manutt, mas é uma falha
real e demonstrável de perda de edição em digitação — coerente com "padrão de
autosave, não humano" descrito no incidente.

### O que foi corrigido
A guarda agora também verifica se existe **qualquer** campo `data-dirty` pendente
em qualquer lugar da grade da fábrica (`document.querySelector('#fabricaMode
[data-dirty]')`), não só o foco atual. Extraída como função pura
`PECore.devePularRenderFabrica(focado, dirtyPendente)` (testada em
`tests/test_pe.mjs`).

## Hipóteses investigadas e descartadas

**(b) "`_peEstoqueCache` é atualizado antes do `set`, fazendo o diff comparar
contra o estado novo"** — **não confirmada**. Em `peFabSalvar`, `estAnt`/`prodAnt`
(a base usada no delta) são copiados **antes** da mutação de
`_peEstoqueCache[fid]` e passados por valor (`Object.assign({}, ...)`) pro
`_peGravaDelta` — a mutação do cache que acontece linhas depois não afeta essa
cópia. Os outros pontos que gravam (`peConfirmarProduzir`, `peLotePronto`,
`_peReceberAplicar`, `peExcluirLote`) sempre usam o documento **recém-lido do
Firestore** (`.get()`) como base, nunca o cache local. Não achei nenhum caminho
onde a base do delta é contaminada pelo próprio resultado antes de ser enviada.

**(d) "fluxo de lote zera `produzindo` sem repor"** — **não confirmada**. Revisei
todos os pontos que tocam `produzindo` (`peConfirmarProduzir` soma, `peLotePronto`
e `_peReceberAplicar` subtraem exatamente o que somam ao `estoque`, `peExcluirLote`
desfaz o que o lote tinha somado). Todos usam o doc lido na hora (`.get()`) como
base e são simétricos (o que sai de `produzindo` sempre entra em `estoque`, ou
volta pro estado anterior). `peAplicarLotesProntos` (que faria essa mesma
transição de forma automática) existe no código mas **não é chamada em lugar
nenhum** — é código morto, não pôde ter causado o incidente. O caso relatado (lote
5164 de Chelsea existindo em `lotesProducao` mas `produzindo={}`) não bate com
nenhum caminho de gravação identificado no código atual; a explicação mais provável
continua sendo a aba rodando a versão pré-fix do dia 17/09 (sem a proteção de
`_syncEm`), coerente com a causa raiz confirmada acima.

**(c) versão antiga em cache do GitHub Pages** — parcialmente é a mesma causa raiz
confirmada acima, só que por "cache" mais que por "aba aberta": mesmo com F5, se o
`app-ver` publicado é igual ao já carregado (que era o caso, `e9`==`e9`), o
mecanismo de aviso não tinha como saber que a lógica interna tinha mudado. Corrigido
junto com a causa raiz.

## O que foi feito neste commit

1. `<meta name="app-ver">`: `e9` → `e10`.
2. Aviso de versão nova: na tela da fábrica, recarrega sozinho quando detecta
   versão nova E não tem ninguém editando; continua só avisando quando tem.
3. Guarda de re-render do modo fábrica: não redesenha a grade enquanto existir
   qualquer campo `data-dirty` pendente (antes só olhava o foco atual).
4. Extraída a lógica pura de gravação por delta, merge do doc legado e transições
   de lote (produção → pronto → recebimento, parcial ou total) para `pe-core.js`,
   compartilhado entre `index.html` e os testes — elimina duplicação e risco de as
   duas cópias divergirem no futuro.
5. Removida `_peDeltaMapa` (código morto desde o fix de 17/09 — a lógica dela já
   tinha sido embutida em `_peGravaDelta` e agora vive em `PECore.montarGravacao`).
6. `tests/test_pe.mjs` (Node puro, `node tests/test_pe.mjs`): 18 casos cobrindo
   duas abas editando ao mesmo tempo (chaves diferentes sobrevivem; aba velha não
   apaga lançamento novo; aba em dia pode apagar o que ela via), a guarda de
   re-render durante digitação, lote registrado → `produzindo` populado,
   recebimento parcial/total/fechamento, e o merge do doc legado (incluindo o
   cenário exato do incidente de 17/09: doc principal com dado novo nunca é
   sobrescrito pelo legado).

## Risco residual

- Não há como provar, sem logs de versão do navegador da fábrica, que o incidente
  de 18/09 foi exatamente "aba rodando código pré-fix". É a explicação mais
  concreta e verificável encontrada no código, não uma certeza.
- O reload automático na tela da fábrica depende de checar corretamente "ninguém
  mexendo agora" (`_fabricaEmUso`); cobre foco em campo/textarea/select, `dirty`
  pendente e os modais conhecidos (`peEnvioModal`, `peAcessoModal`,
  `peConfigModal`). Se um modal novo for adicionado no futuro sem entrar nessa
  lista, um reload automático poderia, em teoria, interromper alguém no meio dele —
  vale lembrar de atualizar `_fabricaEmUso` ao criar modais novos no modo fábrica.
- A checagem de versão só roda a cada 10–30 min (ou ao voltar pro app); numa janela
  curta depois de um deploy, uma aba aberta ainda pode ficar rodando código velho
  por até ~30 min antes do reload automático — não é instantâneo.

## Instruções pra fábrica

- **Depois de qualquer aviso de atualização, ou se notar algo estranho no painel,
  dê um F5 (recarregar a página) antes de continuar lançando números.** A partir de
  agora, na tela da fábrica, o sistema tenta recarregar sozinho quando não tem
  ninguém mexendo — mas se estiver com algo aberto ou digitando, ele só avisa, e aí
  precisa clicar em "Atualizar".
- Sempre que possível, evite deixar a aba aberta por dias seguidos sem recarregar.
