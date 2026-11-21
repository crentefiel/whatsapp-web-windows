'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {WhatsAppClient}=require('../src/core/wa-client.cjs');
const {saveIncomingBuffer}=require('../src/core/media-storage.cjs');
const {resolveStoredMedia}=require('../src/core/media-files.cjs');

test('anexos recebidos são escritos binariamente em pastas separadas por contato e categoria',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-anexos-'));
 try{
  const formats=[
   ['5511999990001@s.whatsapp.net','document','contrato.pdf'],
   ['5511999990001@s.whatsapp.net','document','apresentacao.pptx'],
   ['5511999990001@s.whatsapp.net','document','planilha.xlsx'],
   ['5511999990001@s.whatsapp.net','document','projeto.cdr'],
   ['5511999990001@s.whatsapp.net','document','documento.docx'],
   ['5511999990001@s.whatsapp.net','document','arquivos.zip'],
   ['5511999990001@s.whatsapp.net','audio','mensagem.ogg'],
   ['5511999990001@s.whatsapp.net','image','foto.jpg'],
   ['5511999990001@s.whatsapp.net','video','video.mp4'],
   ['5511999990002@s.whatsapp.net','document','contrato.pdf'],
  ];
  const paths=[];
  for(let i=0;i<formats.length;i++){
    const [jid,kind,filename]=formats[i];
    const buffer=Buffer.from([0,255,13,10,i,42,0,188]);
    const saved=await saveIncomingBuffer(dir,{jid,kind,id:crypto.randomUUID(),filename},buffer);
    const absolute=resolveStoredMedia(dir,saved.relativePath);
    assert.ok(absolute,filename);
    assert.deepEqual(await fs.readFile(absolute),buffer,filename);
    assert.equal(saved.size,buffer.length);
    paths.push(absolute);
  }
  assert.ok(paths[0].includes(path.join('5511999990001','documentos')));
  assert.ok(paths[6].includes(path.join('5511999990001','audios')));
  assert.ok(paths[7].includes(path.join('5511999990001','fotos')));
  assert.ok(paths[8].includes(path.join('5511999990001','videos')));
  assert.ok(paths[9].includes(path.join('5511999990002','documentos')));
  assert.notEqual(paths[0],paths[9]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('recebimento rejeita JID de grupo e conteúdo que não é buffer',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-anexos-'));
 try{
  const args={jid:'120363123456@g.us',kind:'document',id:crypto.randomUUID(),filename:'arquivo.pdf'};
  await assert.rejects(saveIncomingBuffer(dir,args,Buffer.from('abc')),/Contato inválido/);
  await assert.rejects(saveIncomingBuffer(dir,{...args,jid:'5511999990001@s.whatsapp.net'},'not binary'),/dados binários/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('envio de PPTX, XLSX, DOCX, ZIP, PDF e extensão desconhecida usa documento com MIME correto',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-formatos-'));
 try{
  const jid='5511999990001@s.whatsapp.net',sent=[];
  const client=new WhatsAppClient({dataDir:dir,store:{},changed:()=>{}});
  client.status.state='conectado';
  client.socket={sendMessage:async(dest,payload)=>{
    sent.push({dest,payload});return{key:{id:'TEST',remoteJid:dest,fromMe:true},message:{conversation:'ok'}};
  }};
  client.ingest=async()=>{};
  const cases=[
    ['arquivo.pdf','application/pdf'],
    ['apresentacao.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['documento.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['planilha.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['compactado.zip','application/zip'],
    ['formato_desconhecido.xunknownformatx','application/octet-stream'],
  ];
  for(const [filename,expectedMime] of cases){
    const filePath=path.join(dir,filename);
    await fs.writeFile(filePath,Buffer.from('arquivo de teste'));
    await client.sendAttachment(jid,filePath,'document');
    const last=sent.at(-1);
    assert.equal(last.dest,jid);
    assert.equal(last.payload.fileName,filename);
    assert.equal(last.payload.document.url,filePath);
    assert.equal(last.payload.mimetype,expectedMime);
  }
  const corel=path.join(dir,'grafica.cdr');
  await fs.writeFile(corel,Buffer.from('projeto sintetico'));
  await client.sendAttachment(jid,corel,'document');
  assert.equal(sent.at(-1).payload.fileName,'grafica.cdr');
  assert.equal(sent.length,cases.length+1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('envio de áudio, foto e vídeo usa cada tipo próprio sem executar arquivo',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-multimidia-'));
 try{
  const sent=[],jid='5511999990001@s.whatsapp.net';
  const client=new WhatsAppClient({dataDir:dir,store:{},changed:()=>{}});
  client.status.state='conectado';
  client.socket={sendMessage:async(dest,payload)=>{
    sent.push(payload);return{key:{id:'TEST',remoteJid:dest,fromMe:true},message:{conversation:'ok'}};
  }};
  client.ingest=async()=>{};
  for(const [file,kind] of [['foto.png','image'],['voz.mp3','audio'],['video.mp4','video']]){
    const filePath=path.join(dir,file);
    await fs.writeFile(filePath,Buffer.from('dados simulados'));
    await client.sendAttachment(jid,filePath,kind);
    assert.equal(sent.at(-1)[kind].url,filePath);
  }
  assert.equal(sent[1].mimetype,'audio/mpeg');
  assert.equal(sent.length,3);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
