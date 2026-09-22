# Relatório — Restauração TCHWM + Gate de Versão (22/09/2026)

Trabalho autorizado pelo Gregory no dia, feito direto no Firebase de produção
(`loretto-scarpa-l-icr`, coleção `ls_pe`, doc
`tchwm-industria-e-comercio-de-calcados-ltda`) via service account.

## Tarefa 1 — Restauração da pronta-entrega com a planilha do Gregory

### Estado antes

`estoque={}` e `produzindo={}` (doc zerado — 3º incidente da série).
`historico` com 564 entradas, a última de hoje (Ana Flora) zerando "Sneaker
Milão All Black 37: de 6 para 0". `produzindo` **não foi tocado** (fora do
escopo desta tarefa).

Backup do doc completo (antes de qualquer gravação) salvo em
`backup_tchwm_pre_restauracao_22set.json`.

### Mapeamento planilha → chave do meta

| Código planilha | Nome planilha | Chave gravada (`modelo\|Cor`) | Pares |
|---|---|---|---|
| 7600 | Paris Mouro | `loafer paris fivela\|Mouro` | 85 |
| 7600 | Paris Preto | `loafer paris fivela\|Preto` | 157 |
| 5505 | Milano Branco | `sneaker milao\|All White` | 87 |
| 5505 | Milano Allblack | `sneaker milao\|All Black` | 65 |
| 2202 | Katar Mouro | `loafer katar gravata\|Mouro` | 30 |
| 2202 | Katar Preto | `loafer katar gravata\|Preto` | 42 |

**Total gravado: 466 pares, 48 chaves** (6 blocos × 8 tamanhos), todas já
existentes no `meta` do doc — nenhuma chave inventada.

### Pendente (ver `PENDENCIAS_GREGORY.md` para o detalhe completo)

534 pares não foram gravados por falta de mapeamento seguro:
- **Tokio (19002/19005, 292 pares):** o `meta` sobrou com `derby moscow` e
  `loafer moscow` (mesmas cores All Black/Mouro), mas não dá pra saber qual
  código é qual modelo — ambíguo, precisa confirmação do Gregory.
- **Florida (26007, 28 pares) e códigos 500/501 (214 pares):** nenhuma chave
  do `meta` sobrou compatível (só resta `loafer dubai`, cores diferentes:
  All Black/Castor). Sem correspondência — precisa decisão do Gregory (criar
  modelo novo no catálogo? é o mesmo dubai com nome errado?).

### Prova da gravação

Gravação feita em transação Firestore (lê o doc atual, escreve só as 48
chaves como delta — `estoque.<chave>` — sem tocar em `produzindo` nem
substituir o mapa inteiro), com trava extra: aborta se alguma das 48 chaves
já tivesse valor diferente de zero no servidor no momento da escrita (dado
concorrente).

Depois de gravar, reli o doc do zero e conferi:
- `estoque`: 48 chaves, **466 pares** — bate exatamente com a soma dos 6
  blocos confirmados.
- `produzindo`: continua com 0 chaves (intocado).
- `historico`: **565 entradas** (564 + 1 nova), última é
  `{por:"Lia (restauração planilha Gregory 22/09)", tipo:"estoque/produção",
  mudancas: [48 itens]}`.
- Conferência chave-a-chave contra a planilha: **OK, tudo bate**.

## Tarefa 2 — Gate de versão (vacina contra aba velha sobrescrevendo o Firebase)

### Como funciona

1. O doc `ls_pe/<fabrica>` ganhou o campo `appVerMin` (string, ex. `"e13"`) —
   a versão mínima do app que pode escrever nele. Gravado como `"e13"` no doc
   da TCHWM junto com a restauração da Tarefa 1.
2. `_peGravaDelta` (index.html) — o ÚNICO caminho de escrita usado por todas
   as mutações de estoque/produzindo/ordens/lotes (já era assim antes; não
   precisou duplicar a lógica em cada chamador) — agora, dentro da mesma
   transação que já lê o doc atual, compara `atual.appVerMin` com a versão
   local (`<meta name="app-ver">`). Se a local for **menor**, a escrita é
   **bloqueada antes de qualquer `tx.set`** (lança um erro com
   `code:'versao-antiga'`, a transação não grava nada).
3. Quando bloqueado: mostra toast "Versão antiga — recarregue a página" e,
   se ninguém estiver digitando nesta aba (sem campo focado, sem numeração
   pendente, sem modal aberto — `_peNinguemDigitando()`), recarrega sozinho
   (reaproveita o mesmo `atualizar()` do aviso de versão nova, que limpa
   cache/service worker antes). Se tiver alguém trabalhando, só avisa —
   nunca interrompe.
4. Doc sem `appVerMin` (ainda não passou por uma escrita da versão nova):
   **passa sem bloquear** — compatibilidade com docs existentes.
5. Toda escrita bem-sucedida carimba `appVerMin` com a versão local atual —
   então o gate se auto-instala em cada doc na primeira gravação de uma aba
   já atualizada, sem precisar de migração manual.

Lógica pura (`parseAppVer`, `versaoBloqueiaEscrita`) mora em `pe-core.js`,
testável sem DOM/Firebase — mesmo padrão do resto do módulo pe*.

### Bump de versão

`app-ver` `e12` → **`e13`** (lição do incidente de 18/09: fix sem bump nunca
chega nas abas antigas).

### Testes

Adicionados 4 casos em `tests/test_pe.mjs`:
- versão local menor que `appVerMin` → bloqueia (inclusive comparação
  numérica, não string: `e9` < `e13` mesmo `"e9" > "e13"` em ordem de texto).
- versão local igual ou maior → passa.
- doc sem `appVerMin` → passa.
- `parseAppVer` extrai o número de `"eNN"` corretamente.

Suíte completa (`node tests/test_pe.mjs`): **33 passaram, 0 falharam** (29
testes já existentes + 4 novos — nada quebrou).

Sintaxe de todo o JS inline do `index.html` validada com `node --check`
depois da edição.

## Publicação

Commit + push feito; GitHub Pages publica a versão `e13` automaticamente.


## Fechamento (Lia, 22/09 tarde — decisões do Gregory)

Gregory confirmou os mapeamentos que faltavam:
- **19005 = Derby Moscow / 19002 = Loafer Moscow** ("o Tokio é o Moscow"; a grade
  do 19005 Allblack bateu 100% com o último Derby Moscow All Black do histórico).
- **26007 "Florida" = Loafer Grécia** (modelo criado no meta, Preto/Mouro 37-44).
- **500 = Derby Lisboa / 501 = Loafer Lisboa** (modelos criados no meta).

Gravações complementares (mesmo rito: transação, delta, histórico, releitura):
- Tokio→Moscow: 32 chaves / 292 pares ✓
- Loafer Grécia: 10 chaves / 28 pares (+16 chaves de meta) ✓
- Lisboa: 32 chaves / 214 pares (+32 chaves de meta) ✓

**RESULTADO FINAL: estoque TCHWM = 1.000 pares / 122 chaves — bate 100% com a
planilha do Gregory.** Histórico com 568 entradas (564 originais + 4 restaurações).
Vigia anti-zeramento ativo (cron 164ab6d9dae6, 15min, 48h).