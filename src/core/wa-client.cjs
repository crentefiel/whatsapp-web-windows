'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeMessage,isAllowedJid,MEDIA_LIMIT}=require('./messages.cjs');
class WhatsAppClient{
  constructor({dataDir,store,changed}){
    this.dataDir=dataDir;this.store=store;this.changed=changed;this.socket=null;this.starting=false;this.closed=false;this.retryTimer=null;
    this.status={state:'desconectado',qr:null,lastEvent:null,lastSaved:null,received:0,errors:0,detail:''};this.logger=null;
  }
  update(patch){Object.assign(this.status,patch);this.changed('status');}
  async start(){
    if(this.starting||this.socket)return;
    this.closed=false;this.starting=true;this.update({state:'conectando',qr:null,detail:''});
    try{
      const b=await import('@whiskeysockets/baileys'),pino=(await import('pino')).default;
      this.logger=pino({level:'silent'});
      const {state,saveCreds}=await b.useMultiFileAuthState(path.join(this.dataDir,'baileys_auth'));
      if(this.closed){this.starting=false;return;}
      const sock=b.default({auth:state,logger:this.logger,printQRInTerminal:false,syncFullHistory:true,
        markOnlineOnConnect:false,shouldSyncHistoryMessage:()=>true,browser:b.Browsers?.windows?.('Chrome')||['Windows','Chrome','1.0']});
      this.socket=sock;sock.ev.on('creds.update',saveCreds);
      sock.ev.on('connection.update',async({connection,qr,lastDisconnect})=>{
        if(this.socket!==sock)return;
        if(qr){
          const QRCode=(await import('qrcode')).default;
          this.update({state:'aguardando_qr',qr:await QRCode.toDataURL(qr,{margin:2,width:280})});
        }
        if(connection==='open')this.update({state:'conectado',qr:null,detail:''});
        if(connection==='close'){
          const code=lastDisconnect?.error?.output?.statusCode,loggedOut=code===b.DisconnectReason.loggedOut;
          this.socket=null;this.update({state:loggedOut?'sessao_encerrada':'reconectando',qr:null,
            detail:loggedOut?'Vincule novamente pelo QR; sessão não apagada.':'Conexão encerrada ('+(code||'sem código')+').'});
          if(!loggedOut&&!this.closed)this.scheduleRetry();
        }
      });
      sock.ev.on('messages.upsert',({messages})=>this.ingest(messages,'tempo_real',sock));
      sock.ev.on('messaging-history.set',({contacts=[],chats=[],messages=[]})=>{
        try{
          for(const c of contacts)if(c.id)this.store.contact(c.id,c.name||c.notify||'');
          for(const c of chats)if(c.id)this.store.contact(c.id,c.name||'',Number(c.conversationTimestamp||0)*1000);
          this.changed('conversas');
        }catch(e){this.reportError('historico_contatos',e);}
        this.ingest(messages,'historico',sock);
      });
      sock.ev.on('contacts.upsert',(contacts)=>this.onContacts(contacts));
      sock.ev.on('contacts.update',(contacts)=>this.onContacts(contacts));
    }catch(e){this.socket=null;this.reportError('inicio',e);this.update({state:'erro',qr:null});this.scheduleRetry();}
    finally{this.starting=false;}
  }
  scheduleRetry(){if(this.retryTimer||this.closed)return;this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.start();},5000);}
  onContacts(contacts){try{for(const c of contacts||[])if(c.id)this.store.contact(c.id,c.name||c.notify||c.verifiedName||'');this.changed('conversas');}
    catch(e){this.reportError('contatos',e);}}
  reportError(where,e){this.status.errors++;this.update({detail:'Erro em '+where+': '+String(e.message||e).slice(0,180)});}
  async ingest(messages,source,sock){
    for(const raw of messages||[]){
      const m=normalizeMessage(raw);if(!m)continue;
      this.update({lastEvent:new Date().toISOString()});
      if(this.store.has(m))continue;
      try{
        let mediaId=null;
        if(m.media&&m.media.size<=MEDIA_LIMIT){
          try{
            const b=await import('@whiskeysockets/baileys');
            const buf=await b.downloadMediaMessage(raw,'buffer',{}, {logger:this.logger,reuploadRequest:sock.updateMediaMessage});
            if(buf.length<=MEDIA_LIMIT){
              const id=crypto.randomUUID(),relativePath=path.join('media',id),mediaDir=path.join(this.dataDir,'media');
              await fs.mkdir(mediaDir,{recursive:true});
              await fs.writeFile(path.join(this.dataDir,relativePath),buf,{flag:'wx'});
              this.store.saveMedia({id,filename:m.media.filename,mime:m.media.mime,kind:m.media.kind,relativePath,size:buf.length});
              mediaId=id;
            }
          }catch(e){this.reportError('download_midia',e);}
        }
        if(this.store.save(m,mediaId)){
          this.status.received++;this.update({lastSaved:new Date().toISOString()});this.changed('conversas');
        }
      }catch(e){this.reportError('persistencia_'+source,e);}
    }
  }
  async sendText(jid,text){
    if(!isAllowedJid(jid))throw Error('Identificador inválido');
    if(typeof text!=='string'||!text.trim()||text.length>65536)throw Error('Mensagem vazia ou muito longa');
    if(!this.socket||this.status.state!=='conectado')throw Error('WhatsApp não conectado');
    const sent=await this.socket.sendMessage(jid,{text:text.trim()});
    await this.ingest([sent],'envio',this.socket);
    return{id:sent?.key?.id||''};
  }
  async sendAttachment(jid,filePath,kind,caption=''){
    if(!isAllowedJid(jid)||!['image','video','audio','document'].includes(kind))throw Error('Destino ou tipo inválido');
    if(!this.socket||this.status.state!=='conectado')throw Error('WhatsApp não conectado');
    const stat=await fs.stat(filePath);if(!stat.isFile()||stat.size>MEDIA_LIMIT)throw Error('Arquivo deve ter até 100 MB');
    const data={url:filePath},mime=await import('mime-types'),mimetype=mime.lookup(filePath)||'application/octet-stream';
    const content=kind==='document'?{document:data,mimetype,fileName:path.basename(filePath),caption:caption.slice(0,1000)}:
      kind==='image'?{image:data,caption:caption.slice(0,1000)}:
      kind==='video'?{video:data,caption:caption.slice(0,1000)}:{audio:data,mimetype};
    const sent=await this.socket.sendMessage(jid,content);
    await this.ingest([sent],'envio',this.socket);
    return{id:sent?.key?.id||''};
  }
  async profile(jid){
    if(!isAllowedJid(jid)||!this.socket||this.status.state!=='conectado')return null;
    try{const url=await this.socket.profilePictureUrl(jid,'image');if(url){this.store.photo(jid,url);this.changed('conversas');}return url||null;}
    catch{return null;}
  }
  stop(){this.closed=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.socket;this.socket=null;
    try{sock?.ws?.close();}catch{}this.update({state:'desconectado',qr:null});}
}
module.exports={WhatsAppClient};
