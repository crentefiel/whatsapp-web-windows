'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeMessage,isAllowedJid,MEDIA_LIMIT}=require('./messages.cjs');
const {saveIncomingBuffer}=require('./media-storage.cjs');
const {relativeMediaPath}=require('./media-files.cjs');
const {archiveBaileysSession}=require('./session.cjs');
class WhatsAppClient{
  constructor({dataDir,store,changed}){
    this.dataDir=dataDir;this.store=store;this.changed=changed;this.socket=null;this.starting=false;this.closed=false;this.retryTimer=null;this.sessionExpired=false;this.recentMessages=new Map();this.aiNotified=new Set();
    this.status={state:'desconectado',qr:null,lastEvent:null,lastSaved:null,lastIncoming:null,received:0,saved:0,upserts:0,upsertsNotify:0,upsertsAppend:0,upsertsOther:0,lastUpsertType:null,ignored:0,duplicates:0,errors:0,mediaErrors:0,detail:''};this.logger=null;
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
        this.status.upserts++;
        if(type==='notify')this.status.upsertsNotify++;
        else if(type==='append')this.status.upsertsAppend++;
        else this.status.upsertsOther++;
        this.status.lastUpsertType=String(type||'desconhecido').slice(0,24);
        this.update({lastEvent:new Date().toISOString()});
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
  httpStatus(err){
    const code=Number(err?.status??err?.statusCode??err?.output?.statusCode);
    return Number.isInteger(code)?code:0;
  }
  isDecryptFail(err){
    const msg=String(err?.message||err||'').toLowerCase();
    return msg.includes('bad_decrypt')||msg.includes('bad decrypt')||msg.includes('failed to decrypt')||msg.includes('openssl');
  }
  isNetworkAbort(err){
    const msg=String(err?.message||err||'').toLowerCase();
    const status=this.httpStatus(err);
    return msg.includes('terminated')||msg.includes('aborted')||msg.includes('fetch failed')||msg.includes('failed to fetch')||msg.includes('socket')||msg.includes('econnreset')||msg.includes('etimedout')||msg.includes('timeout')||msg.includes('eai_again')||[408,429,500,502,503,504].includes(status);
  }
  async refreshMedia(raw,sock){
    if(typeof sock?.updateMediaMessage!=='function')return raw;
    let settled=false;
    const updated=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(!settled){settled=true;reject(Error('Tempo esgotado ao pedir a mídia novamente ao celular'));}},12000);
      Promise.resolve(sock.updateMediaMessage(raw)).then(value=>{
        if(settled)return;settled=true;clearTimeout(timer);resolve(value);
      },error=>{
        if(settled)return;settled=true;clearTimeout(timer);reject(error);
      });
    });
    if(updated?.message)raw.message=updated.message;
    return raw;
  }
  async downloadWithRetry(downloader,raw,sock,attempts=3){
    let lastErr,refreshed=false;
    for(let i=0;i<attempts;i++){
      try{
        const buffer=await downloader(raw,sock);
        if(Buffer.isBuffer(buffer)&&buffer.length>0)return buffer;
        throw Error('Download não retornou bytes');
      }catch(e){
        lastErr=e;
        const status=this.httpStatus(e);
        // Baileys só pede o arquivo de novo se error.status existir. O Boom usa output.statusCode.
        if(!refreshed&&sock?.updateMediaMessage&&([403,404,410].includes(status)||this.isDecryptFail(e))){
          refreshed=true;
          try{raw=await this.refreshMedia(raw,sock);}catch(refreshErr){lastErr=refreshErr;}
          continue;
        }
        if(!this.isNetworkAbort(e)||i===attempts-1)throw e;
        await new Promise(r=>setTimeout(r,800*(i+1)));
      }
    }
    throw lastErr;
  }
  async ingest(messages,source,sock){
    let anySaved=false,ignored=0,duplicates=0;
    const pendingMedia=[];
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
            if(m.fromMe&&m.type==='text'){
              try{this.onHuman?.(m,source);}catch(e){this.reportError('observacao_humana',e);}
            }
            this.status.saved++;anySaved=true;
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
        if(source==='tempo_real'&&!m.fromMe&&m.type==='text'){
          const eventKey=m.jid+'|'+m.id+'|'+m.participant;
          if(!this.aiNotified.has(eventKey)){
            this.aiNotified.add(eventKey);
            while(this.aiNotified.size>1000)this.aiNotified.delete(this.aiNotified.values().next().value);
            try{this.onIncoming?.(m,source);}catch(e){this.reportError('ia_evento',e);}
          }
        }
        if(source!=='envio'&&m.media&&m.media.size<=MEDIA_LIMIT&&(!exists||!this.store.linkedMedia(m))){
          pendingMedia.push({raw,m});
        }
      }catch(e){this.reportError('gravar_mensagem_'+source,e);}
    }
    this.status.ignored+=ignored;this.status.duplicates+=duplicates;
    if(anySaved)this.changed('conversas');
    this.changed('status');
    for(const {raw,m} of pendingMedia){
      try{
        const downloader=this.downloadMedia||(async(msg,client)=>{
          const b=await import('@whiskeysockets/baileys');
          return b.downloadMediaMessage(msg,'buffer',{},{
            logger:this.logger,reuploadRequest:client?.updateMediaMessage
          });
        });
        const buffer=await this.downloadWithRetry(downloader,raw,sock);
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
        const status=this.httpStatus(e);
        const friendly=this.isDecryptFail(e)
          ?'mídia antiga não abriu (o celular não reenviou a chave). Peça o arquivo de novo se precisar.'
          :status===404||status===410
          ?'mídia antiga indisponível no WhatsApp (o celular não reenviou o arquivo)'
          :this.isNetworkAbort(e)
            ?'conexão interrompida ao baixar mídia; o texto da conversa foi salvo'
            :String(e?.message||e).replace(/https?:\/\/\S+/g,'').slice(0,140);
        this.status.lastMediaNote=friendly;
        this.changed('status');
      }
    }
  }
  async sendText(jid,text,origin='human'){
    if(!isAllowedJid(jid))throw Error('Identificador inválido');
    if(typeof text!=='string'||!text.trim()||text.length>65536)throw Error('Mensagem vazia ou muito longa');
    if(!this.socket||this.status.state!=='conectado')throw Error('WhatsApp não conectado');
    const sent=await this.socket.sendMessage(jid,{text:text.trim()});
    if(origin==='ai'&&sent?.key?.id)this.memory?.markBot(jid,sent.key.id);
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
  async businessSnapshot(){
    if(!this.socket||this.status.state!=='conectado')throw Error('Conecte o WhatsApp para buscar os dados da empresa');
    const sock=this.socket;
    const rawId=sock.user?.id||'';
    const user=String(rawId).split('@')[0].split(':')[0];
    const jid=user?user+'@s.whatsapp.net':'';
    if(!jid)throw Error('Número ainda não identificado. Aguarde a conexão terminar.');
    const out={name:'',about:'',hours:'',address:'',catalog:''};
    let profile=null;
    if(typeof sock.getBusinessProfile==='function'){
      try{profile=await sock.getBusinessProfile(jid);}catch{profile=null;}
    }
    if(profile){
      const sites=Array.isArray(profile.website)?profile.website.join(', '):'';
      out.about=[profile.description,profile.category,profile.email,sites].filter(Boolean).join('\n');
      out.address=String(profile.address||'');
      const hours=profile.business_hours?.business_config;
      if(Array.isArray(hours)&&hours.length){
        out.hours=hours.map(item=>{
          const day=item.day_of_week||item.day||'';
          const open=item.open_time??item.open,close=item.close_time??item.close;
          return [day,open!=null&&close!=null?open+'-'+close:item.mode].filter(Boolean).join(' ');
        }).join('\n');
      }
    }
    if(typeof sock.getCatalog==='function'){
      try{
        const cat=await sock.getCatalog({jid,limit:40});
        const products=cat?.products||[];
        out.catalog=products.map(product=>{
          const amount=Number(product.priceAmount1000||product.price||0);
          const price=amount>0?(product.priceAmount1000?'R$ '+(amount/1000).toFixed(2).replace('.',','):String(product.price)):'';
          return [product.name,price,product.description].filter(Boolean).join(' — ');
        }).filter(Boolean).join('\n');
      }catch{/* número pessoal não tem catálogo */}
    }
    if(!out.about&&!out.hours&&!out.address&&!out.catalog){
      throw Error('Este número não devolveu perfil comercial nem catálogo. Preencha os dados da empresa à mão.');
    }
    return out;
  }
  async profile(jid){
    if(!isAllowedJid(jid)||!this.socket||this.status.state!=='conectado')return null;
    try{const url=await this.socket.profilePictureUrl(jid,'image');if(url){this.store.photo(jid,url);this.changed('conversas');}return url||null;}
    catch{return null;}
  }
  async repairSession(){
    if(this.status.state==='conectado')throw Error('A sessão está conectada; não é necessário refazer o QR.');
    if(this.starting)throw Error('Conexão em andamento. Tente novamente após a tentativa terminar.');
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
