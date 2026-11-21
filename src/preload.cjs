'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(action,...args)=>ipcRenderer.invoke('whatsapp:'+action,...args);
contextBridge.exposeInMainWorld('whatsapp',Object.freeze({
 start:()=>call('start'),repair:()=>call('repair'),status:()=>call('status'),conversations:()=>call('conversations'),
 messages:jid=>call('messages',jid),sendText:(jid,text)=>call('sendText',jid,text),
 sendFile:(jid,kind,caption)=>call('sendFile',jid,kind,caption),
 saveMedia:id=>call('saveMedia',id),profile:jid=>call('profile',jid),
 openContactFolder:jid=>call('openContactFolder',jid),
 onChange:callback=>{
   if(typeof callback!=='function')return()=>{};
   const listener=(_event,kind)=>callback(kind);ipcRenderer.on('dados:alterados',listener);
   return()=>ipcRenderer.removeListener('dados:alterados',listener);
 }
}));
