'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {relativeMediaPath}=require('./media-files.cjs');
const {MEDIA_LIMIT}=require('./messages.cjs');

// Grava anexos recebidos sem converter para texto/base64, preservando os bytes.
async function saveIncomingBuffer(dataDir,{jid,kind,id,filename},buffer){
  if(!Buffer.isBuffer(buffer))throw Error('Anexo recebido deve conter dados binários');
  if(buffer.length>MEDIA_LIMIT)throw Error('Anexo recebido excede 100 MB');
  const relativePath=relativeMediaPath({jid,kind,id,filename});
  const absolute=path.join(dataDir,relativePath);
  await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,buffer,{flag:'wx'});
  return{relativePath,size:buffer.length};
}
module.exports={saveIncomingBuffer};
