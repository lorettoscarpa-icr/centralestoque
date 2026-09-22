# Caça-fantasma 22/09/2026 — achado, provado e corrigido (e16)

## O que estava acontecendo

3 vezes no mesmo dia (14:1x, 15:44, 16:41), o campo `produzindo` de uma
fábrica (356 pares, na última vez) virava `{}` (vazio) sozinho, **sem
nenhuma entrada no `historico`**. Ao mesmo tempo, no mesmo período, a
Manutt estava digitando `estoque` normalmente — e essas gravações de
estoque funcionavam e apareciam no `historico` certinho.

Ou seja: não era aba velha parada em segundo plano. Era um caminho de
código que roda **junto** com o uso normal.

## A causa raiz (achada, com código exato)

Arquivo `pe-core.js`, função `montarGravacao` (a função por onde **toda**
escrita em `ls_pe` passa, chamada de dentro de `_peGravaDelta` em
`index.html`).

Ela recebia o payload de uma gravação — por exemplo, quando a fábrica
salva a tela de estoque (`peFabSalvar`, `index.html` linha ~5379), o
payload sempre tem **os dois mapas juntos**: `{estoque: {...}, produzindo:
{...}}`, mesmo quando a pessoa só mexeu no estoque.

Para cada um desses mapas, `montarGravacao` calculava um "delta" (só o
que mudou) e colocava o resultado no objeto final, que vira um
`tx.set(ref, out, {merge:true})` no Firestore. Quando `produzindo` não
tinha nenhuma edição nessa sessão, o delta dava **`{}`** — e esse `{}`
**também era mandado**, como `out.produzindo = {}`.

O problema: o Firestore, numa escrita `merge:true`, não tem como gerar uma
"field mask" (lista de sub-campos a mesclar) a partir de um objeto **sem
chaves**. Sem chaves pra listar, ele trata o campo inteiro como a unidade
a ser mesclada — e substitui o mapa inteiro do servidor por `{}`. Isso
apaga TUDO que estava em `produzindo`, mesmo que a intenção fosse "nada
mudou aqui".

E como o diff pro `historico` (`peDiffMapas(prodAnt, prod)`) também dava
vazio — porque, do ponto de vista do JavaScript, realmente nada mudou —
**não sobrava nenhum rastro**. Bate exatamente com o sintoma: estoque
gravado com log, produzindo zerado sem log, na mesma sessão.

Esse mecanismo dispara em **qualquer** gravação onde um dos mapas
(estoque/produzindo/meta) não teve edição nenhuma — não depende de aba
velha, de cache, ou de rede. É por isso que era imprevisível: só ficava
visível quando o campo intocado tinha dado real pra perder.

## A prova (reprodução isolada, sem Firestore de verdade)

```js
const PECore = require('./pe-core.js');
const DEL = Symbol('delete');
var prodReal = {'a|Preto|37': 100, 'a|Preto|38': 120, 'a|Preto|39': 136}; // 356 pares
var servidor = { estoque: {x:1}, produzindo: prodReal, atualizadoEm: 1000 };
var base     = { estoque: {x:1}, produzindo: prodReal, _syncEm: 1000 };
var payload  = { estoque: {x:1, y:5}, produzindo: prodReal }; // só estoque foi editado
var out = PECore.montarGravacao(payload, base, servidor, DEL);
console.log(out.produzindo); // {}  <- isto é o que ia pro Firestore e zerava tudo
```

Isso está reproduzido como teste automatizado em `tests/test_pe.mjs`
("escrita fantasma (incidente 22/09/2026 — Manutt)"), junto com o cenário
espelhado (editar só produzindo zerava estoque) e o caso "nada mudou em
nada" (nenhum campo pode aparecer no `set()`).

## O fix (e16)

`montarGravacao` agora **nunca inclui a chave** de um campo cujo delta deu
vazio — em vez de mandar `{}`, simplesmente omite o campo do objeto final.
Um campo ausente no `set(...,{merge:true})` faz o Firestore não tocar
nele, que é o comportamento certo pra "nada mudou".

```js
var d = deltaCampo(base[campo], payload[campo], podeDel?DEL:null);
if (!Object.keys(d).length) return; // nada mudou nesse campo — não manda a chave
```

Um só ponto de correção (`montarGravacao`), porque é o único lugar por
onde toda escrita em `ls_pe` passa (`_peGravaDelta` chama ela de dentro da
transação do Firestore) — todos os caminhos (autosave da fábrica, lotes,
metas, migração de doc legado) se beneficiam automaticamente.

## Guard-rail extra (defesa em profundidade)

Mesmo com a causa raiz corrigida, se algum caminho futuro voltar a gerar
um delete em massa de um mapa (bug novo, não este), `montarGravacao` agora
**aborta a gravação inteira** quando ela apagaria mais de 30% das chaves
não-zero de um mapa de uma vez (só considera mapas com 5+ chaves não-zero,
pra não travar exclusão legítima de um lote pequeno). O erro tem
`code:'delecao-suspeita'`, é logado alto (`console.error`) e mostra um
toast visível na tela avisando a pessoa pra chamar a Loretto — isso teria
parado os 5 zeramentos de hoje mesmo sem saber a causa exata.

## Por que agora é impossível repetir

1. A causa raiz (campo com delta vazio virando `{}` no `set()`) está
   corrigida no ÚNICO ponto por onde toda escrita passa — não dá pra um
   caminho de código "esquecer" o fix, porque não existe caminho que
   grave em `ls_pe` sem passar por `montarGravacao`.
2. O guard-rail de 30% é uma segunda camada: mesmo que um bug diferente
   volte a gerar um delete em massa, ele é bloqueado e avisado, não
   silencioso.
3. Testes automatizados (`tests/test_pe.mjs`, 45/45 verdes) cobrem os dois
   cenários — editar só estoque, editar só produzindo, editar nenhum dos
   dois, deleção em massa bloqueada, deleção pequena permitida — então
   qualquer regressão futura quebra a suíte antes de ir pro ar.

## Bônus resolvido nesta sessão: loop "atualizar infinito"

Pendência já registrada por Gregory (`PENDENCIAS_GREGORY.md`): o botão
ATUALIZAR recarregava com `location.reload()`, que podia devolver a versão
em cache do GitHub Pages (`Cache-Control: max-age=600`) por até 10 minutos
— o overlay de versão antiga reaparecia na hora. Corrigido: agora recarrega
com cache-buster (`location.href = location.pathname + '?v=' + Date.now()`).

## Versão

App-ver bump: `e15` → `e16`. `appVerMin=e16` só foi gravado no Firestore
(nos 3 docs de fábrica + `ls_pe_config/loja`) depois de confirmar via
`curl` que o GitHub Pages já servia `app-ver` `e16` publicamente — pra não
repetir o problema do gate de versão travando gente que ainda não tinha
como atualizar.
