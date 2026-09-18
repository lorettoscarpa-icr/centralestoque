# Fotos sumindo entre usuários — o que era, o que mudou

## O que estava acontecendo

Quando um usuário salvava uma foto de um modelo, ela ia pra nuvem certinho. O
problema aparecia quando OUTRO usuário abria o painel logo depois, num aparelho
diferente: em vez de só baixar as fotos novas, o painel dele às vezes **reenviava
a lista de fotos que ELE tinha guardada no próprio aparelho**, por cima da lista
que estava na nuvem — apagando as fotos que os outros tinham acabado de adicionar.

A causa era um relógio: cada aparelho guarda, no seu próprio cache, um número que
diz "a última vez que eu mexi nisso foi às tantas". Se esse número ficasse
desatualizado ou "adiantado" por qualquer motivo (cache antigo, aparelho que ficou
muito tempo sem abrir o painel, etc.), o painel se confundia e achava que os dados
DELE eram mais novos que os da nuvem — mesmo não sendo. Aí ele "corrigia" a nuvem
com os dados velhos dele. É basicamente um mal-entendido de quem chegou por
último, só que o critério usado pra decidir "quem é mais novo" não era confiável.

Esse mesmo mal-entendido também acontecia com:
- A configuração de reposição (fábricas, custo, referência de cor);
- A lista de usuários e acessos do painel principal — achamos esse aqui numa
  varredura mais ampla, não foi um sintoma que o Gregory relatou, mas é do
  mesmo tipo e podia causar o mesmo estrago;
- O acesso das fábricas (usuário/senha/perfil de cada uma) e a configuração de
  etiqueta — esse é o outro bug relatado ("cache antigo apaga tudo"): o cache
  velho tinha prioridade sobre o que estava salvo na nuvem, e o painel regravava
  esse cache velho na nuvem toda vez que a loja abria a tela, mesmo sem ninguém
  ter mudado nada de propósito.

## O que mudou

Agora o painel só considera "cache local" como um jeito de mostrar algo na tela
antes da internet responder — nunca mais como critério pra decidir quem está
certo. As regras novas são simples:

- **A nuvem sempre manda.** Se chegou uma atualização de verdade da nuvem, ela é
  aplicada — não importa o que o aparelho tinha guardado antes.
- **Ninguém reenvia o bloco inteiro "por garantia".** O painel só grava um pacote
  inteiro (fotos, config, lista de usuários) na nuvem quando é a PRIMEIRA vez que
  aquele documento é criado, ou quando o próprio usuário fez uma ação de verdade
  (tirou uma foto nova, salvou um acesso, etc.). Nunca mais "só porque abriu o
  painel".
- **Acesso/config de fábrica: a nuvem ganha em caso de conflito**, mas nada que só
  existe localmente (ex.: uma mudança feita agora mesmo, ainda subindo) é
  apagado.

## O que você precisa fazer

**Nada especial.** É só usar o painel normalmente. Na próxima vez que abrir (ou
na próxima vez que ele avisar que tem versão nova — o aviso aparece sozinho), o
fix já está ativo.

Se, por acaso, alguém perceber uma foto ou acesso "faltando" mesmo depois desse
fix, me avisem com a data/hora aproximada — isso ajuda a confirmar se sobrou
algum caso que a gente não pegou.
