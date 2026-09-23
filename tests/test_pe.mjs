// Node puro, sem framework: node tests/test_pe.mjs
// Cobre a lógica pura extraída em pe-core.js (ver index.html pe*).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PECore = require('../pe-core.js');

const DEL = Symbol('delete'); // sentinela de "apagar campo", no lugar de firebase.firestore.FieldValue.delete()

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { falhou++; console.log('FALHOU ' + nome + '\n       ' + (e && e.message)); }
}

console.log('digitação simultânea em 2 abas (montarGravacao)');
teste('duas abas editando chaves diferentes: as duas sobrevivem', () => {
  // servidor começa com A=5
  var servidor = { estoque: { A: 5 }, atualizadoEm: 1000 };
  // aba 1 via A=5 (mesmo estado) e digita B=10 (chave nova)
  var baseAba1 = { estoque: { A: 5 }, _syncEm: 1000 };
  var payloadAba1 = { estoque: { A: 5, B: 10 } };
  var out1 = PECore.montarGravacao(payloadAba1, baseAba1, servidor, DEL);
  assert.deepEqual(out1.estoque, { B: 10 }); // só a chave que mudou
  // aplica no "servidor"
  servidor = { estoque: { A: 5, B: 10 }, atualizadoEm: 1001 };
  // aba 2 (mesma visão inicial que a aba 1, NÃO viu o B=10 ainda) digita C=7
  var baseAba2 = { estoque: { A: 5 }, _syncEm: 1000 };
  var payloadAba2 = { estoque: { A: 5, C: 7 } };
  var out2 = PECore.montarGravacao(payloadAba2, baseAba2, servidor, DEL);
  assert.deepEqual(out2.estoque, { C: 7 }); // não mexe em B, que ela nem viu
});

teste('aba velha (base desatualizada) não apaga lançamento novo de outra aba', () => {
  // TCHWM: doc tinha 852 pares lançados por uma aba nova (atualizadoEm recente).
  // Uma aba velha, com _syncEm de antes desse lançamento, tenta salvar sem
  // conhecer a chave nova — não pode emitir delete pra ela.
  var servidorAgora = { estoque: { novo: 852, velho: 3 }, atualizadoEm: 5_000_000 };
  var baseAbaVelha = { estoque: { velho: 3 }, _syncEm: 1_000_000 }; // sync bem antigo
  var payloadAbaVelha = { estoque: { velho: 0 } }; // ela apagou o campo "velho" (dela)
  var out = PECore.montarGravacao(payloadAbaVelha, baseAbaVelha, servidorAgora, DEL);
  assert.equal(out.estoque.novo, undefined, '"novo" não pode ser tocado, muito menos apagado');
  assert.equal(out.estoque.velho, 0, 'a edição real da aba velha (o campo que ela via) ainda vale');
});

teste('aba em dia (_syncEm recente) pode apagar chave que sumiu da sua visão', () => {
  var servidor = { estoque: { A: 5 }, atualizadoEm: 1000 };
  var base = { estoque: { A: 5, B: 3 }, _syncEm: 1000 }; // ela via A e B
  var payload = { estoque: { A: 5 } }; // e agora só manda A: B zerou (dirty apagou)
  var out = PECore.montarGravacao(payload, base, servidor, DEL);
  assert.equal(out.estoque.B, DEL);
});

teste('mesma chave editada por duas abas: última vence, e o historico registraria as duas (diffs não-vazios)', () => {
  // aba 1 e aba 2 partem do mesmo estado (A:5), cada uma edita A pra um valor diferente
  var servidor = { estoque: { A: 5 }, atualizadoEm: 1000 };
  var base = { estoque: { A: 5 }, _syncEm: 1000 };
  var out1 = PECore.montarGravacao({ estoque: { A: 8 } }, base, servidor, DEL);
  assert.deepEqual(out1.estoque, { A: 8 });
  var mud1 = PECore.peDiffMapas(servidor.estoque, { A: 8 });
  assert.equal(mud1.length, 1, 'aba 1 gera entrada no historico');
  // servidor agora está em A:8 (gravação da aba 1 já aplicada)
  servidor = { estoque: { A: 8 }, atualizadoEm: 1001 };
  var out2 = PECore.montarGravacao({ estoque: { A: 3 } }, base, servidor, DEL);
  assert.deepEqual(out2.estoque, { A: 3 }, 'a última gravação (aba 2) vence — valor final é o dela');
  var mud2 = PECore.peDiffMapas(servidor.estoque, { A: 3 });
  assert.equal(mud2.length, 1, 'aba 2 também gera sua própria entrada — as duas edições ficam no historico');
});

console.log('replay de fila pendente após reconexão (_peFilaRebase / idempotência)');
teste('reenviar a mesma operação (mesmo base/payload) depois que o servidor já aplicou não duplica o efeito', () => {
  // simula: aba ficou offline, gravou {B:10} na fila; a rede caiu DEPOIS que o
  // Firestore já tinha confirmado (ex.: resposta perdida) — o rebase reenvia o
  // mesmo payload/base contra o estado atual do servidor (_peFilaRebase chama
  // _peGravaDelta de novo com o MESMO base/payload guardado na fila).
  var base = { estoque: { A: 5 }, _syncEm: 1000 };
  var payload = { estoque: { A: 5, B: 10 } };
  var servidorAntes = { estoque: { A: 5 }, atualizadoEm: 1000 };
  var out1 = PECore.montarGravacao(payload, base, servidorAntes, DEL);
  assert.deepEqual(out1.estoque, { B: 10 });
  var servidorDepoisDoPrimeiro = { estoque: { A: 5, B: 10 }, atualizadoEm: 1001 }; // já aplicado
  // replay: MESMO base/payload da operação enfileirada — o delta é sempre "valor
  // final" (deltaCampo compara contra a BASE, não incrementa), então reenviar dá
  // o MESMO delta de novo, não um delta cumulativo/dobrado.
  var out2 = PECore.montarGravacao(payload, base, servidorDepoisDoPrimeiro, DEL);
  assert.deepEqual(out2.estoque, { B: 10 }, 'replay manda o mesmo valor final de novo (idempotente por natureza: set, não soma)');
  // aplicando os dois "sets" em sequência no servidor simulado, o resultado final
  // continua 10 — não vira 20 (o que aconteceria se fosse um incremento)
  var servidorFinal = Object.assign({}, servidorDepoisDoPrimeiro.estoque, out2.estoque);
  assert.equal(servidorFinal.B, 10, 'replay não soma/duplica o valor — o segundo set é um no-op efetivo');
});
teste('replay não desfaz o que outra aba gravou numa chave diferente enquanto a operação estava na fila', () => {
  var base = { estoque: { A: 5 }, _syncEm: 1000 };
  var payload = { estoque: { A: 5, B: 10 } }; // operação enfileirada offline
  // enquanto isso, outra aba (online) gravou C:7 — servidor evoluiu
  var servidorComOutraEdicao = { estoque: { A: 5, C: 7 }, atualizadoEm: 2000 };
  var out = PECore.montarGravacao(payload, base, servidorComOutraEdicao, DEL);
  assert.deepEqual(out.estoque, { B: 10 }, 'replay só aplica o que esta operação realmente editou');
  assert.equal(out.estoque.C, undefined, 'C (de outra aba) não é tocado pelo replay');
});

console.log('escrita fantasma (incidente 22/09/2026 — Manutt): campo sem diff não pode zerar o mapa inteiro');
teste('peFabSalvar edita só ESTOQUE: produzindo intocado não entra na gravação (nem como {})', () => {
  // Reproduz exatamente o payload que peFabSalvar manda: estoque+produzindo
  // JUNTOS (mapas completos), mesmo quando só um dos dois foi editado. A
  // fábrica tinha 356 pares reais em produzindo, ninguém mexeu neles.
  var prodReal = { 'a|Preto|37': 100, 'a|Preto|38': 120, 'a|Preto|39': 136 };
  var servidor = { estoque: { x: 1 }, produzindo: prodReal, atualizadoEm: 1000 };
  var base = { estoque: { x: 1 }, produzindo: prodReal, _syncEm: 1000 };
  var payload = { estoque: { x: 1, y: 5 }, produzindo: prodReal }; // só "y" é novo, em estoque
  var out = PECore.montarGravacao(payload, base, servidor, DEL);
  assert.deepEqual(out.estoque, { y: 5 });
  assert.equal('produzindo' in out, false, 'produzindo não pode aparecer no set() — nem como {} (Firestore merge:true trataria {} como "zera o mapa inteiro")');
});
teste('peFabSalvar edita só PRODUZINDO: estoque intocado não entra na gravação', () => {
  var estReal = { 'a|Preto|37': 40, 'a|Preto|38': 60 };
  var servidor = { estoque: estReal, produzindo: { z: 1 }, atualizadoEm: 1000 };
  var base = { estoque: estReal, produzindo: { z: 1 }, _syncEm: 1000 };
  var payload = { estoque: estReal, produzindo: { z: 1, w: 9 } };
  var out = PECore.montarGravacao(payload, base, servidor, DEL);
  assert.deepEqual(out.produzindo, { w: 9 });
  assert.equal('estoque' in out, false);
});
teste('nada mudou em nenhum mapa: gravação não manda estoque/produzindo/meta de jeito nenhum', () => {
  var servidor = { estoque: { a: 1 }, produzindo: { b: 2 }, meta: { c: 3 }, atualizadoEm: 1000 };
  var base = { estoque: { a: 1 }, produzindo: { b: 2 }, meta: { c: 3 }, _syncEm: 1000 };
  var payload = { estoque: { a: 1 }, produzindo: { b: 2 }, meta: { c: 3 }, lorettoEm: 5000 };
  var out = PECore.montarGravacao(payload, base, servidor, DEL);
  assert.deepEqual(out, { lorettoEm: 5000 });
});

console.log('guard-rail: deleção em massa de um mapa aborta a gravação (pedido Gregory 22/09/2026)');
teste('apagar >30% das chaves não-zero de um mapa de uma vez lança erro e não grava nada', () => {
  var prodReal = {}; for (var i = 0; i < 10; i++) prodReal['k' + i] = 10 + i; // 10 chaves não-zero
  var servidor = { produzindo: prodReal, atualizadoEm: 1000 };
  var base = { produzindo: prodReal, _syncEm: 1000 }; // aba em dia — pode gerar delete
  var payload = { produzindo: { k0: 10, k1: 11, k2: 12 } }; // sumiram 7 de 10 chaves (70%)
  assert.throws(() => PECore.montarGravacao(payload, base, servidor, DEL), function(e) {
    return e.code === 'delecao-suspeita';
  });
});
teste('apagar poucas chaves (edição real, abaixo de 30%) passa normalmente', () => {
  var prodReal = {}; for (var i = 0; i < 10; i++) prodReal['k' + i] = 10 + i;
  var servidor = { produzindo: prodReal, atualizadoEm: 1000 };
  var base = { produzindo: prodReal, _syncEm: 1000 };
  var payload = Object.assign({}, prodReal); delete payload.k9; // 1 de 10 (10%)
  var out = PECore.montarGravacao({ produzindo: payload }, base, servidor, DEL);
  assert.equal(out.produzindo.k9, DEL);
});
teste('mapa pequeno (menos de 5 chaves não-zero) não aciona o guard-rail mesmo apagando tudo', () => {
  // evita falso-positivo em fábricas pequenas/começando: exclusão legítima de
  // um lote pequeno não pode ficar bloqueada pelo guard-rail.
  var base = { produzindo: { a: 1, b: 2 }, _syncEm: 1000 };
  var servidor = { produzindo: { a: 1, b: 2 }, atualizadoEm: 1000 };
  var out = PECore.montarGravacao({ produzindo: {} }, base, servidor, DEL);
  assert.deepEqual(out.produzindo, { a: DEL, b: DEL });
});

console.log('re-render durante digitação (devePularRenderFabrica)');
teste('pula render com campo da grade focado', () => {
  assert.equal(PECore.devePularRenderFabrica(true, false), true);
});
teste('pula render com dirty pendente mesmo sem foco (ex.: stepper +/-)', () => {
  assert.equal(PECore.devePularRenderFabrica(false, true), true);
});
teste('renderiza normalmente quando não tem foco nem dirty pendente', () => {
  assert.equal(PECore.devePularRenderFabrica(false, false), false);
});

console.log('lote registrado → produzindo populado (aplicarProducao)');
teste('colocar grade em produção soma em produzindo e cria o lote', () => {
  var atual = { produzindo: { 'x|Preto|38': 2 } };
  var r = PECore.aplicarProducao(atual, {}, { 'x|Preto|38': 10, 'x|Preto|39': 5 }, { nome: 'Lote A' }, 'Manutt', 1_700_000);
  assert.deepEqual(r.produzindo, { 'x|Preto|38': 12, 'x|Preto|39': 5 });
  assert.equal(r.lotesProducao.length, 1);
  assert.equal(r.lotesProducao[0].aplicado, false);
  assert.deepEqual(r.lotesProducao[0].grade, { 'x|Preto|38': 10, 'x|Preto|39': 5 });
});
teste('lote pronto tira de produzindo e soma em estoque', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var loteId = prod.lotesProducao[0].id;
  var r = PECore.aplicarLotePronto({ estoque: { 'x|Preto|38': 3 }, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao }, {}, loteId, 2);
  assert.equal(r.estoque['x|Preto|38'], 13);
  assert.equal(r.produzindo['x|Preto|38'], undefined);
  assert.equal(r.lotesProducao[0].aplicado, true);
});
teste('marcar lote já aplicado como pronto de novo não faz nada (idempotente)', () => {
  var prod = PECore.aplicarProducao({}, {}, { k: 1 }, {}, 'q', 1);
  var loteId = prod.lotesProducao[0].id;
  var r1 = PECore.aplicarLotePronto({ produzindo: prod.produzindo, lotesProducao: prod.lotesProducao }, {}, loteId, 2);
  var r2 = PECore.aplicarLotePronto({ produzindo: r1.produzindo, lotesProducao: r1.lotesProducao }, {}, loteId, 3);
  assert.equal(r2, null);
});

console.log('recebimento parcial (aplicarRecebimento)');
teste('recebe parte do lote: resto continua em produzindo', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var loteId = prod.lotesProducao[0].id;
  var doc = { estoque: {}, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao };
  var r = PECore.aplicarRecebimento(doc, {}, loteId, { 'x|Preto|38': 4 }, 'entrada', 'Manutt', 2);
  assert.equal(r.estoque['x|Preto|38'], 4);
  assert.equal(r.produzindo['x|Preto|38'], 6);
  assert.equal(r.faltaTot, 6);
  var lote = r.lotesProducao.find(l => l.id === loteId);
  assert.equal(lote.aplicado, false); // ainda falta, não fecha sozinho
});
teste('fechar lote com sobra desiste do que falta (não fica represado)', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var loteId = prod.lotesProducao[0].id;
  var doc = { estoque: {}, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao };
  var r = PECore.aplicarRecebimento(doc, {}, loteId, { 'x|Preto|38': 4 }, 'fechar', 'Manutt', 2);
  assert.equal(r.estoque['x|Preto|38'], 4);
  assert.equal(r.produzindo['x|Preto|38'], undefined, 'fechar não deixa resíduo em produzindo');
  var lote = r.lotesProducao.find(l => l.id === loteId);
  assert.equal(lote.aplicado, true);
  assert.equal(lote.finalizadoParcial, true);
  assert.deepEqual(lote.faltou, { 'x|Preto|38': 6 });
});
teste('receber tudo de uma vez fecha o lote automaticamente', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var loteId = prod.lotesProducao[0].id;
  var doc = { estoque: {}, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao };
  var r = PECore.aplicarRecebimento(doc, {}, loteId, { 'x|Preto|38': 10 }, 'entrada', 'Manutt', 2);
  var lote = r.lotesProducao.find(l => l.id === loteId);
  assert.equal(lote.aplicado, true);
  assert.equal(lote.finalizadoParcial, undefined);
});

console.log('write-back do doc legado (mergeLegado)');
teste('doc principal vazio, legado com dados: migra e AUTORIZA gravar de volta', () => {
  var d = {};
  var dl = { estoque: { A: 5 }, produzindo: {}, meta: {} };
  var r = PECore.mergeLegado(d, dl);
  assert.deepEqual(r.merged.estoque, { A: 5 });
  assert.equal(r.deveGravarLegado, true);
});
teste('doc principal já tem dados novos: NUNCA regrava por cima (incidente 17/09/2026)', () => {
  var d = { estoque: { A: 852 } }; // lançamento novo, real
  var dl = { estoque: { A: 3 } };  // doc legado, velho
  var r = PECore.mergeLegado(d, dl);
  assert.deepEqual(r.merged.estoque, { A: 852 }, 'usa o principal, não o legado');
  assert.equal(r.deveGravarLegado, false, 'não pode regravar — apagaria os 852 pares');
});
teste('nenhum dos dois tem dados: não tenta migrar nada', () => {
  var r = PECore.mergeLegado({}, {});
  assert.equal(r.deveGravarLegado, false);
});

console.log('funções auxiliares (peTotaisOrdens / peMigraOrdens / peDiffMapas)');
teste('peTotaisOrdens soma só pedido e producao, ignora outros status', () => {
  var t = PECore.peTotaisOrdens([
    { status: 'pedido', grade: { A: 2 } },
    { status: 'producao', grade: { A: 3 } },
    { status: 'enviado', grade: { A: 100 } },
  ]);
  assert.deepEqual(t.pedido, { A: 2 });
  assert.deepEqual(t.produzindo, { A: 3 });
});
teste('peMigraOrdens cria ordem migrada só quando tem pedido/produzindo de verdade', () => {
  var ordens = PECore.peMigraOrdens({ pedido: { A: 1 }, produzindo: {} });
  assert.equal(ordens.length, 1);
  assert.equal(ordens[0].status, 'pedido');
});
teste('peDiffMapas só lista o que mudou', () => {
  var out = PECore.peDiffMapas({ A: 5, B: 2 }, { A: 5, B: 3, C: 1 });
  var labels = out.map(x => x.label).sort();
  assert.deepEqual(labels, ['B', 'C']);
});

console.log('toda mudança de produzindo/estoque gera diff pro historico (incidente 18/09/2026 — Manutt)');
// pe-core.js não mexe em Firestore; index.html usa peDiffMapas(antes,depois) pra montar a
// entrada de historico antes de cada _peGravaDelta. Estes testes garantem que as funções
// puras que mudam estoque/produzindo sempre produzem um diff não-vazio — ou seja, que o
// ponto de gravação em index.html (peConfirmarProduzir, peLotePronto, _peReceberAplicar,
// peExcluirLote, peSalvarLote) sempre tem algo pra logar quando algo realmente mudou.
// Isso é o que faltava no incidente: várias dessas funções gravavam no Firestore sem
// passar pelo historico (delete silencioso).
teste('colocar em produção (peConfirmarProduzir) sempre deixa rastro no historico', () => {
  var antesProd = {};
  var r = PECore.aplicarProducao({ produzindo: antesProd }, {}, { 'x|Preto|38': 37 }, {}, 'Manutt', 1);
  var mud = PECore.peDiffMapas(antesProd, r.produzindo);
  assert.equal(mud.length, 1);
  assert.deepEqual(mud[0], { label: 'x|Preto|38', de: 0, para: 37 });
});
teste('lote pronto (peLotePronto) sempre deixa rastro no historico', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var antes = { estoque: {}, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao };
  var r = PECore.aplicarLotePronto(antes, {}, prod.lotesProducao[0].id, 2);
  var mud = PECore.peDiffMapas(antes.estoque, r.estoque).concat(PECore.peDiffMapas(antes.produzindo, r.produzindo));
  assert.equal(mud.length, 2, 'estoque subiu e produzindo desceu — duas mudanças');
});
teste('recebimento de lote (_peReceberAplicar) sempre deixa rastro no historico', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var antes = { estoque: {}, produzindo: prod.produzindo, lotesProducao: prod.lotesProducao };
  var r = PECore.aplicarRecebimento(antes, {}, prod.lotesProducao[0].id, { 'x|Preto|38': 4 }, 'entrada', 'Manutt', 2);
  var mud = PECore.peDiffMapas(antes.estoque, r.estoque).concat(PECore.peDiffMapas(antes.produzindo, r.produzindo));
  assert.equal(mud.length, 2);
});
teste('excluir lote não aplicado devolve pra produzindo (0 → sem chave não conta como mudança fantasma)', () => {
  var prod = PECore.aplicarProducao({}, {}, { 'x|Preto|38': 10 }, {}, 'q', 1);
  var antesProd = prod.produzindo;
  // simula peExcluirLote: tira a grade do lote de produzindo (não estava aplicado)
  var depoisProd = Object.assign({}, antesProd);
  delete depoisProd['x|Preto|38'];
  var mud = PECore.peDiffMapas({}, {}).concat(PECore.peDiffMapas(antesProd, depoisProd));
  assert.equal(mud.length, 1);
  assert.deepEqual(mud[0], { label: 'x|Preto|38', de: 10, para: 0 });
});

console.log('sync de fotos/acesso não apaga dado de outro usuário (incidente Gregory 18/09/2026)');
teste('cache local com ts alto (relógio adiantado) NÃO bloqueia snapshot novo de outro usuário', () => {
  // aparelho com relógio adiantado empurrou uma vez com ts=9_000_000 (guardado no
  // localStorage). Depois disso outro usuário, em aparelho com relógio certo,
  // adicionou uma foto nova e o servidor está em ts=2_000_000 (bem "menor" que o
  // ts salvo localmente, mas é o dado mais novo de verdade).
  var tsDoServidorAgora = 2_000_000;
  var ultimoPushDestaAba = 0; // esta aba não foi quem escreveu por último
  assert.equal(PECore.deveIgnorarSnapshotProprio(tsDoServidorAgora, ultimoPushDestaAba), false,
    'servidor deve ser aplicado — não é eco do próprio push desta aba');
});
teste('snapshot é ignorado só quando é eco do push que a própria aba acabou de mandar', () => {
  var ultimoPushDestaAba = 9_000_000;
  assert.equal(PECore.deveIgnorarSnapshotProprio(9_000_000, ultimoPushDestaAba), true);
  assert.equal(PECore.deveIgnorarSnapshotProprio(9_000_001, ultimoPushDestaAba), false, 'algo mais novo que o próprio push sempre entra');
});
teste('bootstrap NUNCA reinicializa doc compartilhado (fotos/cfg) que já existe no servidor', () => {
  assert.equal(PECore.deveGravarNaInicializacao(true), false, 'doc já existe — não pode ser pisado por um push de cache velho');
});
teste('cliente novo sem cache (doc do servidor ainda não existe) inicializa normalmente', () => {
  assert.equal(PECore.deveGravarNaInicializacao(false), true);
});
teste('acesso/config: servidor ganha em chave que os dois têm (cache velho não ressuscita acesso removido/trocado)', () => {
  var local = { manutt: { usuario: 'antigo@x.com', perfis: ['prod'] } }; // cache velho de dias atrás
  var servidor = { manutt: { usuario: 'novo@x.com', perfis: ['prod', 'admin'] } }; // atualizado por outro aparelho
  var out = PECore.mergePreferindoServidor(local, servidor);
  assert.deepEqual(out.manutt, servidor.manutt);
});
teste('acesso/config: chave só local (ainda não confirmada pelo servidor) não é apagada pela junção', () => {
  var local = { manutt: { usuario: 'a@x.com' }, novaFabricaOffline: { usuario: 'b@x.com' } };
  var servidor = { manutt: { usuario: 'a@x.com' } }; // servidor ainda não viu "novaFabricaOffline"
  var out = PECore.mergePreferindoServidor(local, servidor);
  assert.deepEqual(out.novaFabricaOffline, { usuario: 'b@x.com' });
});
teste('delete explícito (foto removida por ação do usuário) some do push seguinte', () => {
  // Fotos não usam mergePreferindoServidor: repRemoveFoto/cffRemover apagam a
  // chave do mapa em memória e chamam salvaFotos()->repPushFotos(), que sobe o
  // mapa como está — já sem a chave removida. Este teste documenta o contrato
  // que repPushFotos depende dele (a remoção acontece ANTES do push, na função
  // pura que simula a mutação, não dentro de nenhum merge).
  var repFotosAntes = { modeloX: { Preto: 'url1', Branco: 'url2' } };
  var repFotosDepoisDoDelete = JSON.parse(JSON.stringify(repFotosAntes));
  delete repFotosDepoisDoDelete.modeloX.Branco;
  var payloadQueSeriaEnviado = repFotosDepoisDoDelete; // é isto que repPushFotos().set({fotos:...}) manda
  assert.equal(payloadQueSeriaEnviado.modeloX.Branco, undefined);
  assert.equal(payloadQueSeriaEnviado.modeloX.Preto, 'url1', 'a outra cor do mesmo modelo não é afetada pelo delete');
});

console.log('gate de versão (incidente TCHWM 22/09/2026: aba velha zerou o estoque)');
teste('versão local menor que appVerMin do servidor -> escrita bloqueada', () => {
  assert.equal(PECore.versaoBloqueiaEscrita('e13', 'e12'), true);
  assert.equal(PECore.versaoBloqueiaEscrita('e13', 'e9'), true, 'compara número, não string (e9 < e13 mesmo "e9">"e13" em string)');
});
teste('versão local igual ou maior que appVerMin do servidor -> passa', () => {
  assert.equal(PECore.versaoBloqueiaEscrita('e13', 'e13'), false);
  assert.equal(PECore.versaoBloqueiaEscrita('e13', 'e14'), false);
});
teste('doc sem appVerMin -> passa (compatibilidade com docs existentes)', () => {
  assert.equal(PECore.versaoBloqueiaEscrita(undefined, 'e1'), false);
  assert.equal(PECore.versaoBloqueiaEscrita('', 'e1'), false);
});
teste('parseAppVer extrai o número de "eNN"', () => {
  assert.equal(PECore.parseAppVer('e13'), 13);
  assert.equal(PECore.parseAppVer(''), 0);
  assert.equal(PECore.parseAppVer(undefined), 0);
});

console.log('gate TOTAL de UI (incidente 22/09/2026: Manutt zerada de novo, sem log no historico)');
teste('leitura do appVerMin deu certo e versão local está atrás -> trava a tela', () => {
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e13', true), true);
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e9', true), true);
});
teste('leitura deu certo e versão local está em dia -> não trava', () => {
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e14', true), false);
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e15', true), false);
  assert.equal(PECore.deveMostrarGateTotal(undefined, 'e1', true), false);
});
teste('leitura do appVerMin FALHOU (offline/erro) -> nunca trava, mesmo com versão velha', () => {
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e13', false), false);
  assert.equal(PECore.deveMostrarGateTotal('e14', 'e1', false), false);
});

console.log('reimpressão de etiquetas (pedido Gregory 23/09/2026: botão pra reimprimir lote/produzindo depois de lançado)');
teste('gradeDoLotePorId acha o lote certo pelo id e devolve a grade dele', () => {
  var lotes = [
    { id: 'lp1', grade: { 'm1|Preto|38': 10, 'm1|Preto|39': 20 } },
    { id: 'lp2', grade: { 'm2|Branco|40': 5 } }
  ];
  assert.deepEqual(PECore.gradeDoLotePorId(lotes, 'lp2'), { 'm2|Branco|40': 5 });
});
teste('gradeDoLotePorId funciona pra lote já aplicado (recebido/no estoque) — reimpressão pós-lançamento', () => {
  var lotes = [{ id: 'lp1', grade: { 'm1|Preto|38': 10 }, aplicado: true, aplicadoEm: Date.now() }];
  assert.deepEqual(PECore.gradeDoLotePorId(lotes, 'lp1'), { 'm1|Preto|38': 10 });
});
teste('gradeDoLotePorId devolve null se o lote não existe (index.html mostra o toast)', () => {
  assert.equal(PECore.gradeDoLotePorId([{ id: 'lp1', grade: {} }], 'lp-inexistente'), null);
  assert.equal(PECore.gradeDoLotePorId([], 'lp1'), null);
  assert.equal(PECore.gradeDoLotePorId(undefined, 'lp1'), null);
});
teste('gradeDoLotePorId devolve cópia da grade — não é a mesma referência do lote', () => {
  var lote = { id: 'lp1', grade: { 'm1|Preto|38': 10 } };
  var g = PECore.gradeDoLotePorId([lote], 'lp1');
  g['m1|Preto|38'] = 999;
  assert.equal(lote.grade['m1|Preto|38'], 10, 'mexer na grade devolvida não pode mudar o lote original');
});
teste('gradeProduzindoAtual filtra só as chaves com qtd > 0 (produção digitada direto na grade, sem lote)', () => {
  var produzindo = { 'm1|Preto|38': 5, 'm1|Preto|39': 0, 'm2|Branco|40': -3 };
  assert.deepEqual(PECore.gradeProduzindoAtual(produzindo), { 'm1|Preto|38': 5 });
});
teste('gradeProduzindoAtual com mapa vazio/undefined devolve {} (botão "produzindo atual" some nesse caso)', () => {
  assert.deepEqual(PECore.gradeProduzindoAtual({}), {});
  assert.deepEqual(PECore.gradeProduzindoAtual(undefined), {});
});

console.log('\n' + passou + ' passaram, ' + falhou + ' falharam');
process.exit(falhou ? 1 : 0);
