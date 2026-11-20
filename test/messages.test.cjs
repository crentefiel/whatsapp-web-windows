'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeMessage,isAllowedJid}=require('../src/core/messages.cjs');
const {Store}=require('../src/core/database.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('normaliza texto e não confunde mensagem própria',()=>{
 const m=normalizeMessage({key:{remoteJid:'5511999999999@s.whatsapp.net',id:'ABC',fromMe:true},message:{conversation:'oi'},messageTimestamp:1721000000});
 assert.equal(m.text,'oi');assert.equal(m.fromMe,true);assert.equal(m.timestamp,1721000000000);
});
test('preserva @lid e mídia recebida',()=>{
 const m=normalizeMessage({key:{remoteJid:'123456789@lid',id:'img',participant:'999@lid'},message:{ephemeralMessage:{message:{imageMessage:{caption:'foto',fileName:'foto.jpg',mimetype:'image/jpeg'}}}}});
 assert.equal(m.jid,'123456789@lid');assert.equal(m.media.kind,'image');assert.equal(m.text,'foto');
});
test('identificador restrito a conversas conhecidas',()=>{
 assert.equal(isAllowedJid('5511999999999@s.whatsapp.net'),true);assert.equal(isAllowedJid('123456@lid'),true);
 assert.equal(isAllowedJid('5511999999999:2@s.whatsapp.net'),true);
 assert.equal(isAllowedJid('120363123456@g.us'),false);assert.equal(isAllowedJid('123-456@g.us'),false);
 assert.equal(isAllowedJid('status@broadcast'),false);assert.equal(isAllowedJid('100@newsletter'),false);
 assert.equal(isAllowedJid('../abc'),false);
});
test('não importa mensagens de grupos, canais nem status',()=>{
 const make=(jid)=>({key:{remoteJid:jid,id:'id'},message:{conversation:'Oi'}});
 assert.equal(normalizeMessage(make('120363123456@g.us')),null);
 assert.equal(normalizeMessage(make('100@newsletter')),null);
 assert.equal(normalizeMessage(make('status@broadcast')),null);
});
test('SQLite evita mensagens duplicadas e mantém ordenação após reabrir',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-test-'));
 try{let db=new Store(folder);const a={jid:'123@lid',id:'a',participant:'',fromMe:false,timestamp:10,type:'text',text:'oi',quotedId:null,senderName:'Teste'};
 assert.equal(db.save(a),true);assert.equal(db.save(a),false);db.save({...a,id:'b',timestamp:20,text:'resposta'});
 assert.equal(db.conversations()[0].count,2);
 db.db.prepare("INSERT INTO contacts(jid,name) VALUES(?,?)").run('120363123456@g.us','Grupo antigo');
 assert.deepEqual(db.conversations().map(c=>c.jid),['123@lid']);db.close();db=new Store(folder);assert.deepEqual(db.messages('123@lid').map(m=>m.body),['oi','resposta']);db.close();}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});
