'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {WhatsAppClient}=require('../src/core/wa-client.cjs');
const {relativeMediaPath,resolveStoredMedia}=require('../src/core/media-files.cjs');

function fakeClient(){
 const calls=[];
 const client=new WhatsAppClient({dataDir:os.tmpdir(),store:{},changed:()=>{}});
 client.status.state='conectado';
 client.socket={
   sendMessage:async(jid,payload)=>{
     calls.push({jid,payload});
     return{key:{id:'TESTE-'+calls.length,remoteJid:jid,fromMe:true},message:{conversation:'retorno_simulado'}};
   }
 };
 client.ingest=async()=>{}; // O envio é testado sem contato real com o WhatsApp.
 return{client,calls};
}

test('texto manual chega ao Baileys simulado com o JID original',async()=>{
 const {client,calls}=fakeClient();
 await client.sendText('123456789:4@lid','  oi de teste  ');
 assert.equal(calls.length,1);
 assert.equal(calls[0].jid,'123456789:4@lid');
 assert.deepEqual(calls[0].payload,{text:'oi de teste'});
 await assert.rejects(client.sendText('123456@g.us','oi'),/Identificador inválido/);
 await assert.rejects(client.sendText('123456789@lid','   '),/Mensagem vazia/);
});

test('envio de imagem e PDF selecionados monta o payload sem chamar rede real',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-envio-'));
 try{
  const {client,calls}=fakeClient();
  const foto=path.join(dir,'teste.png'),pdf=path.join(dir,'contrato.pdf');
  await fs.writeFile(foto,Buffer.from('imagem de teste'));
  await fs.writeFile(pdf,Buffer.from('%PDF-1.4\nconteudo sintético'));
  await client.sendAttachment('123456789@lid',foto,'image');
  await client.sendAttachment('5511999999999@s.whatsapp.net',pdf,'document');
  assert.equal(calls.length,2);
  assert.equal(calls[0].payload.image.url,foto);
  assert.equal(calls[1].payload.document.url,pdf);
  assert.equal(calls[1].payload.fileName,'contrato.pdf');
  assert.equal(calls[1].payload.mimetype,'application/pdf');
  await assert.rejects(client.sendAttachment('120363-99@g.us',pdf,'document'),/Destino ou tipo inválido/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('arquivos são gravados e lidos em pastas locais distintas de cada contato',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-disco-'));
 try{
  const id1=crypto.randomUUID(),id2=crypto.randomUUID(),data=Buffer.from('%PDF-1.4\narquivo de ensaio');
  const rel1=relativeMediaPath({jid:'5511999999999@s.whatsapp.net',kind:'document',id:id1,filename:'teste.pdf'});
  const rel2=relativeMediaPath({jid:'5511888888888@s.whatsapp.net',kind:'document',id:id2,filename:'teste.pdf'});
  for(const rel of [rel1,rel2]){
    const full=resolveStoredMedia(dir,rel);
    assert.ok(full);
    await fs.mkdir(path.dirname(full),{recursive:true});
    await fs.writeFile(full,data,{flag:'wx'});
    assert.deepEqual(await fs.readFile(full),data);
  }
  assert.notEqual(path.dirname(resolveStoredMedia(dir,rel1)),path.dirname(resolveStoredMedia(dir,rel2)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
