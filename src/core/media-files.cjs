'use strict';
const path=require('node:path');
const {isAllowedJid}=require('./messages.cjs');
const categories=Object.freeze({image:'fotos',video:'videos',audio:'audios',document:'documentos',sticker:'figurinhas'});
function cleanFileName(filename){
  const base=path.basename(String(filename||'arquivo').replace(/\\/g,'/'));
  return base.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+$/,'arquivo').slice(0,120)||'arquivo';
}
function contactFolder(jid){
  if(!isAllowedJid(jid))throw Error('Contato inválido para salvar arquivos');
  const [local,domain]=jid.split('@');
  const clean=local.replace(/[^a-zA-Z0-9_.-]/g,'_');
  return domain==='lid'?'LID-'+clean:clean;
}
function relativeMediaPath({jid,kind,id,filename}){
  if(!/^[0-9a-f-]{36}$/.test(id)||!categories[kind])throw Error('Identificação de arquivo inválida');
  return path.join('media','contatos',contactFolder(jid),categories[kind],id+'_'+cleanFileName(filename));
}
function resolveStoredMedia(dataDir,relativePath){
  if(typeof relativePath!=='string')return null;
  const root=path.resolve(dataDir,'media'),absolute=path.resolve(dataDir,relativePath);
  if(!absolute.startsWith(root+path.sep))return null;
  const parts=path.relative(root,absolute).split(path.sep);
  const old=parts.length===1&&/^[0-9a-f-]{36}$/.test(parts[0]);
  const current=parts.length===4&&parts[0]==='contatos'&&
    /^(?:[0-9][0-9_]*|LID-[a-zA-Z0-9_.-]+)$/.test(parts[1])&&
    Object.values(categories).includes(parts[2])&&/^[0-9a-f-]{36}_.+/.test(parts[3]);
  return old||current?absolute:null;
}
module.exports={contactFolder,relativeMediaPath,resolveStoredMedia,cleanFileName};
