'use strict';
const $=id=>document.getElementById(id);
let selected=null,chats=[],reloading=false,pendingStatus=false,pendingConversations=false;
let currentState='desconectado',sendingText=false,sendingFile=false;
let aiConfig={enabled:false,allowedJids:[],hasKey:false};
function refreshComposer(){
 const hasContact=Boolean(selected),connected=currentState==='conectado';
 $('messageInput').disabled=!hasContact;
 $('sendButton').disabled=!hasContact||!connected||sendingText||!$('messageInput').value.trim();
 $('attachmentType').disabled=!hasContact||!connected||sendingFile;
 $('sendFile').disabled=!hasContact||!connected||sendingFile;
 $('composerHint').textContent=!hasContact?'Escolha um contato para escrever.':connected?'':'Sem conexão: você pode escrever, e o envio será liberado quando o WhatsApp reconectar.';
}
function refreshAiContact(){
 const btn=$('aiContact');
 btn.hidden=!selected;
 const approved=!!selected&&aiConfig.allowedJids.includes(selected);
 btn.textContent=approved?'IA autorizada':'Autorizar IA';
 btn.className=approved?'approved':'';
 btn.title=approved?'Clique para impedir a IA de responder este contato':'Clique para permitir respostas automáticas a este contato';
}
async function loadAi(){
 try{
  aiConfig=await window.whatsapp.aiSettings();
  $('aiBaseUrl').value=aiConfig.baseUrl||'https://api.openai.com/v1';
  $('aiModel').value=aiConfig.model||'';
  $('aiPrompt').value=aiConfig.systemPrompt||'';
  $('aiEnabled').checked=Boolean(aiConfig.enabled);
  $('aiAllowedCount').textContent='Contatos autorizados: '+aiConfig.allowedJids.length;
  const stats=await window.whatsapp.aiDiagnostics();
  $('aiHealth').textContent='Entradas avaliadas: '+(stats.observed||0)+' · Agendadas: '+(stats.scheduled||0)+' · Chamadas à API: '+(stats.apiCalls||0)+' · Respostas enviadas: '+(stats.sent||0)+' · Falhas: '+(stats.failed||0)+' · Ignoradas: '+(stats.skipped||0)+(stats.lastError?' · Último erro: '+stats.lastError:'')+(stats.lastSkip?' · Último bloqueio: '+stats.lastSkip:'');
  $('aiKeyStatus').textContent=aiConfig.hasKey?'Chave de API protegida e salva. Deixe o campo em branco para mantê-la.':'Nenhuma chave salva (API local pode funcionar sem chave).';
  $('aiClearKey').disabled=!aiConfig.hasKey;
  refreshAiContact();
 }catch(e){$('aiResult').textContent='Não foi possível carregar a IA: '+e.message;}
}
function toggleSettings(open){
 $('settingsPanel').hidden=!open;
 $('openSettings').setAttribute('aria-expanded',String(open));
 if(open){$('closeSettings').focus();void loadAi();}else{$('openSettings').focus();}
}
function error(message){$('error').textContent=String(message||'').slice(0,220);}
function readable(jid){return String(jid||'').split('@')[0];}
function dateString(ms){const value=typeof ms==='string'&&ms.includes('T')?Date.parse(ms):Number(ms);return new Date(Number.isFinite(value)?value:Date.now()).toLocaleString('pt-BR');}
async function status(){
 try{
   const s=await window.whatsapp.status();
   const labels={conectado:'Conectado',conectando:'Conectando...',aguardando_qr:'Aguardando QR Code',desconectado:'Desconectado',erro:'Erro',reconectando:'Reconectando...',sessao_encerrada:'Sessão encerrada'};
   $('state').textContent=labels[s.state]||s.state;
   $('stateBrief').textContent=(labels[s.state]||s.state)+(s.state==='aguardando_qr'?' · QR em Configurações':'');
   $('connect').disabled=['conectando','aguardando_qr','conectado','reconectando'].includes(s.state);
   $('repair').hidden=!['desconectado','aguardando_qr','reconectando','sessao_encerrada','erro'].includes(s.state);
   $('repair').disabled=Boolean(s.state==='conectando');
   $('qrcode').hidden=!s.qr;if(s.qr)$('qr').src=s.qr;
   $('detail').textContent=s.detail||'';
   $('health').textContent='Eventos Baileys: '+(s.upserts||0)+' · Mensagens recebidas: '+(s.received||0)+' · Salvas: '+(s.saved||0)+' · Ignoradas: '+(s.ignored||0)+' · Duplicadas: '+(s.duplicates||0)+' · Falhas de mídia: '+(s.mediaErrors||0)+' · Erros: '+(s.errors||0)+' · Última entrada: '+(s.lastIncoming?dateString(s.lastIncoming):'nenhuma')+' · Último evento: '+(s.lastEvent?dateString(s.lastEvent):'nenhum');
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
 $('refreshPhoto').hidden=false;$('openContactFolder').hidden=false;photo(c.jid,c.photo);renderChats();refreshComposer();refreshAiContact();await messages();await status();
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
$('openSettings').addEventListener('click',()=>toggleSettings(true));
$('closeSettings').addEventListener('click',()=>toggleSettings(false));
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!$('settingsPanel').hidden)toggleSettings(false);
});
$('connect').addEventListener('click',async()=>{error('');try{await window.whatsapp.start();await status();}catch(e){error(e.message);}});
$('repair').addEventListener('click',async()=>{
 error('');try{const result=await window.whatsapp.repair();if(!result?.canceled)await status();}catch(e){error(e.message);}
});
$('copyDiagnostics').addEventListener('click',async()=>{
 try{const result=await window.whatsapp.copyDiagnostics();if(result?.copied)error('Diagnóstico copiado. Cole no chat para análise.');}
 catch(e){error(e.message);}
});
$('aiForm').addEventListener('submit',async event=>{
 event.preventDefault();$('aiResult').textContent='Salvando...';
 const config={
  baseUrl:$('aiBaseUrl').value.trim(),model:$('aiModel').value.trim(),
  systemPrompt:$('aiPrompt').value,enabled:Boolean($('aiEnabled').checked),
  apiKey:$('aiApiKey').value
 };
 try{
  aiConfig=await window.whatsapp.aiSave(config);
  $('aiApiKey').value='';
  $('aiResult').textContent=aiConfig.enabled?'IA ativada somente nos contatos autorizados.':'Configurações salvas. IA desativada.';
  await loadAi();
 }catch(e){$('aiResult').textContent=e.message;}
});
$('aiTest').addEventListener('click',async()=>{
 const button=$('aiTest');
 button.disabled=true;
 $('aiTestResult').textContent='Testando a API salva, sem enviar mensagens pelo WhatsApp...';
 try{
  const result=await window.whatsapp.aiTest();
  $('aiTestResult').textContent=result.success?
   'API funcionando. Resposta de teste: '+result.preview:
   'Falha na API: '+result.error;
  await loadAi();
 }catch(e){$('aiTestResult').textContent='Falha no teste: '+e.message;}
 finally{button.disabled=false;}
});
$('aiClearKey').addEventListener('click',async()=>{
 try{
  aiConfig=await window.whatsapp.aiSave({clearKey:true,enabled:false});
  $('aiApiKey').value='';
  $('aiResult').textContent='Chave removida. Respostas automáticas desativadas.';
  await loadAi();
 }catch(e){$('aiResult').textContent=e.message;}
});
$('aiContact').addEventListener('click',async()=>{
 if(!selected)return;
 const approved=aiConfig.allowedJids.includes(selected);
 try{
  aiConfig=await window.whatsapp.aiContact(selected,!approved);
  refreshAiContact();
  $('aiAllowedCount').textContent='Contatos autorizados: '+aiConfig.allowedJids.length;
  $('aiResult').textContent=approved?'Contato retirado da IA.':'Contato autorizado. Para responder, ative a IA nas Configurações.';
 }catch(e){error(e.message);}
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
window.whatsapp.onChange(kind=>{
 if(kind==='ai'){void loadAi();return;}
 reload(kind).catch(e=>error(e.message));
});
refreshComposer();
void loadAi();
reload('conversas').catch(e=>error(e.message));
