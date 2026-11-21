'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/core/database.cjs');
const {WhatsAppClient}=require('../src/core/wa-client.cjs');
const {normalizeMessage}=require('../src/core/messages.cjs');
const {resolveStoredMedia}=require('../src/core/media-files.cjs');

const PN='5511988877766@s.whatsapp.net',LID='987654321@lid';
const text=(id,jid=PN,body='oi',extra={})=>({
 key:{remoteJid:jid,id,fromMe:false,...extra},message:{conversation:body},messageTimestamp:1795000000
});
async function withClient(fn){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-recebe-'));
 const changes=[],store=new Store(folder);
 const client=new WhatsAppClient({dataDir:folder,store,changed:kind=>changes.push(kind)});
 try{await fn({folder,store,client,changes});}
 finally{store.close();await fs.rm(folder,{force:true,recursive:true});}
}

test('salva textos de um lote mesmo se o download de imagem ficar bloqueado',async()=>withClient(async({folder,store,client,changes})=>{
 let release;
 const wait=new Promise(resolve=>{release=resolve;});
 client.downloadMedia=async()=>{await wait;return Buffer.from([1,2,3,4]);};
 const foto={key:{remoteJid:PN,id:'foto-1',fromMe:false},
   message:{imageMessage:{caption:'fotografia',mimetype:'image/jpeg',fileLength:4}},
   messageTimestamp:1795000001};
 const received=client.ingest([foto,text('texto-2',PN,'mensagem urgente')],'tempo_real',{});
 // Antes do download completar, a mensagem urgente deve estar no SQLite.
 const savedNow=store.messages(PN);
 assert.equal(savedNow.length,2);
 assert.ok(savedNow.some(m=>m.body==='mensagem urgente'));
 assert.ok(changes.includes('conversas'));
 release();await received;
 const all=store.messages(PN),image=all.find(m=>m.id==='foto-1');
 assert.ok(image.media_id);
 const media=store.getMedia(image.media_id);
 assert.deepEqual(await fs.readFile(resolveStoredMedia(folder,media.relative_path)),Buffer.from([1,2,3,4]));
 assert.equal(client.status.received,2);
 assert.equal(client.status.mediaErrors,0);
}));

test('replay de evento não duplica mensagem e segue recebendo textos de vários contatos',async()=>withClient(async({store,client})=>{
 await client.ingest([text('a1'),text('a1'),text('b2','5511977776666@s.whatsapp.net','segunda pessoa')],'tempo_real',{});
 assert.equal(store.messages(PN).length,1);
 assert.equal(store.messages('5511977776666@s.whatsapp.net').length,1);
 assert.equal(client.status.duplicates,1);
 assert.equal(client.status.saved,2);
 assert.equal(client.status.received,2);
 assert.deepEqual(client.getMessage({remoteJid:PN,id:'a1'}),{conversation:'oi'});
}));

test('une PN e LID somente com remoteJidAlt confiável do evento',async()=>withClient(async({store,client})=>{
 await client.ingest([text('lid-inicial',LID,'olá do LID')],'tempo_real',{});
 assert.equal(store.conversations().length,1);
 await client.ingest([text('pn-seguinte',PN,'olá do número',{remoteJidAlt:LID})],'tempo_real',{});
 const all=store.conversations();
 assert.equal(all.length,1,'não duplicar conversa entre LID e telefone');
 assert.equal(all[0].jid,PN);
 assert.deepEqual(store.messages(PN).map(m=>m.body),['olá do LID','olá do número']);
 assert.deepEqual(store.messages(LID).map(m=>m.body),['olá do LID','olá do número']);
 assert.equal(store.resolveJid(LID),PN);
}));

test('grupos, comunidades, status e canais não entram no banco',async()=>withClient(async({store,client})=>{
 const raw=jid=>text('id-'+jid,jid);
 await client.ingest([
  raw('120363000000000@g.us'),raw('status@broadcast'),raw('100@newsletter'),
  raw('123@broadcast'),text('privado',PN)
 ],'tempo_real',{});
 assert.equal(store.conversations().length,1);
 assert.equal(store.messages(PN).length,1);
 assert.equal(client.status.ignored,4);
}));

test('registro sintético de imagem, áudio, vídeo, documento e figurinha mantém mensagens visíveis',async()=>withClient(async({store,client})=>{
 client.downloadMedia=async()=>Buffer.from([5,6,7]);
 const types=['image','audio','video','document','sticker'];
 const messages=types.map((kind,i)=>({
  key:{remoteJid:PN,id:'media-'+kind,fromMe:false},
  message:{[kind+'Message']:{mimetype:'application/octet-stream',fileLength:3,fileName:kind+'.bin'}},
  messageTimestamp:1795000000+i
 }));
 await client.ingest(messages,'tempo_real',{});
 const result=store.messages(PN);
 assert.equal(result.length,5);
 assert.deepEqual(result.map(x=>x.kind).sort(),types.sort());
 assert.equal(result.filter(x=>x.media_id).length,5);
}));

test('conteúdo simples persiste para getMessage e recuperação sem cache em memória',async()=>withClient(async({store,client})=>{
 await client.ingest([text('persistida',PN,'preciso do arquivo')],'tempo_real',{});
 client.recentMessages.clear();
 assert.deepEqual(client.getMessage({remoteJid:PN,id:'persistida'}),{conversation:'preciso do arquivo'});
 assert.equal(client.getMessage({remoteJid:'120363000000000@g.us',id:'qualquer'}),undefined);
}));

test('placeholder inicial não impede o conteúdo real recebido depois',async()=>withClient(async({store,client})=>{
 const placeholder={key:{remoteJid:PN,id:'aguardando',fromMe:false},
   message:{protocolMessage:{type:1}},messageTimestamp:1795000000};
 await client.ingest([placeholder],'tempo_real',{});
 assert.equal(store.messages(PN)[0].kind,'protocol');
 await client.ingest([text('aguardando',PN,'agora o texto chegou')],'atualizacao',{});
 const result=store.messages(PN);
 assert.equal(result.length,1);
 assert.equal(result[0].body,'agora o texto chegou');
 assert.equal(result[0].kind,'text');
 // Reenvio de protocolo obsoleto não pode apagar conteúdo válido.
 await client.ingest([placeholder],'tempo_real',{});
 assert.equal(store.messages(PN)[0].body,'agora o texto chegou');
}));

test('arquivo enviado fica salvo localmente e não é baixado outra vez pela rede',async()=>withClient(async({folder,store,client})=>{
 const filename='apresentacao.pptx',file=path.join(folder,filename);
 const bytes=Buffer.from([80,75,3,4,1,2,3,4]);await fs.writeFile(file,bytes);
 client.status.state='conectado';
 client.socket={sendMessage:async(jid,payload)=>({
  key:{remoteJid:jid,id:'out-pptx',fromMe:true},
  message:{documentMessage:{fileName:payload.fileName,mimetype:payload.mimetype,fileLength:bytes.length}},
  messageTimestamp:1795000090
 })};
 client.downloadMedia=async()=>{throw Error('Saída não deve fazer download');};
 await client.sendAttachment(PN,file,'document');
 const msg=store.messages(PN)[0],media=store.getMedia(msg.media_id);
 assert.equal(msg.kind,'document');
 assert.equal(media.filename,filename);
 assert.deepEqual(await fs.readFile(resolveStoredMedia(folder,media.relative_path)),bytes);
 assert.equal(client.status.mediaErrors,0);
}));
