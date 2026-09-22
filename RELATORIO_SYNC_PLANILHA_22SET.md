# Sistema tipo Google Planilhas — 22/09/2026

## O pedido

"Pesquisa como funciona o Google Planilhas e o Excel: várias pessoas
conseguem mexer ao mesmo tempo, até em versões diferentes, e funciona. Quero
que o nosso sistema funcione de forma parecida."

## O defeito de nascença

O sistema antigo gravava o **estado inteiro** (o mapa completo de
estoque/produzindo de uma fábrica) toda vez que alguém salvava, em vez de
gravar só a célula que a pessoa mexeu. É o oposto do Google Planilhas: lá,
editar a célula B3 nunca manda a planilha inteira pro servidor, só manda
"B3 = 42". No nosso sistema antigo, se uma aba estivesse com dados velhos ou
zerados na tela (por exemplo, ficou aberta demais e o cache travou), ela
podia mandar aquele estado velho por cima do que os outros já tinham salvo —
foi isso que causou os zeramentos da TCHWM e da Manutt nos últimos dias.

## O que já tinha sido corrigido antes de hoje (sessões anteriores, mesmo dia)

A maior parte da "cura arquitetural" que o Gregory pediu **já tinha sido
construída em sessões anteriores de hoje**, resolvendo os incidentes
conforme eles apareceram:

- **Grava só o que mudou** (não o mapa inteiro) — cada salvamento manda
  apenas as chaves (modelo/cor/tamanho) que a pessoa realmente editou.
- **Todo mundo que edita deixa rastro** — toda mudança de estoque/produção
  aparece no histórico, com quem fez e quando.
- **Duas pessoas editando coisas diferentes ao mesmo tempo não se atrapalham**
  — cada uma só grava o que é dela.
- **Versão velha trava** — se uma aba estiver rodando uma versão antiga do
  sistema (com bugs já corrigidos), ela é bloqueada até atualizar, em vez de
  continuar usando lógica velha por baixo.

## O que fizemos hoje

Fizemos a auditoria completa pedida (ver `AUDITORIA_SYNC_22SET.md`,
comparando o código com os 5 princípios do Google Planilhas) e achamos
**uma lacuna real que tinha sobrado**: se a internet caísse bem no momento em
que alguém estava digitando um número na grade da fábrica, o sistema
"esquecia" que aquele número ainda não tinha sido salvo — e se chegasse
qualquer outra atualização do servidor nesse meio-tempo, o número digitado
podia voltar sozinho pro valor antigo na tela, sem aviso. É o padrão que foi
relatado (o número "voltava" sozinho).

Corrigimos isso com duas mudanças:

1. **O sistema só "esquece" um campo digitado depois que o servidor
   confirma que salvou.** Enquanto não confirma, a tela continua protegida
   e não deixa nada redesenhar por cima.
2. **Fila de pendências**: se uma gravação falhar (sem internet, erro), ela
   fica guardada numa fila local (só a operação, nunca o estado todo) e é
   reenviada sozinha assim que a conexão voltar — sem duplicar, mesmo se for
   reenviada mais de uma vez.

## Por que agora funciona como o Google Planilhas

| Princípio do Sheets/Excel | Como o nosso sistema faz isso agora |
|---|---|
| Manda a operação, não a planilha inteira | Cada salvamento manda só as células (modelo\|cor\|tamanho) que mudaram |
| Servidor é a fonte da verdade | Toda gravação passa por transação no Firestore; histórico registra tudo |
| Células diferentes nunca conflitam | Duas pessoas editando coisas diferentes: as duas ficam salvas |
| Mesma célula: o mais recente vence, com rastro | Cada gravação deixa sua própria entrada no histórico |
| Cache local é só pra exibir, nunca decide quem ganha | Estoque/produção nunca vêm do localStorage — só do servidor |
| Reconectar não perde nem duplica o que ficou pendente | Fila de operações pendentes + reenvio automático ao voltar online |

## O que os testes provam

`node tests/test_pe.mjs` — **39 passaram, 0 falharam** (36 já existentes +
3 novos):

- Aba com estado local zerado não consegue apagar o que outra aba salvou —
  só regrava o que ela mesma editou.
- Duas abas editando chaves diferentes: as duas sobrevivem.
- Mesma chave editada duas vezes: a última vence, e as duas ficam
  registradas no histórico.
- Reenviar a mesma operação (depois de reconectar) não duplica nem soma o
  valor de novo — dá o mesmo resultado final.
- Reenviar uma operação enfileirada não apaga o que outra pessoa gravou numa
  chave diferente enquanto ela estava offline.

Todos os `<script>` do `index.html` foram checados com `node -e "new
Function(...)"` em cada bloco — sem erro de sintaxe.

## Versão

`app-ver` `e14` → `e15`. `appVerMin=e15` já gravado nos 3 docs de fábrica
(Manutt, Tarragona, TCHWM) e em `ls_pe_config/loja` — confirmado por leitura
depois da escrita. Só o campo `appVerMin` (+ uma linha de histórico) foi
tocado; nenhum dado de estoque foi lido nem regravado.

## O que NÃO foi feito (limitações conhecidas)

- A fila de pendências cobre só a coleção principal (`ls_pe` — estoque,
  produção, lotes). Fotos, config e acesso já tinham proteção própria de
  sessões anteriores, mas não passam pela mesma fila/reenvio automático.
- Não existe ainda uma regra do lado do servidor (Firestore Security Rules)
  que impeça alguém de escrever direto pelo console do navegador, ignorando
  todo esse sistema — isso só se resolve fora deste ambiente, já está
  registrado em `PENDENCIAS_GREGORY.md`.
