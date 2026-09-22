# Arquitetura de sincronização — modelo "planilha" (22/09/2026)

Documento de referência definitivo. Se um dia alguém (Loretto, ou quem vier
depois) precisar mexer no jeito como o painel salva dados, comece por aqui.
Os relatórios de incidente (`RELATORIO_*.md`, `CACA_FANTASMA_22SET.md`,
`AUDITORIA_SYNC_22SET.md`) continuam valendo como histórico — este arquivo é
o "estado final", não substitui a investigação de cada um.

## Como funciona hoje

O sistema copia o princípio do Google Planilhas: **nunca manda a planilha
inteira, só a célula que mudou.**

1. **Cada aba só grava o que ela editou.** Quando a fábrica salva a grade,
   o painel compara o que está na tela com o que essa mesma aba tinha visto
   por último (`_syncEm`) e monta um "delta" — só as chaves
   (`modeloId|Cor|Tamanho`) que realmente mudaram (`pe-core.js`,
   `deltaCampo`). O resto nunca entra no payload.
2. **Um funil só, sempre.** Toda escrita em `ls_pe/<fabricaId>` passa por
   `_peGravaDelta` (`index.html`), que abre uma transação no Firestore: lê o
   estado atual do servidor, chama `PECore.montarGravacao` pra decidir o
   delta contra ESSE estado (não contra o que a tela tinha em memória), e
   só então grava com `set(ref, delta, {merge:true})`. Não existe um segundo
   caminho de escrita — todos os botões (Produzir, Pronto, Receber, Excluir,
   metas, layout de etiqueta, migração do doc legado) passam por aqui.
3. **Nunca manda um campo vazio.** Se nesta gravação ninguém editou
   `produzindo` (por exemplo), o campo simplesmente não aparece no objeto
   final — nunca vira `{}`. Isso existe porque o Firestore, num
   `set(...,{merge:true})`, não sabe fazer merge de um objeto sem chaves: ele
   troca o campo inteiro por vazio. Essa foi a causa dos 3 zeramentos
   silenciosos de `produzindo` em 22/09 (ver `CACA_FANTASMA_22SET.md`).
4. **Fila de pendências.** Antes de tentar a rede, a operação
   (`{opId, path, base, payload}`) é gravada em
   `localStorage['loretto_pe_fila']`. Só sai da fila quando o servidor
   confirma. Se a rede cair, ela fica lá e é reenviada sozinha quando a aba
   volta a ficar `online` (`_peFilaRebase`). Reenviar não duplica nem soma:
   o payload é sempre "o valor final desta chave", não um incremento — mandar
   duas vezes dá o mesmo resultado.
5. **`localStorage` nunca é dado, só fila e preferência de tela.**
   `estoque`/`produzindo`/`ordens`/`lotesProducao` vivem só em memória
   (`_peEstoqueCache`), alimentados exclusivamente pelo `onSnapshot` do
   Firestore. Não existe "abrir e já mostrar o que ficou salvo localmente" —
   sempre é o servidor que decide. `localStorage` só guarda: a fila de
   operações pendentes, token/acesso/config de etiqueta (e esses, desde o
   fix de 19/09, sempre preferem o servidor no merge — nunca "o mais
   recente pelo relógio do celular").
6. **Toda mudança de dado deixa rastro.** Qualquer gravação em
   `estoque`/`produzindo`/`lotesProducao`/`ordens` passa por
   `peDiffMapas`/`peHistEntry` antes do `set()` e entra em `historico` via
   `arrayUnion`. Uma gravação sem log é tratada como bug, não como detalhe.
7. **Versão velha não escreve nem usa a tela.** Cada doc guarda
   `appVerMin` (a versão mínima que pode gravar nele). Uma aba com
   `<meta name="app-ver">` menor que isso é bloqueada — primeiro só na
   escrita (`versaoBloqueiaEscrita`), e desde a sessão do gate total também
   na tela inteira (`deveMostrarGateTotal`, overlay bloqueante) — pra não
   deixar rodar lógica antiga que já causou incidente.
8. **Guard-rail de deleção em massa.** Mesmo com tudo isso, se algum bug
   novo (não este) fizer uma gravação apagar de uma vez mais de 30% das
   chaves não-zero de um mapa com 5+ chaves, `montarGravacao` aborta a
   gravação inteira (`code:'delecao-suspeita'`) em vez de deixar passar —
   avisa a pessoa na tela e loga alto no console.
9. **Badge de saúde no painel.** O topo da tela da fábrica mostra a versão
   do painel e, se houver, quantas operações ainda não foram confirmadas
   pelo servidor (`peFabHealthTxt`, `#fabHealth`) — pra fábrica ver de cara
   que está sincronizado sem precisar perguntar.

## Por que não zera mais

Os 3 zeramentos de 22/09 e os de 17-18/09 tinham causas diferentes, mas
todas no mesmo formato: **uma aba decidia "quem ganha" usando alguma coisa
que não era o estado real do servidor** (cache local, relógio do
dispositivo, campo sem edição virando `{}`). O desenho acima fecha essa
classe inteira de bug numa frase: **a única fonte que decide o valor de uma
chave é o próprio Firestore, e cada gravação só fala sobre as chaves que a
sessão realmente tocou.** Não tem "estado inteiro" pra pisar em cima de
nada — nunca existe, do jeito que o payload é montado.

## Se precisar mexer nisso um dia

- **Toda regra de "o que grava" mora em `pe-core.js`**, não em `index.html`.
  Se for mudar como um delta é calculado, mude lá, roda
  `node tests/test_pe.mjs` (45 cenários, nomes em português descrevendo cada
  incidente/regra) e só depois espelha no `index.html` se precisar.
- **Nunca adicione um segundo caminho de escrita em `ls_pe`.** Se aparecer
  um botão novo que precisa gravar, ele tem que chamar `_peGravaDelta` (ou
  uma função que já chama, como `_pePersistir`/`peMutarOrdens`) — não fazer
  `.set()` direto. `grep -n "\.collection('ls_pe').*\.set(" index.html` deve
  sempre voltar vazio fora de `_peGravaDelta`.
- **Bump de `app-ver` em todo commit que toca lógica de `ls_pe`.** O gate de
  versão só protege quem já atualizou — sem o bump, uma aba desatualizada
  nem sabe que devia recarregar.
- **`appVerMin` no Firestore só depois de confirmar (via `curl`) que o
  GitHub Pages já serve o `app-ver` novo publicamente.** Gravar antes disso
  tranca gente que ainda não tem como atualizar. Script de referência:
  `_write_gate_e16.py` (usa a credencial Admin restrita, documentada na
  memória do projeto, e só toca `appVerMin` + uma linha de `historico`).

## O que foi avaliado e decidido NÃO mudar (registro de decisão)

- **Render da grade da fábrica ainda substitui a tela inteira, não célula
  por célula.** O guard (`devePularRenderFabrica`) já impede qualquer
  redesenho enquanto existe campo focado ou dirty pendente em QUALQUER
  lugar da tela — mais conservador que "só protege a célula focada", mas
  também mais simples e já comprovadamente suficiente (é o fix do
  incidente de 18/09). Reescrever pra reconciliação célula-a-célula no DOM
  é um projeto de risco médio/alto (a grade tem inputs dinâmicos, steppers,
  totais calculados) pra um ganho que hoje é só "a pessoa ao lado também
  pode editar sem esperar"; não há relato de fábrica com 2+ pessoas
  editando a mesma tela ao mesmo tempo. Registrado como pendência opcional
  em `PENDENCIAS_GREGORY.md`, não implementado — decisão de produto, não
  bug.
- **A fila de pendências cobre só a coleção `ls_pe`.** `ls_pe_tokens`/
  `ls_rep_fotos`/`ls_rep_cfg` têm proteção própria (`mergePreferindoServidor`,
  `deveGravarNaInicializacao`) mas não passam pela mesma fila/retry
  automático — não há indício de perda de dado por isso; se aparecer um
  caso real, dá pra estender o mesmo padrão.
- **Sem Firestore Security Rules.** Todo o gate de versão e as proteções
  acima são do lado do cliente (JS no navegador) — alguém com DevTools
  aberto e acesso ao SDK ainda escreveria direto, ignorando tudo isso. Fica
  fora do escopo deste ambiente (sem acesso às rules); registrado em
  `PENDENCIAS_GREGORY.md` pra ser feito direto no console do Firebase.

## Testes

`node tests/test_pe.mjs` — sem framework, roda em Node puro. 45 cenários
agrupados por título (`console.log` antes de cada grupo) e nomeados em
português descrevendo o incidente ou regra que cobrem: digitação simultânea,
replay de fila/idempotência, escrita fantasma (campo vazio), guard-rail de
deleção em massa, guarda de re-render, lotes de produção, recebimento
parcial, write-back do doc legado, historico obrigatório, sync de
fotos/acesso, gate de versão e gate total de UI. Qualquer regra nova nesta
arquitetura deveria nascer como um teste nesse arquivo antes de ir pro
`index.html`.
