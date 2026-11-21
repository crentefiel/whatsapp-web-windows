'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/core/database.cjs');
const {LearningMemory,similarity}=require('../src/core/learning-memory.cjs');
const {AiSettings,AutoResponder}=require('../src/core/ai-replies.cjs');
const A='5511999999999@s.whatsapp.net',B='5511888888888@s.whatsapp.net';
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
function createCase(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-observacao-'));
 const store=new Store(dir),events=[],learning=new LearningMemory(store,k=>events.push(k));
 return{dir,store,learning,events,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function m(jid,id,fromMe,text,timestamp=Date.now()){
 return{jid,id,fromMe,participant:'',senderName:'',type:'text',text,quotedId:null,timestamp};
}
function seed(store,jid=A,t=Date.now()-3600000){
 const question=m(jid,'pergunta-'+jid,false,'Qual o horário de atendimento?',t);
 const answer=m(jid,'resposta-'+jid,true,'Nosso atendimento acontece de segunda a sexta, das 9 às 17 horas.',t+1000);
 store.save(question);store.save(answer);return{question,answer};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('preserva modos no SQLite e inicia em Observação mesmo com IA configurada',()=>{
 const x=createCase();try{
  assert.equal(x.learning.mode(),'observation');
  assert.equal(x.learning.setMode('suggestion'),'suggestion');
  assert.equal(new LearningMemory(x.store).mode(),'suggestion');
  assert.equal(x.learning.setMode('automatic'),'automatic');
  assert.equal(x.learning.setMode('observation'),'observation');
  assert.throws(()=>x.learning.setMode('destruir'),/inválido/);
 }finally{x.close();}
});

test('reconstrói exemplos a partir de TODO o histórico salvo, sem apagar mensagens',()=>{
 const x=createCase();try{
  for(let i=0;i<230;i++){
   const t=Date.now()-200000000+i*180000;
   x.store.save(m(A,'client'+i,false,'Pergunta diferente número '+i+'?',t));
   x.store.save(m(A,'owner'+i,true,'Resposta feita por mim para a pergunta '+i,t+500));
  }
  seed(x.store,B,Date.now()-7200000);
  const before=x.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  const first=x.learning.rebuild();
  assert.equal(first.imported,231,'não deve limitar à visualização recente de 200 mensagens');
  assert.equal(first.total,231);
  assert.equal(x.learning.rebuild().imported,0,'importação idempotente');
  assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,before);
  assert.equal(x.learning.stats().contacts,2);
  assert.equal(x.learning.examples(A,100).length,100);
  assert.equal(x.learning.examples(B).length,1);
 }finally{x.close();}
});

test('observa respostas humanas enviadas pelo WhatsApp Web/celular e distingue mensagens do robô',()=>{
 const x=createCase();try{
  const t=Date.now()-60000,question=m(A,'cliente-novo',false,'Preciso de um orçamento simples',t);
  const human=m(A,'resposta-web',true,'Por favor, envie as medidas e a quantidade.',t+1000);
  x.store.save(question);x.store.save(human);
  assert.equal(x.learning.recordHuman(human,'sincronizacao'),true);
  assert.equal(x.learning.recordHuman(human,'tempo_real'),false);
  assert.equal(x.learning.examples(A).length,1);
  assert.equal(x.learning.examples(B).length,0);
  assert.equal(x.learning.humanHold(A),true);
  const bot=m(A,'resposta-bot',true,'🤖 Vou analisar sua solicitação.',t+2000);
  x.learning.markBot(A,bot.id);x.store.save(bot);
  assert.equal(x.learning.recordHuman(bot,'envio'),false);
  assert.equal(x.learning.examples(A).length,1);
 }finally{x.close();}
});

test('regras e preços observados não viram fatos confirmados sem aprovação',()=>{
 const x=createCase();try{
  seed(x.store);x.learning.rebuild();
  assert.equal(x.learning.stats().approvedRules,0);
  const id=Number(x.learning.addRule('Preço da impressão: R$ 80,00'));
  assert.equal(x.learning.rules(A)[0].state,'draft');
  assert.equal(x.learning.context(A,'Quanto custa?').rules.length,0);
  x.learning.approveRule(id,true);
  assert.equal(x.learning.context(A,'Quanto custa?').rules.length,1);
  assert.equal(x.learning.stats().approvedRules,1);
  x.learning.approveRule(id,false);
  assert.equal(x.learning.context(A,'Quanto custa?').rules.length,0);
  const example=x.learning.examples(A)[0];
  x.learning.sampleUpdate(example.id,{reply:'Responda com cordialidade.',status:'approved'});
  assert.equal(x.learning.stats().approved,1);
  x.learning.sampleUpdate(example.id,{reply:'Resposta incorreta',status:'rejected'});
  assert.equal(x.learning.context(A,'Qual horário?').examples.length,0);
 }finally{x.close();}
});

test('busca exemplos só do cliente correto e avalia similaridade sem misturar conversas',()=>{
 const x=createCase();try{
  seed(x.store,A);seed(x.store,B);x.learning.rebuild();
  assert.equal(x.learning.context(A,'Qual o horário de atendimento?').examples.length,1);
  assert.ok(x.learning.canAuto(A,'Qual o horário de atendimento?').ok);
  assert.ok(!x.learning.canAuto(A,'Qual o preço de impressão de mil adesivos?').ok);
  assert.equal(x.learning.context(B,'Qual o horário de atendimento?').examples.length,1);
  assert.ok(similarity('Qual o horário de atendimento?','Qual o horário de atendimento?')>.99);
 }finally{x.close();}
});

test('modo Observação não chama API nem envia WhatsApp, embora registre exemplos',async()=>{
 const x=createCase();try{
  seed(x.store);x.learning.rebuild();
  const settings=new AiSettings(x.dir,vault);settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  let calls=0,sends=0;
  const client={status:{state:'conectado'},sendText:async()=>{sends++;}};
  const ai=new AutoResponder({settings,client,store:x.store,learning:x.learning,delayMs:1,fetchImpl:async()=>{calls++;}});
  ai.handleIncoming({...m(A,'outro',false,'Qual o horário de atendimento?'),type:'text'},'tempo_real');
  await wait(30);
  assert.equal(calls,0);assert.equal(sends,0);assert.equal(x.learning.mode(),'observation');
  ai.stop();
 }finally{x.close();}
});

test('modo Sugestão gera rascunho editável e jamais envia sem aprovação',async()=>{
 const x=createCase();try{
  x.learning.setMode('suggestion');
  const settings=new AiSettings(x.dir,vault);settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  x.store.save(m(A,'entrada',false,'Tem entrega hoje?'));
  let calls=0,sends=0;
  const client={status:{state:'conectado'},sendText:async()=>{sends++;}};
  const ai=new AutoResponder({settings,client,store:x.store,learning:x.learning,delayMs:1,fetchImpl:async()=>{
   calls++;return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Vou confirmar o horário de entrega.'}}]})};
  }});
  ai.handleIncoming(m(A,'entrada',false,'Tem entrega hoje?'),'tempo_real');
  await wait(80);
  assert.equal(calls,1);assert.equal(sends,0);
  const suggestion=x.learning.suggestion(A);
  assert.equal(suggestion.answer,'Vou confirmar o horário de entrega.');
  assert.equal(suggestion.status,'pending');
  assert.equal(x.learning.finishSuggestion(suggestion.id,A,'Resposta corrigida','approved').question_id,'entrada');
  assert.equal(x.learning.suggestion(A),null);
  ai.stop();
 }finally{x.close();}
});

test('modo Automático só envia com exemplo humano semelhante e não inventa preço',async()=>{
 const x=createCase();try{
  seed(x.store);x.learning.rebuild();x.learning.setMode('automatic');
  const settings=new AiSettings(x.dir,vault);settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  const sent=[];let requests=0;
  const client={status:{state:'conectado'},sendText:async(...args)=>sent.push(args)};
  const ai=new AutoResponder({settings,client,store:x.store,learning:x.learning,delayMs:1,fetchImpl:async()=>{
   requests++;return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Atendemos de segunda a sexta, das 9 às 17 horas.'}}]})};
  }});
  ai.handleIncoming(m(A,'novo',false,'Qual o horário de atendimento?'),'tempo_real');
  await wait(90);
  assert.equal(sent.length,1);
  assert.equal(sent[0][2],'ai','marcar autoria como robô');
  assert.ok(requests>=1);
  ai.handleIncoming(m(B,'outra',false,'Qual o horário de atendimento?'),'tempo_real');
  await wait(40);
  assert.equal(sent.length,1,'contato sem histórico próprio não deve receber resposta automática');
  ai.fetch=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Custa R$ 120,00.'}}]})});
  ai.lastSent.clear();
  ai.handleIncoming(m(A,'preco',false,'Qual o horário de atendimento?'),'tempo_real');
  await wait(60);
  assert.equal(sent.length,1,'preço observado mas não aprovado não pode ser anunciado');
  ai.stop();
 }finally{x.close();}
});

test('intervenção humana impede resposta programada e torna sugestão pendente obsoleta',async()=>{
 const x=createCase();try{
  x.learning.setMode('suggestion');
  const settings=new AiSettings(x.dir,vault);settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  x.store.save(m(A,'novo',false,'Preciso de ajuda'));
  let calls=0,sent=0;
  const ai=new AutoResponder({settings,client:{status:{state:'conectado'},sendText:async()=>{sent++;}},
    store:x.store,learning:x.learning,delayMs:35,fetchImpl:async()=>{calls++;}});
  ai.handleIncoming(m(A,'novo',false,'Preciso de ajuda'),'tempo_real');
  x.learning.pauseForHuman(A);ai.handleHuman(A);
  await wait(100);
  assert.equal(calls,0);assert.equal(sent,0);assert.equal(x.learning.suggestion(A),null);
  ai.stop();
 }finally{x.close();}
});
