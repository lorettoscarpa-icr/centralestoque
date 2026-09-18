/* pe-core.js — lógica pura do módulo pronta-entrega (pe*), sem DOM/Firebase.
   Extraído do index.html pra poder ser testado com Node puro (tests/test_pe.mjs)
   e pra ter UM SÓ lugar com as regras de gravação por delta — o index.html
   chama estas funções em vez de duplicar a lógica. */
(function(root){
  'use strict';

  function peDiffMapas(ant,nov){
    var out=[],ks={};
    Object.keys(ant||{}).forEach(function(k){ks[k]=1;});
    Object.keys(nov||{}).forEach(function(k){ks[k]=1;});
    Object.keys(ks).forEach(function(k){
      var a=parseInt((ant||{})[k])||0,b=parseInt((nov||{})[k])||0;
      if(a!==b)out.push({label:k,de:a,para:b});
    });
    return out;
  }

  function peTotaisOrdens(ordens){
    var ped={},prod={};
    (ordens||[]).forEach(function(o){
      if(!o||!o.grade)return;
      var tgt=o.status==='pedido'?ped:(o.status==='producao'?prod:null);
      if(!tgt)return;
      Object.keys(o.grade).forEach(function(k){var q=parseInt(o.grade[k])||0;if(q>0)tgt[k]=(tgt[k]||0)+q;});
    });
    return {pedido:ped,produzindo:prod};
  }

  function peMigraOrdens(d){
    var ordens=[],ped=(d&&d.pedido)||{},prod=(d&&d.produzindo)||{};
    var hasP=Object.keys(ped).some(function(k){return (parseInt(ped[k])||0)>0;});
    var hasR=Object.keys(prod).some(function(k){return (parseInt(prod[k])||0)>0;});
    if(hasP)ordens.push({id:'mig-ped',criadoEm:((d&&(d.pedidoAvisoEm||d.atualizadoEm))||Date.now()),status:'pedido',producaoEm:0,recebidoEm:0,grade:Object.assign({},ped),por:'(migrado)'});
    if(hasR)ordens.push({id:'mig-prod',criadoEm:((d&&d.atualizadoEm)||Date.now()),status:'producao',producaoEm:((d&&d.atualizadoEm)||Date.now()),recebidoEm:0,grade:Object.assign({},prod),por:'(migrado)'});
    return ordens;
  }

  function temDadosFabrica(x){
    return !!(x&&((Object.keys(x.estoque||{}).length)||((x.ordens||[]).length)||(Object.keys(x.meta||{}).length)||(Object.keys(x.produzindo||{}).length)));
  }

  /* delta de UM mapa (estoque/produzindo/meta): só entram chaves cujo valor mudou.
     DEL (sentinela de "apagar", ex.: firebase.firestore.FieldValue.delete()) só é
     usado se for passado — chamador decide se pode apagar (ver montarGravacao). */
  function deltaCampo(base,novo,DEL){
    base=base||{};novo=novo||{};var d={};
    Object.keys(novo).forEach(function(k){ if((parseInt(novo[k],10)||0)!==(parseInt(base[k],10)||0)) d[k]=novo[k]; });
    if(DEL!=null) Object.keys(base).forEach(function(k){ if(!(k in novo)) d[k]=DEL; });
    return d;
  }

  /* Monta o objeto final gravado no Firestore (set com merge:true).
     - payload: o que ESTA sessão quer gravar (mapas completos: base + edições dela)
     - base: o que ESTA sessão via como estado anterior (pra saber o que ela mudou)
     - atual: o estado do documento agora mesmo no servidor (lido dentro da transação)
     PROTEÇÃO (incidente 17/09/2026): só emite delete de uma chave se a visão desta
     sessão estiver em dia com o banco (atual.atualizadoEm <= base._syncEm + 2s).
     Se outra aba/dispositivo atualizou depois do último sync desta tela, os deletes
     são descartados — nunca apaga dado que esta tela nem chegou a ver. Os SETS de
     valor não têm essa restrição porque só existem para chaves que esta sessão
     realmente editou (dirty), então nunca pisam em chave alheia. */
  function montarGravacao(payload,base,atual,DEL){
    payload=payload||{};base=base||{};atual=atual||{};
    var baseSync=base._syncEm||0;
    var podeDel=!baseSync||((atual.atualizadoEm||0)<=baseSync+2000);
    var out={};
    Object.keys(payload).forEach(function(campo){
      if(campo==='estoque'||campo==='produzindo'||campo==='meta'){
        out[campo]=deltaCampo(base[campo],payload[campo],podeDel?DEL:null);
      } else out[campo]=payload[campo];
    });
    return out;
  }

  /* Junta o doc principal (d) com o doc legado (dl) e decide se vale a pena
     regravar o principal com o resultado da migração.
     PROTEÇÃO (incidente 17/09/2026): só regrava se o doc principal estiver REALMENTE
     vazio — nunca por cima de um doc que já tem dados (foi isso que apagou 852
     pares da TCHWM: o write-back usava um "d" lido antes do lançamento novo). */
  function mergeLegado(d,dl){
    d=d||{};dl=dl||{};
    var merged={
      estoque:(Object.keys(d.estoque||{}).length?d.estoque:(dl.estoque||{})),
      produzindo:(Object.keys(d.produzindo||{}).length?d.produzindo:(dl.produzindo||{})),
      meta:(('meta' in d)?(d.meta||{}):(dl.meta||{})),
      ordens:((Array.isArray(d.ordens)&&d.ordens.length)?d.ordens:(Array.isArray(dl.ordens)?dl.ordens:((dl.estoque||dl.meta||dl.pedido)?peMigraOrdens(dl):[]))),
      historico:((d.historico&&d.historico.length)?d.historico:(dl.historico||[])),
      lotesProducao:((Array.isArray(d.lotesProducao)&&d.lotesProducao.length)?d.lotesProducao:(Array.isArray(dl.lotesProducao)?dl.lotesProducao:[])),
      etqLayout:(d.etqLayout||dl.etqLayout||null),
      atualizadoEm:d.atualizadoEm||dl.atualizadoEm||0,publicadoEm:d.publicadoEm||dl.publicadoEm||0,lorettoEm:d.lorettoEm||dl.lorettoEm||0,lorettoPor:d.lorettoPor||dl.lorettoPor||''
    };
    return {merged:merged,deveGravarLegado:temDadosFabrica(dl)&&!temDadosFabrica(d)};
  }

  /* Coloca uma grade em produção: soma ao mapa "produzindo" e registra o lote
     (não mexe em estoque). */
  function aplicarProducao(dAtual,cacheFallback,grade,extra,quem,agora){
    dAtual=dAtual||{};cacheFallback=cacheFallback||{};extra=extra||{};agora=agora||Date.now();
    var prod=Object.assign({},dAtual.produzindo||cacheFallback.produzindo||{});
    Object.keys(grade||{}).forEach(function(k){prod[k]=(parseInt(prod[k])||0)+(parseInt(grade[k])||0);});
    var lotes=(Array.isArray(dAtual.lotesProducao)?dAtual.lotesProducao.slice():((cacheFallback.lotesProducao||[]).slice()));
    var lote={id:'lp'+agora,grade:grade,nome:extra.nome||'',inicioEm:extra.inicioEm||agora,criadoEm:agora,prontoEm:extra.prontoEm||agora,por:quem||'',aplicado:false};
    lotes.push(lote);
    return {produzindo:prod,lotesProducao:lotes,lote:lote};
  }

  /* Marca um lote como pronto: tira de "produzindo", soma em "estoque".
     Retorna null se o lote não existe ou já estava aplicado (idempotente). */
  function aplicarLotePronto(dAtual,cacheFallback,loteId,agora){
    dAtual=dAtual||{};cacheFallback=cacheFallback||{};agora=agora||Date.now();
    var est=Object.assign({},dAtual.estoque||cacheFallback.estoque||{});
    var prod=Object.assign({},dAtual.produzindo||cacheFallback.produzindo||{});
    var lotes=(Array.isArray(dAtual.lotesProducao)?dAtual.lotesProducao:(cacheFallback.lotesProducao||[])).map(function(x){return Object.assign({},x);});
    var l=lotes.find(function(x){return x.id===loteId;});
    if(!l||l.aplicado)return null;
    Object.keys(l.grade||{}).forEach(function(k){
      var q=parseInt(l.grade[k])||0;if(q<=0)return;
      est[k]=(parseInt(est[k])||0)+q;
      prod[k]=Math.max(0,(parseInt(prod[k])||0)-q);if(!prod[k])delete prod[k];
    });
    l.aplicado=true;l.aplicadoEm=agora;
    return {estoque:est,produzindo:prod,lotesProducao:lotes};
  }

  /* Recebimento (total ou parcial) de um lote: some ao estoque o que chegou,
     tira de "produzindo". modo==='fechar' desiste do que não veio (não fica
     represado em "produzindo" pra sempre). */
  function aplicarRecebimento(dAtual,cacheFallback,loteId,receb,modo,quem,agora){
    dAtual=dAtual||{};cacheFallback=cacheFallback||{};receb=receb||{};agora=agora||Date.now();
    var est=Object.assign({},dAtual.estoque||cacheFallback.estoque||{});
    var prod=Object.assign({},dAtual.produzindo||cacheFallback.produzindo||{});
    var lotes=(Array.isArray(dAtual.lotesProducao)?dAtual.lotesProducao:(cacheFallback.lotesProducao||[])).map(function(x){return Object.assign({},x);});
    var l=lotes.find(function(x){return x.id===loteId;});
    if(!l||l.aplicado)return null;
    var rcv=Object.assign({},l.recebido||{});var totReceb=0;
    Object.keys(receb).forEach(function(k){
      var q=parseInt(receb[k])||0;if(q<=0)return;
      est[k]=(parseInt(est[k])||0)+q;
      prod[k]=Math.max(0,(parseInt(prod[k])||0)-q);if(!prod[k])delete prod[k];
      rcv[k]=(parseInt(rcv[k])||0)+q;totReceb+=q;
    });
    l.recebido=rcv;
    if(totReceb>0){l.recebidos=(l.recebidos||[]).concat([{em:agora,por:quem||'',qtd:receb,total:totReceb}]);l.recebidoEm=agora;l.recebidoPor=quem||'';}
    var pend={},faltaTot=0;
    Object.keys(l.grade||{}).forEach(function(k){var p=(parseInt(l.grade[k])||0)-(parseInt(rcv[k])||0);if(p>0){pend[k]=p;faltaTot+=p;}});
    if(modo==='fechar'){
      if(faltaTot>0){Object.keys(pend).forEach(function(k){var q=pend[k];prod[k]=Math.max(0,(parseInt(prod[k])||0)-q);if(!prod[k])delete prod[k];});l.finalizadoParcial=true;l.faltou=pend;}
      l.aplicado=true;l.aplicadoEm=agora;
    }else if(faltaTot<=0){l.aplicado=true;l.aplicadoEm=agora;}
    return {estoque:est,produzindo:prod,lotesProducao:lotes,totReceb:totReceb,faltaTot:faltaTot};
  }

  /* Guarda contra o modo fábrica perder edição em andamento (incidente 18/09/2026):
     nunca redesenha a grade (o que apaga o valor sendo digitado e o marcador
     "dirty" do que ainda não foi salvo) enquanto o usuário está com foco num campo
     da grade OU existe algum campo dirty pendente de salvar em qualquer lugar da
     tela (ex.: o botão +/- do stepper mexeu num campo sem focar nele). */
  function devePularRenderFabrica(focadoEmCampo,existeDirtyPendente){
    return !!(focadoEmCampo||existeDirtyPendente);
  }

  var PECore={
    peDiffMapas:peDiffMapas,
    peTotaisOrdens:peTotaisOrdens,
    peMigraOrdens:peMigraOrdens,
    temDadosFabrica:temDadosFabrica,
    deltaCampo:deltaCampo,
    montarGravacao:montarGravacao,
    mergeLegado:mergeLegado,
    aplicarProducao:aplicarProducao,
    aplicarLotePronto:aplicarLotePronto,
    aplicarRecebimento:aplicarRecebimento,
    devePularRenderFabrica:devePularRenderFabrica
  };

  if(typeof module!=='undefined'&&module.exports) module.exports=PECore;
  else root.PECore=PECore;
})(typeof window!=='undefined'?window:globalThis);
