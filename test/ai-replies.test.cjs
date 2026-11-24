'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {AiSettings,AutoResponder,validBaseUrl}=require('../src/core/ai-replies.cjs');
const JID='5511999999999@s.whatsapp.net',SECOND='5511888888888@s.whatsapp.net';
const fakeVault={
 isEncryptionAvailable:()=>true,
 encryptString:s=>Buffer.from([...Buffer.from(s,'utf8')].map(x=>x^0xa5)),
 decryptString:b=>Buffer.from([...b].map(x=>x^0xa5)).toString('utf8')
};
function withSettings(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-'));
 try{return fn(new AiSettings(dir,fakeVault),dir);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const incoming=(jid=JID,text='Oi')=>({jid,fromMe:false,type:'text',text});

test('IA inicia desativada, configuração persiste e chave nunca fica em texto puro',()=>withSettings((settings,dir)=>{
 assert.equal(settings.public().enabled,false);
 assert.equal(settings.public().hasKey,false);
 const key='uma-chave-de-teste-privada';
 const saved=settings.update({
  model:'modelo-do-servidor',baseUrl:'https://api.exemplo.com/v1',apiKey:key,
  allowedJids:[JID],enabled:true
 });
 assert.equal(saved.enabled,true);assert.equal(saved.hasKey,true);
 assert.equal(saved.apiKey,undefined);
 assert.equal(settings.getKey(),key);
 assert.doesNotMatch(fs.readFileSync(path.join(dir,'ia-config.json'),'utf8'),/uma-chave-de-teste-privada/);
 assert.doesNotMatch(fs.readFileSync(path.join(dir,'ia-chave.enc'),'utf8'),/uma-chave-de-teste-privada/);
 const reopened=new AiSettings(dir,fakeVault);
 assert.equal(reopened.public().enabled,true);
 assert.equal(reopened.public().hasKey,true);
 assert.deepEqual(reopened.public().allowedJids,[JID]);
 reopened.update({clearKey:true,enabled:false});
 assert.equal(reopened.hasKey(),false);
 assert.equal(reopened.public().enabled,false);
}));

test('nunca ativa respostas para todos; exige contato autorizado e chave para API externa',()=>withSettings(settings=>{
 assert.throws(()=>settings.update({model:'x',enabled:true}),/Autorize um contato/);
 settings.update({model:'modelo',allowedJids:[JID]});
 assert.throws(()=>settings.update({enabled:true}),/chave da API/);
 settings.update({baseUrl:'http://localhost:11434/v1',enabled:true});
 assert.equal(settings.public().enabled,true);
 assert.throws(()=>settings.update({allowedJids:['120363000@g.us']}),/inválida/);
 assert.throws(()=>settings.update({allowedJids:['status@broadcast']}),/inválida/);
 assert.throws(()=>settings.update({allowedJids:['100@newsletter']}),/inválida/);
}));

test('somente HTTPS e HTTP local; não aceitar URL completa de completion',()=>{
 assert.equal(validBaseUrl('https://api.openai.com/v1'),'https://api.openai.com/v1');
 assert.equal(validBaseUrl('http://localhost:11434/v1'),'http://localhost:11434/v1');
 assert.throws(()=>validBaseUrl('http://api.externa.com/v1'),/HTTPS/);
 assert.throws(()=>validBaseUrl('https://example.com/v1/chat/completions'),/URL base/);
 assert.throws(()=>validBaseUrl('file:///etc/passwd'),/HTTPS/);
});

test('responde apenas a contato autorizado e apenas eventos de tempo real, com aviso de IA',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ia-envio-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://localhost:11434/v1',model:'teste',allowedJids:[JID],enabled:true});
  const sent=[],requests=[];
  const client={status:{state:'conectado'},sendText:async(jid,message)=>{sent.push({jid,message});}};
  const store={messages:()=>[{kind:'text',body:'Olá, quanto custa?',from_me:0}],resolveJid:jid=>jid};
  const ai=new AutoResponder({settings,client,store,delayMs:1,fetchImpl:async(url,init)=>{
   requests.push({url,body:JSON.parse(init.body)});
   return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Como posso ajudar?'}}]})};
  }});
  ai.handleIncoming(incoming(SECOND),'tempo_real');
  ai.handleIncoming(incoming(JID),'historico');
  ai.handleIncoming({...incoming(JID),fromMe:true},'tempo_real');
  ai.handleIncoming({...incoming(JID),type:'image'},'tempo_real');
  ai.handleIncoming(incoming('120363000@g.us'),'tempo_real');
  ai.handleIncoming(incoming(JID),'tempo_real');
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(requests.length,1);
  assert.equal(sent.length,1);
  assert.equal(sent[0].jid,JID);
  assert.equal(sent[0].message,'🤖 Como posso ajudar?');
  assert.equal(requests[0].url,'http://localhost:11434/v1/chat/completions');
  assert.equal(requests[0].body.model,'teste');
  assert.equal(requests[0].body.messages.at(-1).role,'user');
  ai.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('desativar IA durante a consulta impede resposta mesmo se a API responder',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ia-cancel-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://localhost:11434/v1',model:'teste',allowedJids:[JID],enabled:true});
  let release;const sent=[];
  const responder=new AutoResponder({settings,client:{status:{state:'conectado'},sendText:async(...x)=>sent.push(x)},
   store:{messages:()=>[{kind:'text',body:'Oi',from_me:0}],resolveJid:jid=>jid},delayMs:1,
   fetchImpl:async()=>new Promise(resolve=>{release=()=>resolve({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'ok'}}]})});})
  });
  responder.handleIncoming(incoming(JID),'tempo_real');
  for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(typeof release,'function');
  settings.update({enabled:false});
  release();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(sent.length,0);
  responder.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('botão de teste consulta a API com mensagem sintética, sem tocar no WhatsApp',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-api-test-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://localhost:11434/v1',model:'teste-local',enabled:false});
  const calls=[];let sends=0;
  const responder=new AutoResponder({
   settings,client:{status:{state:'conectado'},sendText:async()=>{sends++;}},
   store:{messages:()=>[],resolveJid:j=>j},
   fetchImpl:async(url,opts)=>{
    calls.push({url,options:JSON.parse(opts.body)});
    return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'OK'}}]})};
   }
  });
  const result=await responder.testConnection();
  assert.equal(result.success,true);
  assert.equal(result.preview,'OK');
  assert.equal(calls.length,1);
  assert.match(calls[0].options.messages[1].content,/Teste técnico de conexão/);
  assert.equal(sends,0,'teste API nunca deve mandar mensagem ao contato');
  assert.equal(responder.stats.apiCalls,1);
  responder.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('erros de autenticação e de rede são exibidos sem expor a chave da API',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-api-erro-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  const secret='SEGREDO-SINTETICO';
  settings.update({baseUrl:'https://api.exemplo.com/v1',model:'modelo',apiKey:secret,enabled:false});
  const responder=new AutoResponder({
   settings,client:{status:{state:'conectado'}},
   store:{resolveJid:j=>j,messages:()=>[]},
   fetchImpl:async()=>({ok:false,status:401})
  });
  const auth=await responder.testConnection();
  assert.equal(auth.success,false);
  assert.match(auth.error,/401\/403/);
  assert.doesNotMatch(JSON.stringify(auth),new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(responder.stats),new RegExp(secret));
  responder.fetch=async()=>{throw Error('fetch failed');};
  const network=await responder.testConnection();
  assert.equal(network.success,false);
  assert.match(network.error,/conexão/);
  responder.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('diagnóstico mostra por que novas mensagens não disparam: desativada, autorização, não elegível',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-diagnostico-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  const client={status:{state:'conectado'}},store={resolveJid:j=>j};
  const responder=new AutoResponder({settings,client,store});
  responder.handleIncoming(incoming(JID),'tempo_real');
  assert.equal(responder.stats.observed,1);
  assert.equal(responder.stats.lastSkip,'IA desativada');
  settings.update({baseUrl:'http://localhost:11434/v1',model:'teste',enabled:false});
  settings.update({allowedJids:[SECOND],enabled:true});
  responder.handleIncoming(incoming(JID),'tempo_real');
  assert.equal(responder.stats.lastSkip,'Contato sem autorização');
  responder.handleIncoming({...incoming(SECOND),type:'image'},'tempo_real');
  assert.equal(responder.stats.lastSkip,'Mensagem não elegível');
  responder.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('modo todos os contatos individuais ativa sem lista prévia, persiste e mantém grupos excluídos',()=>withSettings((settings,dir)=>{
 const config=settings.update({baseUrl:'http://127.0.0.1:31415/v1',model:'auto',responseScope:'all',enabled:true});
 assert.equal(config.enabled,true);
 assert.equal(config.responseScope,'all');
 assert.equal(config.allowedJids.length,0);
 const restarted=new AiSettings(dir,fakeVault);
 assert.equal(restarted.public().responseScope,'all');
 assert.equal(restarted.public().enabled,true);
 const responder=new AutoResponder({
  settings:restarted,client:{status:{state:'conectado'}},
  store:{resolveJid:jid=>jid,messages:()=>[]}
 });
 assert.equal(responder.allowed(JID),true);
 assert.equal(responder.allowed(SECOND),true);
 assert.equal(responder.allowed('987654321@lid'),true);
 assert.equal(responder.allowed('120363000@g.us'),false);
 assert.equal(responder.allowed('status@broadcast'),false);
 assert.equal(responder.allowed('100@newsletter'),false);
 responder.stop();
}));

test('modo restrito preserva exigência de contato e a configuração anterior se o salvamento falhar',()=>withSettings(settings=>{
 settings.update({baseUrl:'http://localhost:11434/v1',model:'auto',responseScope:'all',enabled:true});
 assert.throws(()=>settings.update({responseScope:'selected',enabled:true}),/Autorize um contato/);
 assert.equal(settings.public().enabled,true);
 assert.equal(settings.public().responseScope,'all');
 settings.update({responseScope:'selected',allowedJids:[JID],enabled:true});
 assert.equal(settings.public().responseScope,'selected');
 assert.equal(settings.public().enabled,true);
}));

test('modo todos não é ativado automaticamente apenas por configurar a API',()=>withSettings(settings=>{
 const result=settings.update({baseUrl:'http://127.0.0.1:31415/v1',model:'auto',responseScope:'all'});
 assert.equal(result.enabled,false);
 assert.equal(result.responseScope,'all');
}));

test('modo todos responde mensagem nova de contato privado sem autorização individual, mas não responde grupo',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-todos-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://127.0.0.1:31415/v1',model:'auto',responseScope:'all',enabled:true});
  const sends=[],requests=[];
  const ai=new AutoResponder({
   settings,
   client:{status:{state:'conectado'},sendText:async(jid,body)=>{sends.push({jid,body});}},
   store:{resolveJid:jid=>jid,messages:()=>[{kind:'text',body:'Oi!',from_me:0}]},
   delayMs:1,fetchImpl:async(url,init)=>{
    requests.push(JSON.parse(init.body));
    return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Olá, tudo bem?'}}]})};
   }
  });
  ai.handleIncoming({...incoming(SECOND),id:'nova-2',timestamp:Date.now()},'tempo_real');
  ai.handleIncoming({...incoming('12036312345@g.us'),id:'grupo',timestamp:Date.now()},'tempo_real');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(requests.length,1);
  assert.deepEqual(sends,[{jid:SECOND,body:'🤖 Olá, tudo bem?'}]);
  ai.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mensagens notify recentes com relógio 7 minutos adiantado ou atrasado recebem resposta',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-relogio-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://127.0.0.1:31415/v1',model:'auto',responseScope:'all',enabled:true});
  const calls=[],sent=[];
  const ai=new AutoResponder({settings,client:{
   status:{state:'conectado'},sendText:async(jid,body)=>sent.push({jid,body})
  },store:{resolveJid:jid=>jid,messages:()=>[{kind:'text',body:'Oi',from_me:0}]},
   delayMs:1,fetchImpl:async(url,opts)=>{
    calls.push(url);
    return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'Resposta aprovada'}}]})};
   }
  });
  const now=Date.now();
  ai.handleIncoming({...incoming(JID),id:'relogio-adiantado',timestamp:now+7*60*1000},'tempo_real');
  ai.handleIncoming({...incoming(SECOND),id:'relogio-atrasado',timestamp:now-7*60*1000},'tempo_real');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(ai.stats.scheduled,2,'ambas mensagens notify recentes devem disparar');
  assert.equal(calls.length,2);
  assert.equal(sent.length,2);
  assert.deepEqual(sent.map(m=>m.jid).sort(),[JID,SECOND].sort());
  assert.equal(ai.stats.lastSkip,'');
  ai.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('notify muito antigo é bloqueado, append e histórico não disparam respostas',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-ai-historico-'));
 try{
  const settings=new AiSettings(dir,fakeVault);
  settings.update({baseUrl:'http://127.0.0.1:31415/v1',model:'auto',responseScope:'all',enabled:true});
  const ai=new AutoResponder({settings,client:{status:{state:'conectado'}},
   store:{resolveJid:jid=>jid,messages:()=>[]}});
  ai.handleIncoming({...incoming(JID),id:'muito-antiga',timestamp:Date.now()-26*60*60*1000},'tempo_real');
  assert.equal(ai.stats.scheduled,0);
  assert.match(ai.stats.lastSkip,/mais de 24 horas/);
  ai.handleIncoming({...incoming(JID),id:'historica',timestamp:Date.now()},'historico');
  ai.handleIncoming({...incoming(JID),id:'append',timestamp:Date.now()},'sincronizacao');
  assert.equal(ai.stats.scheduled,0);
  ai.stop();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('trocar o modo cancela respostas pendentes sem travar o processo',()=>{
 const ai=new AutoResponder({settings:{public:()=>({enabled:false,responseScope:'selected',allowedJids:[]})},
  client:{},store:{},delayMs:5000});
 ai.pending.set(JID,setTimeout(()=>{},60000));
 ai.cancelPending();
 assert.equal(ai.pending.size,0);
});
