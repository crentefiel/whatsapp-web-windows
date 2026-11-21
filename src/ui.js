'use strict';
const $=id=>document.getElementById(id);
let selected=null,chats=[],reloading=false,pendingStatus=false,pendingConversations=false;
let currentState='desconectado',sendingText=false,sendingFile=false;
function refreshComposer(){
 const hasContact=Boolean(selected),connected=currentState==='conectado';
 $('messageInput').disabled=!hasContact;
 $('sendButton').disabled=!hasContact||!connected||sendingText||!$('messageInput').value.trim();
 $('attachmentType').disabled=!hasContact||!connected||sendingFile;
 $('sendFile').disabled=!hasContact||!connected||sendingFile;
 $('composerHint').textContent=!hasContact?'Escolha um contato para escrever.':connected?'':'Sem conexão: você pode escrever, e o envio será liberado quando o WhatsApp reconectar.';
}
function error(message){$('error').textContent=String(message||'').slice(0,220);}
function readable(jid){return String(jid||'').split('@')[0];}
function dateString(ms){const value=typeof ms==='string'&&ms.includes('T')?Date.parse(ms):Number(ms);return new Date(Number.isFinite(value)?value:Date.now()).toLocaleString('pt-BR');}
async function status(){
 try{
   const s=await window.whatsapp.status();
   const labels={conectado:'Conectado',conectando:'Conectando...',aguardando_qr:'Aguardando QR Code',desconectado:'Desconectado',erro:'Erro',reconectando:'Reconectando...',sessao_encerrada:'Sessão encerrada'};
   $('state').textContent=labels[s.state]||s.state;
   $('connect').disabled=['conectando','aguardando_qr','conectado','reconectando'].includes(s.state);
   $('repair').hidden=!['desconectado','aguardando_qr','reconectando','sessao_encerrada','erro'].includes(s.state);
   $('repair').disabled=Boolean(s.state==='conectando');
   $('qrcode').hidden=!s.qr;if(s.qr)$('qr').src=s.qr;
   $('detail').textContent=s.detail||'';
   $('health').textContent='Mensagens salvas: '+(s.received||0)+' · Erros: '+(s.errors||0)+' · Último evento: '+(s.lastEvent?dateString(s.lastEvent):'nenhum')+' · Última gravação: '+(s.lastSaved?dateString(s.lastSaved):'nenhuma');
   currentState=s.state;
   refreshComposer();
 }catch(e){error(e.message);}
}
function photo(_jid,src){
 const holder=$('contactPhoto');holder.replaceChildren();
 if(typeof src==='string'&&/^https:\/\//.test(src)){
   const img=document.createElement('img');img.referrerPolicy='no-referrer';img.alt='Foto do contato';img.src=src;
   img.onerror=()=>holder.textContent='◉';holder.append(img);
 }else holder.textContent='◉';
}
function renderChats(){
 const filtered=chats.filter(c=>(c.name+' '+c.jid).toLowerCase().includes($('search').value.toLowerCase()));
 $('conversations').replaceChildren(...filtered.map(c=>{
   const el=document.createElement('div');el.className='person'+(selected===c.jid?' selected':'');el.setAttribute('role','listitem');
   const label=document.createElement('strong');label.textContent=c.name||readable(c.jid);
   const prev=document.createElement('div');prev.className='preview';prev.textContent=c.preview||('['+(c.preview_kind||'Conversa')+']');
   el.append(label,prev);el.addEventListener('click',()=>choose(c));return el;
 }));
}
async function conversations(){try{chats=await window.whatsapp.conversations();renderChats();}catch(e){error(e.message);}}
async function choose(c){
 selected=c.jid;$('contactTitle').textContent=c.name||readable(c.jid);$('contactJid').textContent=c.jid;
 $('refreshPhoto').hidden=false;$('openContactFolder').hidden=false;photo(c.jid,c.photo);renderChats();refreshComposer();await messages();await status();
}
function mediaElement(m){
 if(!m.media_id)return null;
 const url='sorriso://local/media/'+m.media_id;let el;
 if(['image','sticker'].includes(m.media_kind)){el=document.createElement('img');el.src=url;el.alt=m.filename||'Imagem recebida';el.loading='lazy';}
 else if(m.media_kind==='video'){el=document.createElement('video');el.src=url;el.controls=true;}
 else if(m.media_kind==='audio'){el=document.createElement('audio');el.src=url;el.controls=true;}
 else{el=document.createElement('div');el.className='file';el.textContent='📄 '+(m.filename||'Documento');}
 const wrapper=document.createElement('div');wrapper.append(el);
 const save=document.createElement('button');save.textContent='Salvar arquivo';save.style.cssText='font-size:11px;margin-top:6px';
 save.addEventListener('click',async()=>{try{await window.whatsapp.saveMedia(m.media_id);}catch(e){error(e.message);}});
 wrapper.append(save);return wrapper;
}
async function messages(){
 if(!selected)return;const id=selected;
 try{
   const data=await window.whatsapp.messages(id);if(selected!==id)return;
   const frag=document.createDocumentFragment();
   for(const m of data){
     const div=document.createElement('div');div.className='message'+(m.from_me?' mine':'');
     if(m.participant&&m.participant!==m.jid){const sender=document.createElement('div');sender.className='sender';sender.textContent=readable(m.participant);div.append(sender);}
     if(m.body){const body=document.createElement('div');body.textContent=m.body;div.append(body);}
     const media=mediaElement(m);if(media)div.append(media);
     if(['image','audio','video','document','sticker'].includes(m.kind)&&!media){const missing=document.createElement('em');missing.textContent='[Mídia não disponível]';div.append(missing);}
     const time=document.createElement('small');time.textContent=dateString(m.timestamp);div.append(time);frag.append(div);
   }
   $('messages').replaceChildren(frag);$('messages').scrollTop=$('messages').scrollHeight;
 }catch(e){error(e.message);}
}
async function reload(kind){
 if(kind==='status')pendingStatus=true;else pendingConversations=true;
 if(reloading)return;
 reloading=true;
 try{
   while(pendingStatus||pendingConversations){
     const needConversations=pendingConversations;
     pendingStatus=false;pendingConversations=false;
     if(needConversations){await conversations();await messages();}
     await status();
   }
 }finally{reloading=false;}
}
$('connect').addEventListener('click',async()=>{error('');try{await window.whatsapp.start();await status();}catch(e){error(e.message);}});
$('repair').addEventListener('click',async()=>{
 error('');try{const result=await window.whatsapp.repair();if(!result?.canceled)await status();}catch(e){error(e.message);}
});
$('search').addEventListener('input',renderChats);
$('messageInput').addEventListener('input',refreshComposer);
$('refreshPhoto').addEventListener('click',async()=>{if(!selected)return;try{const url=await window.whatsapp.profile(selected);photo(selected,url);}catch(e){error(e.message);}});
$('openContactFolder').addEventListener('click',async()=>{if(!selected)return;try{await window.whatsapp.openContactFolder(selected);}catch(e){error(e.message);}});
$('sendForm').addEventListener('submit',async e=>{
 e.preventDefault();const value=$('messageInput').value;if(!selected||!value.trim()||sendingText)return;
 if(currentState!=='conectado'){error('Aguarde o WhatsApp reconectar para enviar.');return;}
 sendingText=true;refreshComposer();error('');
 try{await window.whatsapp.sendText(selected,value);$('messageInput').value='';await reload('conversas');}
 catch(err){error(err.message);}finally{sendingText=false;await status();}
});
$('sendFile').addEventListener('click',async()=>{
 if(!selected||sendingFile)return;
 if(currentState!=='conectado'){error('Aguarde o WhatsApp reconectar para enviar arquivos.');return;}
 sendingFile=true;refreshComposer();error('');
 try{await window.whatsapp.sendFile(selected,$('attachmentType').value,'');await reload('conversas');}
 catch(e){error(e.message);}finally{sendingFile=false;await status();}
});
window.whatsapp.onChange(kind=>{reload(kind).catch(e=>error(e.message));});
refreshComposer();
reload('conversas').catch(e=>error(e.message));
