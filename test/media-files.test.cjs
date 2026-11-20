'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os');
const {contactFolder,relativeMediaPath,resolveStoredMedia,cleanFileName}=require('../src/core/media-files.cjs');
const id='123e4567-e89b-12d3-a456-426614174000';
test('arquivos ficam separados por número e categoria',()=>{
 const one=relativeMediaPath({jid:'5511999999999@s.whatsapp.net',kind:'document',id,filename:'contrato.pdf'});
 const two=relativeMediaPath({jid:'5511888888888@s.whatsapp.net',kind:'document',id,filename:'contrato.pdf'});
 assert.equal(one,path.join('media','contatos','5511999999999','documentos',id+'_contrato.pdf'));
 assert.notEqual(one,two);
 assert.equal(contactFolder('123456@lid'),'LID-123456');
 assert.equal(cleanFileName('../../teste.pdf'),'teste.pdf');
 const root=path.join(os.tmpdir(),'app-baileys');
 assert.equal(resolveStoredMedia(root,one),path.resolve(root,one));
 assert.equal(resolveStoredMedia(root,path.join('media',id)),path.resolve(root,'media',id));
});
test('bloqueia caminhos fora da pasta local e tipos inválidos',()=>{
 const root=path.join(os.tmpdir(),'app-baileys');
 assert.equal(resolveStoredMedia(root,'../../segredo.txt'),null);
 assert.equal(resolveStoredMedia(root,path.join('media','contatos','5511','documentos','../../fora')),null);
 assert.throws(()=>relativeMediaPath({jid:'120363@g.us',kind:'document',id,filename:'foto.pdf'}));
 assert.throws(()=>relativeMediaPath({jid:'123@lid',kind:'script',id,filename:'x'}));
});
