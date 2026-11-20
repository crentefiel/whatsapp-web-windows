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
 assert.equal(isAllowedJid('5511999999999@s.whatsapp.net'),true);assert.equal(isAllowedJid('123456@lid'),true);assert.equal(isAllowedJid('../abc'),false);
});
test('SQLite evita mensagens duplicadas e mantém ordenação após reabrir',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sorriso-test-'));
 try{let db=new Store(folder);const a={jid:'123@lid',id:'a',participant:'',fromMe:false,timestamp:10,type:'text',text:'oi',quotedId:null,senderName:'Teste'};
 assert.equal(db.save(a),true);assert.equal(db.save(a),false);db.save({...a,id:'b',timestamp:20,text:'resposta'});
 assert.equal(db.conversations()[0].count,2);db.close();db=new Store(folder);assert.deepEqual(db.messages('123@lid').map(m=>m.body),['oi','resposta']);db.close();}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});
