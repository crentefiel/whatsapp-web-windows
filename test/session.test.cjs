'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {hasSavedBaileysSession,archiveBaileysSession}=require('../src/core/session.cjs');

test('retoma somente quando há sessão persistida, sem modificar credenciais',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-sessao-'));
  try{
    assert.equal(hasSavedBaileysSession(dir),false);
    const auth=path.join(dir,'baileys_auth'),creds=path.join(auth,'creds.json');
    await fs.mkdir(auth);
    await fs.writeFile(creds,'');
    assert.equal(hasSavedBaileysSession(dir),false);
    const content='{"me":{"id":"teste@s.whatsapp.net"}}';
    await fs.writeFile(creds,content);
    assert.equal(hasSavedBaileysSession(dir),true);
    assert.equal(await fs.readFile(creds,'utf8'),content);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('ao solicitar novo QR, arquiva as credenciais sem apagar histórico e documentos',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sorriso-reparo-'));
  try{
    const auth=path.join(dir,'baileys_auth');
    await fs.mkdir(auth);
    await fs.writeFile(path.join(auth,'creds.json'),'{"me":{"id":"5511999999999@s.whatsapp.net"}}');
    await fs.writeFile(path.join(auth,'app-state-sync-key-1.json'),'chave simulada');
    await fs.mkdir(path.join(dir,'media','contatos'),{recursive:true});
    await fs.writeFile(path.join(dir,'media','contatos','documento.pdf'),'documento preservado');
    const backup=archiveBaileysSession(dir);
    assert.ok(path.basename(backup).startsWith('baileys_auth_backup_'));
    assert.equal(await fs.readFile(path.join(backup,'app-state-sync-key-1.json'),'utf8'),'chave simulada');
    assert.match(await fs.readFile(path.join(backup,'creds.json'),'utf8'),/5511999999999/);
    await assert.rejects(fs.access(auth));
    assert.equal(await fs.readFile(path.join(dir,'media','contatos','documento.pdf'),'utf8'),'documento preservado');
    assert.equal(archiveBaileysSession(dir),null,'não deve criar outro backup sem credenciais');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
