# Pendências — gate de versão total 22/09/2026

- [ ] **Firestore Security Rules**: o gate de versão total implementado hoje
      (overlay bloqueante + fechamento dos 3 caminhos de escrita que
      bypassavam `_peGravaDelta`) é 100% do lado do cliente (JS no navegador).
      Alguém que abrisse o DevTools e chamasse o SDK do Firestore direto no
      console ainda conseguiria escrever em `ls_pe` sem passar pelo gate —
      isso só se fecha de verdade com regras do lado do servidor (Firestore
      Security Rules, ex.: exigir que toda escrita em `ls_pe/{doc}` traga um
      `appVerMin` >= o que já está salvo). Não mexi nas rules porque não
      tenho acesso a elas neste ambiente (não tem arquivo `firestore.rules`
      no repo) — precisa ser feito direto no console do Firebase. Ver
      `RELATORIO_GATE_TOTAL_22SET.md`.

# Pendências — restauração TCHWM 22/09/2026

Gravei no Firebase (`ls_pe/tchwm-industria-e-comercio-de-calcados-ltda`, campo
`estoque`) apenas os blocos da planilha cujo nome bate com uma chave que já
existe no `meta` do doc (catálogo canônico). Os blocos abaixo **não foram
gravados** porque não achei uma chave correspondente no `meta` com segurança —
prefiro perguntar a inventar.

## 1. Tokio (códigos 19002 e 19005) — ambíguo, falta 1 bit de informação

O `meta` da TCHWM tem dois modelos com as cores exatas "Allblack"/"Mouro" que
sobraram sem bloco da planilha:
- `derby moscow` (All Black, Mouro)
- `loafer moscow` (All Black, Mouro)

A planilha tem exatamente dois códigos "Tokio" com as mesmas duas cores:
- `19002` — Tokio Allblack (62 pares), Tokio Mouro (60 pares)
- `19005` — Tokio Allblack (104 pares), Tokio Mouro (66 pares)

A contagem bate (2 códigos × 2 cores = os 2 modelos "moscow" × 2 cores), mas
não sei **qual código é o derby e qual é o loafer** — nada na planilha ou no
`meta` diz isso. Não vou adivinhar porque errar aqui troca 292 pares entre um
estilo derby e um estilo loafer no estoque.

- [ ] [tchwm] Confirmar com Gregory: 19002 = derby moscow ou loafer moscow?
      (o outro código fica com o modelo restante). Total pendente: 292 pares
      (19002: 122, 19005: 170).

## 2. Florida (código 26007) — sem modelo correspondente no meta

Depois de mapear Paris→loafer paris fivela, Milano→sneaker milao,
Katar→loafer katar gravata e Tokio→(derby/loafer) moscow, sobra no `meta` só
`loafer dubai` (cores "All Black"/"Castor") — não bate com "Florida
Preto"/"Florida Mouro". Não existe modelo "florida" no catálogo atual.

- [ ] [tchwm] Florida Preto (13 pares) e Florida Mouro (15 pares, total 28) —
      qual chave do `meta` isso deveria virar? Precisa criar um modelo novo no
      catálogo (`loafer dubai` com cores erradas, ou um modelo "florida" que
      ainda não existe)?

## 3. Códigos 500 e 501 (Preto/Mouro) — sem modelo correspondente no meta

Mesma situação: sobra `loafer dubai` no `meta`, cores não batem
("Preto"/"Mouro" na planilha vs. "All Black"/"Castor" no meta).

- [ ] [tchwm] 500 Preto (53) + 500 Mouro (49) = 102 pares — qual chave do
      `meta`?
- [ ] [tchwm] 501 Preto (60) + 501 Mouro (52) = 112 pares — qual chave do
      `meta`?

## 4. `loafer dubai` (All Black, Castor) — sem nenhum bloco na planilha

Nenhum bloco da planilha citou "Dubai". Esse modelo ficou sem contagem nova —
continua em zero em `estoque` (não gravei nada nele, nem zerado nem outro
valor). Se o modelo saiu de linha ou a contagem dele ficou fora da planilha,
avisar.

- [ ] [tchwm] Confirmar se `loafer dubai` tem estoque físico e, se tiver, qual
      bloco da planilha (se algum) corresponde a ele.

---

**Resumo:** 466 de 1000 pares da planilha foram gravados (6 blocos: Paris,
Milano, Katar). 534 pares (Tokio 292, Florida 28, 500/501 214) ficaram de fora
à espera de confirmação — ver checklist acima. Nada foi inventado nem
aproximado.

- [x] [gate-versao] BUG visto pelo Gregory 22/09 ~16h: loop "atualizar infinito" logo apos deploy — o botao ATUALIZAR recarrega mas o cache do GitHub Pages (max-age=600) devolve a versao antiga por ate 10min, e o overlay reaparece. RESOLVIDO nesta sessão (22/09, e16): `atualizar()` agora recarrega com `location.href=location.pathname+'?v='+Date.now()` (cache-buster), nunca `location.reload()` puro. O appVerMin=e16 só foi gravado no Firestore depois de confirmar via `curl` que o Pages já servia `app-ver` e16 — ver `CACA_FANTASMA_22SET.md`.

# Pendências — escrita fantasma (CAÇA_FANTASMA) 22/09/2026

- [x] **Causa raiz encontrada e corrigida** (e16): `montarGravacao` (pe-core.js)
      mandava `{}` pro Firestore quando um mapa (estoque/produzindo/meta) não
      tinha nenhuma edição na sessão — e `set(...,{merge:true})` com um mapa
      vazio ZERA o campo inteiro no servidor (não tem como o Firestore gerar
      uma field mask de um objeto sem chaves). Como `peFabSalvar` sempre manda
      estoque+produzindo juntos, editar só um dos dois zerava o outro, sem
      historico (o diff também dava vazio). Ver `CACA_FANTASMA_22SET.md` pra
      prova, reprodução e fix completos.
