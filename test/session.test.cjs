'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {hasSavedBaileysSession}=require('../src/core/session.cjs');

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
