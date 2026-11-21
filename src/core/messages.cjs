'use strict';
const path = require('node:path');
const MAX_TEXT=65536, MEDIA_LIMIT=100*1024*1024;
function unwrap(message){
  let value=message||{};
  for(let i=0;i<6;i++){
    if(value.ephemeralMessage?.message)value=value.ephemeralMessage.message;
    else if(value.viewOnceMessage?.message)value=value.viewOnceMessage.message;
    else if(value.viewOnceMessageV2?.message)value=value.viewOnceMessageV2.message;
    else if(value.documentWithCaptionMessage?.message)value=value.documentWithCaptionMessage.message;
    else break;
  }
  return value;
}
function unixMs(value){
  if(typeof value==='number')return value*1000;
  if(typeof value==='string'&&/^\d+$/.test(value))return Number(value)*1000;
  if(value&&typeof value.toNumber==='function')return value.toNumber()*1000;
  if(value&&typeof value.low==='number')return value.low*1000;
  return Date.now();
}
function textFrom(c){return(c.conversation||c.extendedTextMessage?.text||c.imageMessage?.caption||c.videoMessage?.caption||c.documentMessage?.caption||c.buttonsResponseMessage?.selectedDisplayText||c.listResponseMessage?.title||c.templateButtonReplyMessage?.selectedDisplayText||'').slice(0,MAX_TEXT);}
function mediaFrom(c){
  const kind=['image','video','audio','document','sticker'].find(k=>c[k+'Message']);if(!kind)return null;
  const m=c[kind+'Message'],fallback={image:'image.jpg',video:'video.mp4',audio:'audio.ogg',document:'documento',sticker:'figurinha.webp'}[kind];
  const basename=path.basename(String(m.fileName||fallback).replace(/\\/g,'/'));
  const filename=basename.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,180)||fallback;
  return{kind,filename,mime:String(m.mimetype||'application/octet-stream').split(';')[0].slice(0,100),size:typeof m.fileLength?.toNumber==='function'?m.fileLength.toNumber():Number(m.fileLength||0)};
}
function normalizeMessage(m){
  const key=m?.key||{},jid=typeof key.remoteJid==='string'?key.remoteJid:'',id=typeof key.id==='string'?key.id:'';
  if(!isAllowedJid(jid)||!id||!m.message)return null;
  const c=unwrap(m.message),media=mediaFrom(c),text=textFrom(c);
  // A chave alternativa é fornecida pelo WhatsApp; nunca deduzir LID de nome ou número.
  const alt=typeof key.remoteJidAlt==='string'?key.remoteJidAlt:'';
  const altJid=isAllowedJid(alt)&&alt!==jid&&alt.endsWith('@lid')!==jid.endsWith('@lid')?alt:null;
  const type=media?.kind||(c.reactionMessage?'reaction':c.protocolMessage?'protocol':'text');
  const quotedId=c.extendedTextMessage?.contextInfo?.stanzaId||c.imageMessage?.contextInfo?.stanzaId||c.videoMessage?.contextInfo?.stanzaId||null;
  return{id,jid,altJid,participant:String(key.participant||''),fromMe:!!key.fromMe,senderName:String(m.pushName||'').slice(0,200),
    timestamp:unixMs(m.messageTimestamp),type,text:type==='reaction'?(c.reactionMessage?.text||''):text,quotedId,media};
}
// Apenas contatos individuais; Baileys pode incluir um índice de dispositivo no JID.
function isAllowedJid(jid){return typeof jid==='string'&&jid.length<=160&&/^(?:\d+(?::\d+)?@s\.whatsapp\.net|[a-zA-Z0-9_.:-]+@lid)$/.test(jid);}
module.exports={normalizeMessage,isAllowedJid,MEDIA_LIMIT,unwrap};
