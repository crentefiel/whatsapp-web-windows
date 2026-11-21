'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeMessage,isAllowedJid,MEDIA_LIMIT}=require('./messages.cjs');
const {saveIncomingBuffer}=require('./media-storage.cjs');
const {relativeMediaPath}=require('./media-files.cjs');
const {archiveBaileysSession}=require('./session.cjs');
class WhatsAppClient{
  constructor({dataDir,store,changed}){
    this.dataDir=dataDir;this.store=store;this.changed=changed;this.socket=null;this.starting=false;this.closed=false;this.retryTimer=null;this.sessionExpired=false;this.recentMessages=new Map();
    this.status={state:'desconectado',qr:null,lastEvent:null,lastSaved:null,lastIncoming:null,received:0,saved:0,upserts:0,ignored:0,duplicates:0,errors:0,mediaErrors:0,detail:''};this.logger=null;
  }
  update(patch){Object.assign(this.status,patch);this.changed('status');}
  async start(){
    if(this.starting||this.socket)return;
    clearTimeout(this.retryTimer);this.retryTimer=null;
    this.closed=false;this.starting=true;this.update({state:'conectando',qr:null,detail:''});
    try{
      const b=await import('@whiskeysockets/baileys'),pino=(await import('pino')).default;
      this.logger=pino({level:'silent'});
      const {state,saveCreds}=await b.useMultiFileAuthState(path.join(this.dataDir,'baileys_auth'));
      if(this.closed){this.starting=false;return;}
      const sock=b.default({auth:state,logger:this.logger,printQRInTerminal:false,syncFullHistory:true,
        markOnlineOnConnect:false,shouldSyncHistoryMessage:()=>true,getMessage:async key=>this.getMessage(key),browser:b.Browsers?.windows?.('Chrome')||['Windows','Chrome','1.0']});
      this.socket=sock;sock.ev.on('creds.update',saveCreds);
      sock.ev.on('connection.update',async({connection,qr,lastDisconnect})=>{
        if(this.socket!==sock)return;
        if(qr){
          try{
            const QRCode=(await import('qrcode')).default;
            const image=await QRCode.toDataURL(qr,{margin:2,width:280});
            if(this.socket===sock)this.update({state:'aguardando_qr',qr:image,detail:'Leia o QR pelo WhatsApp do celular.'});
          }catch(e){this.reportError('geracao_qr',e);}
        }
        if(connection==='open'){
          this.sessionExpired=false;
          this.update({state:'conectado',qr:null,detail:''});
        }
        if(connection==='close'){
          const code=lastDisconnect?.error?.output?.statusCode,loggedOut=code===b.DisconnectReason.loggedOut;
          this.socket=null;this.sessionExpired=loggedOut;
          this.update({state:loggedOut?'sessao_encerrada':'reconectando',qr:null,
            detail:loggedOut?'A sessão foi recusada. Use "Novo QR" para arquivar a sessão antiga e vincular novamente.':'Conexão encerrada ('+(code||'sem código')+'). Tentando novamente.'});
          if(!loggedOut&&!this.closed)this.scheduleRetry();
        }
      });
      sock.ev.on('messages.update',(updates)=>{
        const completed=(updates||[]).filter(x=>x?.key&&x?.update?.message).map(x=>({
          key:x.key,message:x.update.message,
          messageTimestamp:x.update.messageTimestamp||Math.floor(Date.now()/1000)
        }));
        if(completed.length)void this.ingest(completed,'atualizacao',sock)
          .catch(e=>this.reportError('atualizacao_mensagens',e));
      });
      sock.ev.on('messages.upsert',({messages=[],type})=>{
        this.status.upserts++;this.update({lastEvent:new Date().toISOString()});
        void this.ingest(messages,type==='notify'?'tempo_real':'sincronizacao',sock)
          .catch(e=>this.reportError('evento_recebimento',e));
      });
      sock.ev.on('messaging-history.set',({contacts=[],chats=[],messages=[]})=>{
        try{
          for(const c of contacts)if(isAllowedJid(c.id))this.store.contact(c.id,c.name||c.notify||'');
          for(const c of chats)if(isAllowedJid(c.id))this.store.contact(c.id,c.name||'',Number(c.conversationTimestamp||0)*1000);
          this.changed('conversas');
        }catch(e){this.reportError('historico_contatos',e);}
        void this.ingest(messages,'historico',sock).catch(e=>this.reportError('historico_mensagens',e));
      });
      for(const event of ['chats.upsert','chats.update']){
        sock.ev.on(event,(chats)=>{
          try{
            for(const c of chats||[])if(isAllowedJid(c.id))this.store.contact(c.id,c.name||'',Number(c.conversationTimestamp||0)*1000);
            this.changed('conversas');
          }catch(e){this.reportError('lista_conversas',e);}
        });
      }
      sock.ev.on('contacts.upsert',(contacts)=>this.onContacts(contacts));
      sock.ev.on('contacts.update',(contacts)=>this.onContacts(contacts));
    }catch(e){this.socket=null;this.reportError('inicio',e);this.update({state:'erro',qr:null});this.scheduleRetry();}
    finally{this.starting=false;}
  }
  scheduleRetry(){if(this.retryTimer||this.closed)return;this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.start();},5000);}
  onContacts(contacts){try{for(const c of contacts||[])if(isAllowedJid(c.id))this.store.contact(c.id,c.name||c.notify||c.verifiedName||'');this.changed('conversas');}
    catch(e){this.reportError('contatos',e);}}
  reportError(where,e){this.status.errors++;this.update({detail:'Erro em '+where+': '+String(e.message||e).slice(0,180)});}
  remember(raw){
    const key=raw?.key;
    if(!key?.id||!raw.message)return;
    for(const jid of [key.remoteJid,key.remoteJidAlt]){
      if(!isAllowedJid(jid))continue;
      const cacheKey=jid+'|'+key.id;
      this.recentMessages.delete(cacheKey);
      this.recentMessages.set(cacheKey,raw.message);
      while(this.recentMessages.size>500)this.recentMessages.delete(this.recentMessages.keys().next().value);
    }
  }
  getMessage(key){
    const jid=key?.remoteJid,id=key?.id;
    if(!isAllowedJid(jid)||!id)return undefined;
    return this.recentMessages.get(jid+'|'+id)||this.store.messageContent?.(key);
  }
  async ingest(messages,source,sock){
    let anySaved=false,ignored=0,duplicates=0;
    const pendingMedia=[];
    // Primeiro gravar TODO o lote de mensagens. Um arquivo lento não pode
    // bloquear mensagens de texto que chegaram depois no mesmo evento.
    for(const raw of messages||[]){
      try{
        const m=normalizeMessage(raw);
        if(!m){ignored++;continue;}
        if(m.altJid)this.store.linkJids?.(m.jid,m.altJid);
        if(this.store.resolveJid)m.jid=this.store.resolveJid(m.jid);
        this.remember(raw);
        const exists=this.store.has(m);
        if(!exists){
          if(this.store.save(m)){
            this.status.saved++;anySaved=true;
            // Responder somente após salvar; IA nunca bloqueia ingestão.
            if(source==='tempo_real'&&!m.fromMe&&m.type==='text'){
              try{this.onIncoming?.(m,source);}catch(e){this.reportError('ia_evento',e);}
            }
            if(!m.fromMe){
              this.status.received++;
              this.status.lastIncoming=new Date().toISOString();
            }
            this.status.lastSaved=new Date().toISOString();
          }
        }else{
          duplicates++;
          if(this.store.upgrade?.(m)){
            anySaved=true;
            this.status.lastSaved=new Date().toISOString();
          }
        }
        // Atualizar mídias incompletas quando um evento válido reaparece.
        if(source!=='envio'&&m.media&&m.media.size<=MEDIA_LIMIT&&(!exists||!this.store.linkedMedia(m))){
          pendingMedia.push({raw,m});
        }
      }catch(e){this.reportError('gravar_mensagem_'+source,e);}
    }
    this.status.ignored+=ignored;this.status.duplicates+=duplicates;
    if(anySaved)this.changed('conversas');
    this.changed('status');
    // Baixar anexos só DEPOIS de persistir todas as mensagens do lote.
    for(const {raw,m} of pendingMedia){
      try{
        const b=await import('@whiskeysockets/baileys');
        const downloader=this.downloadMedia||((msg,client)=>b.downloadMediaMessage(msg,'buffer',{},{
          logger:this.logger,reuploadRequest:client?.updateMediaMessage
        }));
        const buffer=await downloader(raw,sock);
        if(!Buffer.isBuffer(buffer))throw Error('Download não retornou bytes');
        if(buffer.length>MEDIA_LIMIT)throw Error('Mídia excede 100 MB');
        if(this.store.linkedMedia(m))continue;
        const id=crypto.randomUUID();
        const saved=await saveIncomingBuffer(this.dataDir,{
          jid:m.jid,kind:m.media.kind,id,filename:m.media.filename
        },buffer);
        this.store.saveMedia({id,filename:m.media.filename,mime:m.media.mime,
          kind:m.media.kind,relativePath:saved.relativePath,size:saved.size});
        if(this.store.linkMedia(m,id)){
          this.status.lastSaved=new Date().toISOString();
          this.changed('conversas');
        }
      }catch(e){
        this.status.mediaErrors++;
        this.reportError('download_midia',e);
      }
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
    // Anexo já está no computador: preservar cópia local sem redownload.
    const normalized=normalizeMessage(sent);
    if(normalized?.media&&normalized.id){
      try{
        if(normalized.altJid)this.store.linkJids?.(normalized.jid,normalized.altJid);
        const resolved=this.store.resolveJid?.(normalized.jid)||normalized.jid;
        normalized.jid=resolved;
        const id=crypto.randomUUID(),filename=path.basename(filePath);
        const relativePath=relativeMediaPath({jid:resolved,kind,id,filename});
        const destination=path.join(this.dataDir,relativePath);
        await fs.mkdir(path.dirname(destination),{recursive:true});
        await fs.copyFile(filePath,destination);
        this.store.saveMedia({id,filename,mime:mimetype,kind,relativePath,size:stat.size});
        this.store.linkMedia(normalized,id);
        this.changed('conversas');
      }catch(e){this.reportError('salvar_anexo_enviado',e);}
    }
    return{id:sent?.key?.id||''};
  }
  async profile(jid){
    if(!isAllowedJid(jid)||!this.socket||this.status.state!=='conectado')return null;
    try{const url=await this.socket.profilePictureUrl(jid,'image');if(url){this.store.photo(jid,url);this.changed('conversas');}return url||null;}
    catch{return null;}
  }
  async repairSession(){
    if(this.status.state==='conectado')throw Error('A sessão está conectada; não é necessário refazer o QR.');
    if(this.starting)throw Error('Conexão em andamento. Tente novamente após a tentativa terminar.');
    // Somente por ação confirmada do usuário: nunca elimina arquivos, histórico ou credenciais.
    this.stop();
    const archived=archiveBaileysSession(this.dataDir);
    await this.start();
    return{archived:Boolean(archived)};
  }
  stop(){
    this.closed=true;clearTimeout(this.retryTimer);this.retryTimer=null;
    const sock=this.socket;this.socket=null;
    try{
      sock?.ev?.removeAllListeners?.('connection.update');
      sock?.ev?.removeAllListeners?.('creds.update');
      sock?.ws?.close();
    }catch{}
    this.update({state:'desconectado',qr:null});
  }
}
module.exports={WhatsAppClient};
