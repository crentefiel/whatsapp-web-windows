'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(action,...args)=>ipcRenderer.invoke('whatsapp:'+action,...args);
contextBridge.exposeInMainWorld('whatsapp',Object.freeze({
 start:()=>call('start'),repair:()=>call('repair'),status:()=>call('status'),copyDiagnostics:()=>call('copyDiagnostics'),conversations:()=>call('conversations'),
 messages:jid=>call('messages',jid),sendText:(jid,text)=>call('sendText',jid,text),
 sendFile:(jid,kind,caption)=>call('sendFile',jid,kind,caption),
 saveMedia:id=>call('saveMedia',id),profile:jid=>call('profile',jid),
 openContactFolder:jid=>call('openContactFolder',jid),
 aiSettings:()=>call('aiSettings'),
 aiSave:config=>call('aiSave',config),
 aiContact:(jid,allow)=>call('aiContact',jid,allow),
 aiDiagnostics:()=>call('aiDiagnostics'),
 aiTest:()=>call('aiTest'),
 learnStats:()=>call('learnStats'),
 learnMode:mode=>call('learnMode',mode),
 learnRebuild:()=>call('learnRebuild'),
 learnExamples:jid=>call('learnExamples',jid),
 learnExampleUpdate:(id,reply,status)=>call('learnExampleUpdate',id,reply,status),
 learnRules:jid=>call('learnRules',jid),
 learnAddRule:(text,jid)=>call('learnAddRule',text,jid),
 learnApproveRule:(id,approve)=>call('learnApproveRule',id,approve),
 learnSuggestion:jid=>call('learnSuggestion',jid),
 learnRejectSuggestion:(id,jid)=>call('learnRejectSuggestion',id,jid),
 learnSendSuggestion:(id,jid,answer)=>call('learnSendSuggestion',id,jid,answer),
 onChange:callback=>{
   if(typeof callback!=='function')return()=>{};
   const listener=(_event,kind)=>callback(kind);ipcRenderer.on('dados:alterados',listener);
   return()=>ipcRenderer.removeListener('dados:alterados',listener);
 }
}));
