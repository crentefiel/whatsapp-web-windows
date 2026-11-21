'use strict';
const {app,BrowserWindow,ipcMain,dialog,protocol,net,shell,Menu,clipboard,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {Store}=require('./core/database.cjs');
const {AiSettings,AutoResponder}=require('./core/ai-replies.cjs');
const {WhatsAppClient}=require('./core/wa-client.cjs');
const {isAllowedJid}=require('./core/messages.cjs');
const {hasSavedBaileysSession}=require('./core/session.cjs');
const {resolveStoredMedia,contactFolder}=require('./core/media-files.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'sorriso',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let window=null,store=null,client=null,aiSettings=null,aiResponder=null;
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
 aiResponder=new AutoResponder({settings:aiSettings,client,store});
 client.onIncoming=(m,source)=>aiResponder.handleIncoming(m,source);
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
   const updated=aiSettings.update({allowedJids:others,enabled:config.enabled&&others.length>0});
   changed('ai');return updated;
 });
 api('whatsapp:aiDiagnostics',()=>({...aiResponder.stats}));
 api('whatsapp:copyDiagnostics',()=>{
   // Nunca copiar o QR Code nem credenciais/sessões. Apenas métricas locais.
   const {qr,...diagnostics}=client.status;
   clipboard.writeText(JSON.stringify({appVersion:app.getVersion(),...diagnostics},null,2));
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
 // Na reabertura, retomar a sessão Baileys já autorizada, sem novo QR.
 // Se for a primeira instalação, o pareamento continua manual pelo botão.
 if(hasSavedBaileysSession(dataDir)){
   void client.start().catch(err=>{
     console.error('Falha ao retomar sessão Baileys:',err.message);
     client.reportError('retomar_sessao',err);
   });
 }
}
