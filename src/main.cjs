'use strict';
const {app,BrowserWindow,ipcMain,dialog,protocol,net,shell,Menu,clipboard,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {Store}=require('./core/database.cjs');
const {AiSettings,AutoResponder}=require('./core/ai-replies.cjs');
const {LearningMemory}=require('./core/learning-memory.cjs');
const {WhatsAppClient}=require('./core/wa-client.cjs');
const {isAllowedJid}=require('./core/messages.cjs');
const {hasSavedBaileysSession}=require('./core/session.cjs');
const {resolveStoredMedia,contactFolder}=require('./core/media-files.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'sorriso',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let window=null,store=null,client=null,aiSettings=null,aiResponder=null,learning=null;

// Evita janela de erro para falhas de rede comuns do undici/Baileys (download de mídia abortado).
process.on('uncaughtException',(err)=>{
  const msg=String(err?.message||err||'').toLowerCase();
  if(msg.includes('terminated')||msg.includes('aborted')||msg.includes('fetch failed')||msg.includes('failed to fetch')||msg.includes('econnreset')||msg.includes('socket hang up')){
    console.warn('[rede] Conexão de mídia interrompida (ignorada):',err.message);
    return;
  }
  console.error('Uncaught Exception:',err);
  if(window&&!window.isDestroyed()){
    dialog.showErrorBox('Erro inesperado',String(err.message||err).slice(0,300));
  }
});
process.on('unhandledRejection',(reason)=>{
  const msg=String(reason?.message||reason||'').toLowerCase();
  if(msg.includes('terminated')||msg.includes('aborted')||msg.includes('fetch failed')||msg.includes('failed to fetch')||msg.includes('econnreset')||msg.includes('socket hang up')){
    console.warn('[rede] Promise de rede rejeitada (ignorada):',reason);
    return;
  }
  console.error('Unhandled Rejection:',reason);
});

if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.whenReady().then(startApp).catch(e=>{console.error(e);dialog.showErrorBox('Erro ao iniciar',e.message);app.quit();});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{aiResponder?.stop();client?.stop();store?.close();});
function changed(kind){if(window&&!window.isDestroyed())window.webContents.send('dados:alterados',kind);}
function ownRenderer(event){
 if(!window||event.sender!==window.webContents||!event.senderFrame||event.senderFrame.url!=='sorriso://local/index.html')throw Error('Origem não autorizada');
}
function api(channel,fn){ipcMain.handle(channel,(e,...args)=>{ownRenderer(e);return fn(...args);});}
function mediaPath(media){return media?resolveStoredMedia(app.getPath('userData'),media.relative_path):null;}
async function startApp(){
 const dataDir=app.getPath('userData');store=new Store(dataDir);
 client=new WhatsAppClient({dataDir,store,changed});
 aiSettings=new AiSettings(dataDir,safeStorage);
 learning=new LearningMemory(store,changed);
 aiResponder=new AutoResponder({settings:aiSettings,client,store,learning});
 client.memory=learning;
 client.onIncoming=(m,source)=>aiResponder.handleIncoming(m,source);
 client.onHuman=(m,source)=>{
   if(source==='historico'||(Number.isFinite(m.timestamp)&&Date.now()-m.timestamp>60*60*1000))return;
   if(learning.isBot(m.jid,m.id)||/^🤖\s/.test(m.text))return;
   learning.recordHuman(m,source);
   aiResponder.handleHuman(m.jid);
 };
 protocol.handle('sorriso',async request=>{
   const url=new URL(request.url);if(url.host!=='local')return new Response('Not found',{status:404});
   if(url.pathname.startsWith('/media/')){
     const id=url.pathname.slice(7);if(!/^[0-9a-f-]{36}$/.test(id))return new Response('Not found',{status:404});
     const media=store.getMedia(id),local=mediaPath(media);
     if(!local||!fs.existsSync(local))return new Response('Not found',{status:404});
     const response=await net.fetch(pathToFileURL(local).toString());
     return new Response(response.body,{status:response.status,headers:{'Content-Type':media.mime||'application/octet-stream','X-Content-Type-Options':'nosniff'}});
   }
   const allowed={'/index.html':'index.html','/ui.js':'ui.js','/style.css':'style.css'};
   if(!allowed[url.pathname])return new Response('Not found',{status:404});
   return net.fetch(pathToFileURL(path.join(__dirname,allowed[url.pathname])).toString());
 });
 api('whatsapp:status',()=>({...client.status}));
 api('whatsapp:aiSettings',()=>aiSettings.public());
 api('whatsapp:aiSave',config=>{
   const updated=aiSettings.update(config);
   changed('ai');return updated;
 });
 api('whatsapp:aiContact',(jid,allow)=>{
   if(!isAllowedJid(jid)||typeof allow!=='boolean')throw Error('Contato inválido');
   const config=aiSettings.public();
   const normalized=store.resolveJid(jid);
   const others=config.allowedJids.filter(x=>store.resolveJid(x)!==normalized);
   if(allow)others.push(normalized);
   const updated=aiSettings.update({allowedJids:others,enabled:config.enabled&&(config.responseScope==='all'||others.length>0)});
   changed('ai');return updated;
 });
 api('whatsapp:aiDiagnostics',()=>({...aiResponder.stats}));
 api('whatsapp:aiTest',()=>aiResponder.testConnection());
 api('whatsapp:learnStats',()=>learning.stats());
 api('whatsapp:learnMode',async mode=>{
   if(!['observation','suggestion','automatic'].includes(mode))throw Error('Modo inválido');
   if(mode==='automatic'){
     if(!aiSettings.public().enabled)throw Error('Ative a IA e salve as configurações da API antes de selecionar Automático');
     const choice=await dialog.showMessageBox(window,{
       type:'warning',title:'Ativar respostas automáticas',
       message:'Ativar o modo Automático com a memória aprendida?',
       detail:'A IA poderá enviar respostas por conta própria apenas em conversas individuais permitidas, quando houver exemplos humanos semelhantes. Valores não aprovados serão bloqueados. Você poderá voltar ao modo Observação a qualquer momento.',
       buttons:['Cancelar','Ativar Automático'],defaultId:0,cancelId:0,noLink:true
     });
     if(choice.response!==1)return{canceled:true,mode:learning.mode()};
   }
   aiResponder.cancelPending();
   return{canceled:false,mode:learning.setMode(mode)};
 });
 api('whatsapp:learnRebuild',()=>learning.rebuild());
 api('whatsapp:learnExamples',jid=>learning.examples(jid));
 api('whatsapp:learnExamplesPage',(jid,page)=>learning.examplesPage(jid,page));
 api('whatsapp:learnRepair',()=>learning.repairQuestions());
 api('whatsapp:learnExampleUpdate',(id,reply,status)=>learning.sampleUpdate(id,{reply,status}));
 api('whatsapp:learnRules',jid=>learning.rules(jid||null));
 api('whatsapp:learnAddRule',(text,jid)=>Number(learning.addRule(text,jid||null)));
 api('whatsapp:learnApproveRule',(id,approve)=>learning.approveRule(id,approve));
 api('whatsapp:learnSuggestion',jid=>learning.mode()==='suggestion'?learning.suggestion(jid):null);
 api('whatsapp:learnRejectSuggestion',(id,jid)=>Boolean(learning.finishSuggestion(id,jid,'','rejected')));
 api('whatsapp:learnSendSuggestion',async(id,jid,answer)=>{
   if(learning.mode()!=='suggestion')throw Error('Ative o modo Sugestão antes de enviar');
   if(!isAllowedJid(jid)||typeof answer!=='string'||!answer.trim()||answer.length>3000)throw Error('Resposta inválida');
   const pending=learning.suggestion(jid);
   if(!pending||pending.id!==id)throw Error('Sugestão não está mais disponível');
   learning.beginSuggestion(id,jid);
   try{
     const sent=await client.sendText(jid,answer.trim(),'human');
     learning.finishSuggestion(id,jid,answer.trim(),'approved');
     changed('learning');return sent;
   }catch(e){learning.cancelSuggestionSend(id,jid);throw e;}
 });
 api('whatsapp:companyGet',()=>learning.company());
 api('whatsapp:companySave',input=>learning.saveCompany(input||{}));
 api('whatsapp:companyPull',async()=>{
  const snap=await client.businessSnapshot();
  const current=learning.company();
  const pick=key=>String(snap[key]||'').trim()?snap[key]:current[key];
  return learning.saveCompany({
   name:pick('name')||current.name,about:pick('about'),hours:pick('hours'),
   address:pick('address'),catalog:pick('catalog')
  });
 });
 api('whatsapp:forgetChats',async jids=>{
  if(!Array.isArray(jids)||!jids.length)throw Error('Selecione ao menos uma conversa');
  const clean=jids.filter(isAllowedJid);
  if(!clean.length)throw Error('Nenhuma conversa válida');
  const choice=await dialog.showMessageBox(window,{
   type:'warning',title:'Apagar conversas neste programa',
   message:'Apagar '+clean.length+' conversa(s) e a memória desses clientes?',
   detail:'Some da lista deste computador, como se fossem clientes novos. A IA esquece os exemplos deles. Isso não apaga a conversa no celular do cliente.',
   buttons:['Cancelar','Apagar daqui'],defaultId:0,cancelId:0,noLink:true
  });
  if(choice.response!==1)return{canceled:true};
  const memory=learning.forgetContacts(clean);
  const chats=store.forgetChats(clean);
  changed('conversas');changed('learning');
  return{canceled:false,...chats,memoryRemoved:memory.removed};
 });
 api('whatsapp:copyDiagnostics',()=>{
   const {qr,...diagnostics}=client.status;
   const {enabled,allowedJids,responseScope}=aiSettings.public();
   const {sent,failed,skipped,observed,scheduled,apiCalls,lastError,lastSkip,lastTrigger}=aiResponder.stats;
   const learned=learning.stats();
   clipboard.writeText(JSON.stringify({appVersion:app.getVersion(),...diagnostics,
     ai:{enabled,responseScope,allowedContacts:allowedJids.length,sent,failed,skipped,observed,scheduled,apiCalls,lastError,lastSkip,lastTrigger,learningMode:learned.mode,learnedExamples:learned.examples}},null,2));
   return{copied:true};
 });
 api('whatsapp:start',()=>client.start());
 api('whatsapp:repair',async()=>{
   if(client.status.state==='conectado')throw Error('O WhatsApp já está conectado.');
   const choice=await dialog.showMessageBox(window,{
     type:'warning',title:'Gerar um novo QR Code',
     message:'Deseja vincular o WhatsApp novamente?',
     detail:'A sessão anterior será guardada em uma pasta de backup. Suas conversas, documentos e outros dados locais não serão excluídos. Você precisará escanear um novo QR Code no celular.',
     buttons:['Cancelar','Guardar sessão e gerar novo QR'],defaultId:0,cancelId:0,noLink:true
   });
   if(choice.response!==1)return{canceled:true};
   return client.repairSession();
 });
 api('whatsapp:conversations',()=>store.conversations());
 api('whatsapp:messages',jid=>{if(!isAllowedJid(jid))throw Error('Identificador inválido');return store.messages(jid);});
 api('whatsapp:sendText',(jid,text)=>client.sendText(jid,text));
 api('whatsapp:profile',jid=>client.profile(jid));
 api('whatsapp:sendFile',async(jid,kind,caption)=>{
   if(!isAllowedJid(jid)||!['image','video','audio','document'].includes(kind))throw Error('Parâmetros inválidos');
   const pick=await dialog.showOpenDialog(window,{title:'Escolha o arquivo para enviar',properties:['openFile']});
   if(pick.canceled||!pick.filePaths.length)return{canceled:true};
   return client.sendAttachment(jid,pick.filePaths[0],kind,String(caption||''));
 });
 api('whatsapp:openContactFolder',async jid=>{
   if(!isAllowedJid(jid))throw Error('Contato inválido');
   const folder=path.join(dataDir,'media','contatos',contactFolder(jid));
   fs.mkdirSync(folder,{recursive:true});
   const openError=await shell.openPath(folder);
   if(openError)throw Error('Não foi possível abrir a pasta: '+openError);
   return{opened:true};
 });
 api('whatsapp:saveMedia',async id=>{
   if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw Error('Arquivo inválido');
   const media=store.getMedia(id),source=mediaPath(media);if(!source||!fs.existsSync(source))throw Error('Arquivo não encontrado no computador');
   const picked=await dialog.showSaveDialog(window,{defaultPath:path.join(app.getPath('downloads'),media.filename),title:'Salvar arquivo recebido'});
   if(picked.canceled||!picked.filePath)return{canceled:true};
   fs.copyFileSync(source,picked.filePath);return{saved:true};
 });
 window=new BrowserWindow({width:1300,height:850,minWidth:900,minHeight:650,
   title:'WhatsApp Desktop - Gráfica do Sorriso',backgroundColor:'#111b21',
   webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:true}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'Arquivo',submenu:[{label:'Fechar',role:'quit'}]},
   {label:'Exibir',submenu:[{label:'Recarregar interface',role:'reload'},{label:'Zoom +',role:'zoomIn'},{label:'Zoom -',role:'zoomOut'}]},
   {label:'Ajuda',submenu:[{label:'Projeto no GitHub',click:()=>shell.openExternal('https://github.com/crentefiel/whatsapp-web-windows')}]}
 ]));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!=='sorriso://local/index.html')event.preventDefault();});
 await window.loadURL('sorriso://local/index.html');
 if(hasSavedBaileysSession(dataDir)){
   void client.start().catch(err=>{
     console.error('Falha ao retomar sessão Baileys:',err.message);
     client.reportError('retomar_sessao',err);
   });
 }
 setTimeout(()=>{try{learning.repairQuestions();}catch(err){console.error('Falha ao reorganizar a memória:',err.message);}},2000);
}
