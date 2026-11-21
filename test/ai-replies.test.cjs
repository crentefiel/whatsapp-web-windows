'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {AiSettings,AutoResponder,validBaseUrl}=require('../src/core/ai-replies.cjs');
const JID='5511999999999@s.whatsapp.net',SECOND='5511888888888@s.whatsapp.net';
const fakeVault={
 isEncryptionAvailable:()=>true,
 encryptString:s=>Buffer.from('criptografado:'+s,'utf8'),
 decryptString:b=>b.toString('utf8').slice('criptografado:'.length)
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
 assert.throws(()=>settings.update({model:'x',enabled:true}),/autorize pelo menos um contato/);
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
