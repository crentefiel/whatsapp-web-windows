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

test('a integração Baileys observa resposta humana enviada no WhatsApp Web mas não aprende resposta do robô',async()=>{
 const x=createCase();try{
  const {WhatsAppClient}=require('../src/core/wa-client.cjs');
  const t=Date.now()-2000;
  x.store.save(m(A,'cliente-antes',false,'Vocês fazem cartão de visita?',t));
  const client=new WhatsAppClient({dataDir:x.dir,store:x.store,changed:()=>{}});
  client.memory=x.learning;
  client.onHuman=(msg,source)=>x.learning.recordHuman(msg,source);
  const sent=(id,body)=>({
   key:{remoteJid:A,id,fromMe:true},
   message:{conversation:body},messageTimestamp:Math.floor(Date.now()/1000)
  });
  await client.ingest([sent('humano-web','Fazemos sim. Qual a quantidade?')],'tempo_real',{});
  assert.equal(x.learning.examples(A).length,1);
  assert.equal(x.learning.examples(A)[0].source,'tempo_real');
  x.learning.markBot(A,'robotico');
  await client.ingest([sent('robotico','🤖 Olá, podemos ajudar!')],'envio',{});
  assert.equal(x.learning.examples(A).length,1);
 }finally{x.close();}
});

test('automático exige o valor EXATO de preço presente em regra aprovada, inclusive quando escrito em reais',async()=>{
 const x=createCase();try{
  seed(x.store);x.learning.rebuild();x.learning.setMode('automatic');
  const settings=new AiSettings(x.dir,vault);
  settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  const sent=[];
  let reply='O valor fica R$ 120,00.';
  const ai=new AutoResponder({settings,client:{status:{state:'conectado'},sendText:async(...args)=>sent.push(args)},
   store:x.store,learning:x.learning,delayMs:1,fetchImpl:async()=>({ok:true,
    text:async()=>JSON.stringify({choices:[{message:{content:reply}}]})})});
  const rule=x.learning.addRule('Valor aprovado: R$ 80,00.');
  x.learning.approveRule(Number(rule),true);
  ai.handleIncoming(m(A,'preco-nao-igual',false,'Qual o horário de atendimento?'),'tempo_real');
  await wait(75);
  assert.equal(sent.length,0,'não enviar preço diferente do preço oficial');
  reply='O valor confirmado é 80 reais.';
  ai.handleIncoming(m(A,'preco-correspondente',false,'Qual o horário de atendimento?'),'tempo_real');
  await wait(75);
  assert.equal(sent.length,1,'aceitar valor exatamente aprovado em formato equivalente');
  ai.stop();
 }finally{x.close();}
});

test('enviar sugestão aprovada não falha quando o próprio envio ativa pausa humana',()=>{
 const x=createCase();try{
  const id=x.learning.saveSuggestion(A,'id-cliente','Sugestão original');
  x.learning.beginSuggestion(id,A);
  x.learning.pauseForHuman(A);
  assert.equal(x.learning.finishSuggestion(id,A,'Resposta revisada','approved').id,id);
  assert.equal(x.learning.suggestion(A),null);
  const row=x.store.db.prepare('SELECT status,answer FROM learning_suggestions WHERE id=?').get(id);
  assert.equal(row.status,'approved');
  assert.equal(row.answer,'Resposta revisada');
 }finally{x.close();}
});

test('a fala recente do cliente, inclusive áudio, entra no lugar de um número antigo',()=>{
 const x=createCase();try{
  const t=Date.now()-5*60000;
  x.store.save(m(A,'velho',false,'4547',t));
  x.store.save(m(A,'antes',true,'já respondi isso',t+1000));
  x.store.save({...m(A,'voz',false,'',t+60000),type:'audio'});
  const human=m(A,'espera',true,'Como eu falei, eu vou lhe esperar',t+70000);
  x.store.save(human);
  assert.equal(x.learning.recordHuman(human,'tempo_real'),true);
  const learned=x.learning.examples(A)[0];
  assert.equal(learned.question,'[áudio do cliente]');
  assert.equal(learned.reply,'Como eu falei, eu vou lhe esperar');
  x.learning.db.prepare(`UPDATE learning_examples SET question='4547',status='observed' WHERE id=?`).run(learned.id);
  const fixed=x.learning.repairQuestions();
  assert.equal(fixed.updated,1);
  assert.equal(x.learning.examples(A)[0].question,'[áudio do cliente]');
 }finally{x.close();}
});

test('apagar um cliente tira a memória dele e preserva os outros e a regra da empresa',()=>{
 const x=createCase();try{
  seed(x.store,A);seed(x.store,B);x.learning.rebuild();
  const global=Number(x.learning.addRule('Fechamos aos domingos'));
  const local=Number(x.learning.addRule('Este cliente pede boleto',A));
  const memory=x.learning.forgetContacts([A]);
  assert.ok(memory.removed>=1);
  assert.equal(x.learning.examples(A).length,0);
  assert.equal(x.learning.examples(B).length,1);
  const left=x.learning.rules(B).map(r=>r.id);
  assert.ok(left.includes(global));
  assert.equal(left.includes(local),false);
  const chats=x.store.forgetChats([A]);
  assert.ok(chats.messages>=1);
  assert.equal(x.store.messages(A).length,0);
  assert.equal(x.store.messages(B).length,2);
 }finally{x.close();}
});

test('apagar exemplos escolhidos ou o contato inteiro tira a resposta da IA e preserva os outros',()=>{
 const x=createCase();try{
  seed(x.store,A);seed(x.store,B);x.learning.rebuild();
  const idA=x.learning.examples(A)[0].id;
  const global=Number(x.learning.addRule('Fechamos aos domingos'));
  x.learning.saveSuggestion(A,'pergunta','Posso sugerir um horário?');
  assert.equal(x.learning.deleteExamples([idA]).removed,1);
  assert.equal(x.learning.examples(A).length,0);
  assert.equal(x.learning.examples(B).length,1);
  assert.equal(x.learning.rules(B).some(r=>r.id===global),true);
  const t=Date.now()-1000;
  x.store.save(m(A,'q2',false,'Qual o horário de atendimento?',t));
  x.store.save(m(A,'a2',true,'De segunda a sexta, das 9 às 17.',t+10));
  x.learning.rebuild();
  assert.ok(x.learning.examples(A).length>=1);
  const wiped=x.learning.deleteContactExamples(A);
  assert.ok(wiped.removed>=1);
  assert.equal(x.learning.examples(A).length,0);
  assert.equal(x.learning.suggestion(A),null);
  assert.equal(x.learning.examples(B).length,1);
  assert.equal(x.learning.canAuto(A,'Qual o horário de atendimento?').ok,false);
 }finally{x.close();}
});

test('dá para listar e apagar mais conversas do que as 500 da tela',()=>{
 const x=createCase();try{
  for(let i=0;i<520;i++)x.store.contact('55119'+String(i).padStart(8,'0')+'@s.whatsapp.net','Cliente '+i,i);
  assert.equal(x.store.conversations().length,500);
  const jids=x.store.conversationJids();
  assert.equal(jids.length,520);
  assert.doesNotThrow(()=>x.learning.forgetContacts(jids));
  const chats=x.store.forgetChats(jids);
  assert.equal(chats.contacts,520);
  assert.equal(x.store.conversationJids().length,0);
  assert.throws(()=>x.store.forgetChats([]),/Selecione/);
  assert.throws(()=>x.learning.forgetContacts(Array.from({length:20001},(_,i)=>'55119'+String(i).padStart(8,'0')+'@s.whatsapp.net')),/Selecione/);
 }finally{x.close();}
});

test('cadastro da empresa vira fato oficial e o preço do catálogo pode ser dito',async()=>{
 const x=createCase();try{
  const t=Date.now()-60000;
  x.store.save(m(A,'q',false,'Quanto custa o milheiro de cartões?',t));
  x.store.save(m(A,'a',true,'Vou confirmar o valor do milheiro de cartões.',t+1000));
  x.learning.rebuild();
  x.learning.saveCompany({name:'Gráfica do Sorriso',catalog:'1000 cartões — R$ 90,00',hours:'8h às 18h'});
  assert.match(x.learning.companyBrief(),/Gráfica do Sorriso/);
  assert.match(x.learning.companyBrief(),/R\$ 90,00/);
  const page=x.learning.examplesPage(A,1);
  assert.equal(page.total,1);
  assert.equal(page.items[0].reply.includes('milheiro'),true);
  x.learning.setMode('automatic');
  const settings=new AiSettings(x.dir,vault);
  settings.update({baseUrl:'http://localhost:11434/v1',model:'modelo',responseScope:'all',enabled:true});
  const sent=[];let reply='O milheiro fica R$ 90,00.';
  const ai=new AutoResponder({settings,client:{status:{state:'conectado'},sendText:async(...args)=>sent.push(args)},
   store:x.store,learning:x.learning,delayMs:1,fetchImpl:async()=>({ok:true,
    text:async()=>JSON.stringify({choices:[{message:{content:reply}}]})})});
  ai.handleIncoming(m(A,'pede-preco',false,'Quanto custa o milheiro de cartões?'),'tempo_real');
  await wait(90);
  assert.equal(sent.length,1,'preço escrito no cadastro da empresa pode ser informado');
  reply='Custa R$ 120,00.';
  ai.lastSent.clear();
  ai.handleIncoming(m(A,'preco-inventado',false,'Quanto custa o milheiro de cartões?'),'tempo_real');
  await wait(70);
  assert.equal(sent.length,1,'preço que não está no cadastro continua bloqueado');
  ai.stop();
 }finally{x.close();}
});
