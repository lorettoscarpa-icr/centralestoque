# Reconstrução proposta — ls_pe/manutt (incidente 18/09/2026, 12:54–12:55)

**NÃO EXECUTAR EM PRODUÇÃO.** Este documento é só a proposta de estado correto de
`produzindo`/`ordens` da Manutt, pra Lia aplicar manualmente depois de autorização do
Gregory. Não tenho acesso ao Firebase de produção nesta sessão — tudo aqui vem só dos
fatos forenses passados no prompt e do que o código atual faz com eles.

## O que sabemos (fatos forenses, não inventados)

| Hora | Evento | Fonte |
|---|---|---|
| 09:04 | manutt zera Derby Select Preto 39-44 (7/7/7/5/3/2 → 0), tipo "estoque/produção" | historico |
| 09:15 | Lia grava entrada "Lia (restauração: produzindo recalculado dos lotes nao aplicados)" — produzindo passa a ter 358 pares / 80 grades (botas chelsea sola borracha Preto/Pinhão, derby select, derby inglês select, loafer select, loafer gravata select) | historico |
| 12:54–12:55 | manutt relança **só** "Derby Select Preto 37-44" (0 → 2/4/7/7/7/5/3/2 = 37 pares), tipo "estoque/produção" | historico |
| agora | estoque = 8 grades (os 37 pares acima) · **produzindo = {} vazio** — os outros ~72 grades da restauração das 09:15 não estão em lugar nenhum, e não existe NENHUMA entrada de historico entre 09:15 e 12:54 que explique o sumiço | estado atual do doc |
| — | lotesProducao tem só 2 lotes: `lp1787593498200` e `lp1787593888686`, criados ~20/08, **aplicado:true**, prontoEm ~11/09, com campo `recebido` preenchido para grades de derby/loafer select | estado atual do doc |

## Contradição que não consegui resolver (documentando, não inventando)

A entrada das 09:15 diz que `produzindo` foi "recalculado dos lotes **não aplicados**".
Mas os únicos 2 lotes que existem em `lotesProducao` hoje já estão **aplicado:true**
desde ~11/09 — ou seja, pela semântica atual do código (`PECore.aplicarLotePronto`,
`aplicarRecebimento`: um lote `aplicado:true` já teve sua grade **tirada** de
`produzindo` e **somada** em `estoque`), esses 2 lotes não poderiam ter sido a origem
de 358 pares em `produzindo`. Duas explicações possíveis, não confirmadas:

- havia outros lotes em `lotesProducao` às 09:15 (não aplicados) que **não existem
  mais hoje** — o que seria mais um delete silencioso, desta vez em `lotesProducao`,
  não investigável sem acesso ao histórico bruto de versões do documento; ou
- a restauração da Lia não usou `lotesProducao` como fonte literal, e sim reconstruiu
  o número a partir do histórico de lançamentos de produção (uma leitura manual dos
  `peHistEntry` antigos), e a frase "dos lotes não aplicados" é uma descrição
  aproximada, não uma leitura direta do array.

**Não confirmei qual das duas é verdade.** Isso importa pra reconstrução porque, se a
primeira for verdadeira, pode haver lotes específicos (com `id`, `grade`, `prontoEm`)
que deveriam ser recriados em `lotesProducao` — não só o número agregado em
`produzindo`. Recomendo a Lia checar se o Firestore console tem histórico de versões
do documento (ou algum backup/export) de antes das 09:15 do dia 18/09.

## Método de reconstrução proposto

1. **Base**: os 358 pares / 80 grades que a Lia já validou às 09:15 (ela é quem fez a
   restauração original, com mais contexto do que eu tenho agora — não estou
   questionando o número agregado, só documentando que não sei o detalhe por SKU).
2. **Ambiguidade que precisa de decisão humana**: os 37 pares de "Derby Select Preto
   37-44" que a manutt lançou em `estoque` às 12:54 — **isso é produção que estava em
   `produzindo` e ficou pronta (deveria sair de `produzindo`), ou é uma contagem de
   estoque física independente (não deveria mexer em `produzindo` de jeito nenhum)?**
   Não dá pra saber só pelo código — `peFabSalvar` (a função que ela usou, tipo
   "estoque/produção") deixa a pessoa editar Estoque e Produzindo como duas linhas
   totalmente independentes da mesma grade; não há vínculo automático entre "produção
   ficou pronta" e "editar a linha de estoque". A manutt pode ter pretendido as duas
   coisas.
   - **Se a intenção foi "ficou pronto, mover de produção pra estoque"**: o
     `produzindo` restaurado deveria ter as 8 chaves de `derby-select|Preto|37..44`
     **subtraídas** do valor que estava lá às 09:15 (idealmente até zerar, se as 37
     pares corresponderem exatamente ao que tinha em produção pra esse SKU/cor).
   - **Se foi uma contagem de estoque separada** (ex.: par achado numa prateleira,
     devolução, o que for): o `produzindo` restaurado deveria manter os valores de
     Derby Select Preto 37-44 **intactos**, e os 37 pares em estoque são uma entrada
     nova, sem relação.
   - **Minha recomendação**: perguntar direto pra manutt ("os 37 pares de Derby Select
     Preto que você lançou às 12:54 eram produção que ficou pronta, ou uma contagem de
     estoque separada?") antes de aplicar qualquer número — é a única forma de não
     chutar.
3. **Os outros ~72 grades** (chelsea sola borracha Preto/Pinhão, derby inglês select,
   loafer select, loafer gravata select, e o que sobrar de derby select fora do
   Preto/37-44): não há nenhuma ação legítima registrada no historico que justifique
   tirá-los de `produzindo`. Proposta: **restaurar integralmente**, com os mesmos
   valores por SKU que a restauração da Lia às 09:15 tinha (preciso do array
   `mudancas` daquela entrada de historico especificamente — não foi incluído no
   resumo forense que recebi; só o agregado "358 pares/80 grades". Pedir esse array
   bruto do Firestore antes de montar o JSON final de gravação).
4. **Historico da correção**: registrar uma entrada nova tipo `restauração` (mesmo
   padrão da 09:15), citando este documento, quando a Lia aplicar. Não sobrescrever a
   entrada das 09:15 nem apagar a de 12:54 — as duas continuam válidas como está.

## O que eu NÃO fiz (e por quê)

- Não montei o JSON final de `produzindo` porque não tenho os 80 valores por SKU da
  restauração das 09:15 — só o agregado. Monte a partir do array `mudancas` daquela
  entrada de historico (Firestore console → `ls_pe/manutt` → campo `historico`, achar
  a entrada com `por: "Lia (restauração...)"`).
- Não decidi a ambiguidade do item 2 sozinho — envolve intenção de negócio (o que a
  manutt quis dizer), não é coisa que dá pra inferir só do código.
- Não toquei em `lotesProducao` — a contradição do item acima precisa ser resolvida
  antes de mexer nesse array.
- `ordens`: o doc da manutt não tem esse campo (nunca teve nenhum pedido lançado pela
  loja pra ela via `peNovaOrdem`). Não há nada pra reconstruir aqui — ver
  RELATORIO_AUDITORIA.md sobre o fluxo `ordens` estar desconectado do fluxo real que a
  manutt usa (`produzindo`/`lotesProducao`).

## Trava a considerar antes de gravar (código já existe pra isso)

Ao aplicar a restauração, use o mesmo padrão do fix `2ea1947`/`montarGravacao`:
leia o doc atual pela última vez imediatamente antes de gravar e confirme que ninguém
mexeu em `produzindo` entre agora e a leitura que embasou esta reconstrução — senão
o "fix" da restauração pode repetir o mesmo tipo de sobrescrita que causou o
incidente original.
