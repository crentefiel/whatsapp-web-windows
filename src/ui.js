'use strict';
const $=id=>document.getElementById(id);
let selected=null,chats=[],reloading=false,pendingStatus=false,pendingConversations=false;
let currentState='desconectado',sendingText=false,sendingFile=false;
let aiConfig={enabled:false,allowedJids:[],hasKey:false,responseScope:'selected'};
let learningMode='observation',currentSuggestion=null,learnPage=1,settingsTab='whatsapp',picking=false;
const picked=new Set();
const pickedExamples=new Set();
const heldJids=new Set();
const learningLabels={
 observation:'Observação: a IA aprende com suas respostas humanas, mas não sugere nem envia mensagens.',
 suggestion:'Sugestão: a IA prepara uma resposta editável. Só envia depois da sua aprovação.',
 automatic:'Automático: a IA responde somente com evidências humanas semelhantes e regras aprovadas.'
};
function learningStatus(message){$('learnResult').textContent=message||'';}
const bannerLabels={
 observation:'Modo: Observação · Aprendendo com suas respostas',
 suggestion:'Modo: Sugestão · Preparando respostas para você aprovar',
 automatic:'Modo: Automático · Respondendo com base no aprendizado'
};
function updateLearningBanner(data){
 const banner=document.getElementById('learningBanner');
 if(!banner||!data)return;
 banner.textContent=(bannerLabels[data.mode]||'Modo de aprendizado')+' · '+data.examples+' exemplos aprendidos';
 banner.className='learning-banner mode-'+(data.mode||'observation');
}
async function loadLearningOverview(){
 if(typeof window.whatsapp.learnStats!=='function')return;
 const data=await window.whatsapp.learnStats();
 learningMode=data.mode;
 $('learnMode').value=data.mode;
 $('learnModeHint').textContent=learningLabels[data.mode]||'';
 $('learnStats').textContent='Exemplos observados: '+data.examples+
  ' · Aprovados: '+data.approved+' · Clientes na memória: '+data.contacts+
  ' · Regras aprovadas: '+data.approvedRules;
 updateLearningBanner(data);
}
function smallDiv(className,content){
 const node=document.createElement('div');node.className=className;node.textContent=content;
 return node;
}
function exampleCard(item){
 const card=document.createElement('div');card.className='learn-example';
 const question=smallDiv('small','Cliente disse:\n'+item.question);
 const box=document.createElement('input');
 box.type='checkbox';box.className='pick-example';box.checked=pickedExamples.has(item.id);
 box.setAttribute('aria-label','Selecionar este exemplo');
 box.addEventListener('click',ev=>ev?.stopPropagation?.());
 box.addEventListener('change',()=>{
  if(box.checked)pickedExamples.add(item.id);else pickedExamples.delete(item.id);
  refreshExampleTools();
 });
 if(typeof question.insertBefore==='function'&&question.firstChild)question.insertBefore(box,question.firstChild);
 else question.append(box);
 const label=smallDiv('small','Sua resposta ('+item.status+'):');
 const editable=document.createElement('textarea');editable.value=item.reply;editable.rows=3;editable.maxLength=3000;
 const row=document.createElement('div');row.className='learning-actions';
 const approve=document.createElement('button');approve.type='button';approve.textContent='Corrigir / aprovar';
 const reject=document.createElement('button');reject.type='button';reject.className='secondary-action';reject.textContent='Desconsiderar';
 const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Apagar';
 approve.addEventListener('click',async()=>{
  try{
   await window.whatsapp.learnExampleUpdate(item.id,editable.value,'approved');
   learningStatus('Exemplo aprovado e guardado na memória.');
   await loadLearningDetails();await loadLearningOverview();
  }catch(e){learningStatus(readableError(e));}
 });
 reject.addEventListener('click',async()=>{
  try{
   await window.whatsapp.learnExampleUpdate(item.id,editable.value,'rejected');
   learningStatus('Exemplo descartado do aprendizado.');
   await loadLearningDetails();await loadLearningOverview();
  }catch(e){learningStatus(readableError(e));}
 });
 remove.addEventListener('click',async()=>{
  if(typeof window.whatsapp.learnDeleteExamples!=='function'){learningStatus('Apagar exemplos não está disponível nesta versão.');return;}
  try{
   const result=await window.whatsapp.learnDeleteExamples([item.id]);
   if(!result||result.canceled)return;
   pickedExamples.delete(item.id);
   learningStatus('Exemplo apagado. A IA deixa de usar essa resposta.');
   await loadLearningDetails();await loadLearningOverview();
  }catch(e){learningError(e);}
 });
 row.append(approve,reject,remove);card.append(question,label,editable,row);return card;
}
function refreshExampleTools(){
 const bar=$('learnExampleTools');
 if(!bar)return;
 const can=typeof window.whatsapp.learnDeleteExamples==='function';
 bar.hidden=!can;
 const del=$('learnDeleteSelected');
 if(del){
  del.disabled=!pickedExamples.size;
  del.textContent=pickedExamples.size?('Apagar '+pickedExamples.size+' marcados'):'Apagar marcados';
 }
 const all=$('learnDeleteContact');
 if(all)all.disabled=!selected;
}
async function loadLearningDetails(){
 if(typeof window.whatsapp.learnExamples!=='function'&&typeof window.whatsapp.learnExamplesPage!=='function')return;
 const jid=selected;
 const sampleHost=$('learnExamples'),ruleHost=$('learnRules'),pager=$('learnPager');
 if(!jid){
  sampleHost.replaceChildren(smallDiv('small','Selecione uma conversa para rever exemplos.'));
  if(pager){pager.hidden=true;pager.replaceChildren();}
  refreshExampleTools();
 }else{
  let items=[],page=1,pages=1,total=0;
  if(typeof window.whatsapp.learnExamplesPage==='function'){
   const data=await window.whatsapp.learnExamplesPage(jid,learnPage);
   if(jid!==selected)return;
   items=data.items||[];total=data.total||items.length;page=data.page||1;pages=data.pages||1;learnPage=page;
  }else{
   const samples=await window.whatsapp.learnExamples(jid);
   if(jid!==selected)return;
   items=samples.slice(0,12);total=samples.length;page=1;pages=1;
  }
  const entries=items.map(exampleCard);
  sampleHost.replaceChildren(...(entries.length?entries:[smallDiv('small','Ainda sem exemplos deste contato. Continue conversando normalmente ou importe o histórico local.')]));
  refreshExampleTools();
  if(pager){
   if(pages<=1){pager.hidden=true;pager.replaceChildren();}
   else{
    pager.hidden=false;
    const prev=document.createElement('button');prev.type='button';prev.className='secondary-action';prev.textContent='Anterior';prev.disabled=page<=1;
    const next=document.createElement('button');next.type='button';next.className='secondary-action';next.textContent='Próxima';next.disabled=page>=pages;
    const label=smallDiv('small','Página '+page+' de '+pages+' · '+total+' exemplos');
    prev.addEventListener('click',()=>{if(page>1){learnPage=page-1;void loadLearningDetails().catch(learningError);}});
    next.addEventListener('click',()=>{if(page<pages){learnPage=page+1;void loadLearningDetails().catch(learningError);}});
    pager.replaceChildren(prev,label,next);
   }
  }
 }
 const rules=await window.whatsapp.learnRules(jid||null);
 if(jid!==selected)return;
 const cards=rules.slice(0,25).map(r=>{
  const card=document.createElement('div');card.className='learn-rule';
  card.append(smallDiv('small',(r.jid?'Contato':'Empresa')+' · '+r.state),smallDiv('',''+r.content));
  if(r.state==='draft'){
   const row=document.createElement('div');row.className='learning-actions';
   const approve=document.createElement('button');approve.type='button';approve.textContent='Aprovar regra';
   const reject=document.createElement('button');reject.type='button';reject.className='secondary-action';reject.textContent='Rejeitar';
   approve.addEventListener('click',async()=>{
    try{await window.whatsapp.learnApproveRule(r.id,true);await loadLearningDetails();await loadLearningOverview();}
    catch(e){learningStatus(e.message);}
   });
   reject.addEventListener('click',async()=>{
    try{await window.whatsapp.learnApproveRule(r.id,false);await loadLearningDetails();await loadLearningOverview();}
    catch(e){learningStatus(e.message);}
   });
   row.append(approve,reject);card.append(row);
  }
  return card;
 });
 ruleHost.replaceChildren(...(cards.length?cards:[smallDiv('small','Nenhuma regra cadastrada.')]));
 await loadLearningSuggestion();
}
async function loadLearningSuggestion(){
 const wait=$('learnSuggestionWait');
 const hideWait=()=>{if(wait)wait.hidden=true;};
 if(typeof window.whatsapp.learnSuggestion!=='function'){hideWait();return;}
 const jid=selected;
 if(!jid||learningMode!=='suggestion'){
  currentSuggestion=null;$('learnSuggestion').hidden=true;hideWait();return;
 }
 const s=await window.whatsapp.learnSuggestion(jid);
 if(jid!==selected)return;
 currentSuggestion=s;
 $('learnSuggestion').hidden=!s;
 if(wait)wait.hidden=Boolean(s);
 if(s){
  $('learnSuggestionText').value=s.answer;
  $('learnSuggestionResult').textContent='';
 }
}
function learningError(e){learningStatus(readableError(e));}
function readableError(value){
 return String(value&&value.message?value.message:value||'').replace(/^Error invoking remote method '[^']+':\s*/i,'').replace(/^Error:\s*/,'');
}

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
 btn.hidden=!selected||aiConfig.responseScope==='all';
 const approved=!!selected&&aiConfig.allowedJids.includes(selected);
 btn.textContent=approved?'IA autorizada':'Autorizar IA';
 btn.className=approved?'approved':'';
 btn.title=approved?'Clique para impedir a IA de responder este contato':'Clique para permitir respostas automáticas a este contato';
}
function refreshAiScope(){
 const all=$('aiScope').value==='all';
 $('aiAllowedCount').textContent=all?'Modo escolhido: todos os contatos individuais (sem grupos e canais)':
   'Contatos autorizados: '+(aiConfig.allowedJids?.length||0);
 $('aiScopeHelp').textContent=all?
  'Ao salvar e ativar, mensagens novas de qualquer contato individual poderão receber resposta. O provedor poderá processar mensagens recentes da conversa. Não inclui grupos, canais, comunidades nem status.':
  'Abra a conversa de um contato e clique em “Autorizar IA”. Somente contatos autorizados receberão respostas automáticas.';
}
async function loadAi(){
 try{
  aiConfig=await window.whatsapp.aiSettings();
  $('aiBaseUrl').value=aiConfig.baseUrl||'https://api.openai.com/v1';
  $('aiModel').value=aiConfig.model||'';
  $('aiPrompt').value=aiConfig.systemPrompt||'';
  $('aiEnabled').checked=Boolean(aiConfig.enabled);
  $('aiScope').value=aiConfig.responseScope||'selected';
  refreshAiScope();
  const stats=await window.whatsapp.aiDiagnostics();
  $('aiHealth').textContent='Entradas avaliadas: '+(stats.observed||0)+' · Agendadas: '+(stats.scheduled||0)+' · Chamadas à API: '+(stats.apiCalls||0)+' · Respostas enviadas: '+(stats.sent||0)+' · Falhas: '+(stats.failed||0)+' · Ignoradas: '+(stats.skipped||0)+(stats.lastError?' · Último erro: '+stats.lastError:'')+(stats.lastSkip?' · Último bloqueio: '+stats.lastSkip:'');
  $('aiKeyStatus').textContent=aiConfig.hasKey?'Chave de API protegida e salva. Deixe o campo em branco para mantê-la.':'Nenhuma chave salva (API local pode funcionar sem chave).';
  $('aiClearKey').disabled=!aiConfig.hasKey;
  refreshAiContact();
 }catch(e){$('aiResult').textContent='Não foi possível carregar a IA: '+e.message;}
}
function showTab(name){
 const tabs=[['whatsapp','panelWhatsapp','tabWhatsapp'],['ia','panelIa','tabIa'],['memoria','panelMemoria','tabMemoria'],['empresa','panelEmpresa','tabEmpresa']];
 for(const [key,panelId,tabId] of tabs){
  const panel=$(panelId),tab=$(tabId);
  if(panel)panel.hidden=key!==name;
  if(tab){
   tab.className='tab'+(key===name?' active':'');
   tab.setAttribute?.('aria-selected',String(key===name));
  }
 }
 settingsTab=name;
 if(name==='empresa')void loadCompany().catch(e=>{$('companyResult').textContent=e.message;});
}
async function loadCompany(){
 if(typeof window.whatsapp.companyGet!=='function')return;
 const c=await window.whatsapp.companyGet();
 $('companyName').value=c.name||'';
 $('companyAbout').value=c.about||'';
 $('companyHours').value=c.hours||'';
 $('companyAddress').value=c.address||'';
 $('companyCatalog').value=c.catalog||'';
}
function fillCompany(saved){
 $('companyName').value=saved.name||'';
 $('companyAbout').value=saved.about||'';
 $('companyHours').value=saved.hours||'';
 $('companyAddress').value=saved.address||'';
 $('companyCatalog').value=saved.catalog||'';
}
function toggleSettings(open){
 $('settingsPanel').hidden=!open;
 $('openSettings').setAttribute('aria-expanded',String(open));
 if(document.body?.classList)document.body.classList.toggle('settings-open',open);
 if(open){
  showTab(settingsTab);
  $('closeSettings').focus();void loadAi();
  void loadLearningOverview().then(()=>loadLearningDetails()).catch(learningError);
 }else{$('openSettings').focus();}
}
function error(message){$('error').textContent=readableError(message).slice(0,220);}
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
   const mediaNote=s.lastMediaNote?' · Mídia: '+s.lastMediaNote:'';
   $('health').textContent='Eventos Baileys: '+(s.upserts||0)+' · Mensagens recebidas: '+(s.received||0)+' · Salvas: '+(s.saved||0)+' · Ignoradas: '+(s.ignored||0)+' · Duplicadas: '+(s.duplicates||0)+' · Falhas de mídia: '+(s.mediaErrors||0)+' · Erros: '+(s.errors||0)+' · Última entrada: '+(s.lastIncoming?dateString(s.lastIncoming):'nenhuma')+' · Último evento: '+(s.lastEvent?dateString(s.lastEvent):'nenhum')+mediaNote;
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
function visibleChats(){
 return chats.filter(c=>(c.name+' '+c.jid).toLowerCase().includes($('search').value.toLowerCase()));
}
function refreshChatTools(){
 const toggle=$('pickChats');
 if(!toggle)return;
 toggle.textContent=picking?'Cancelar':'Selecionar';
 $('pickAll').hidden=!picking;
 $('forgetChats').hidden=!picking;
 $('forgetChats').disabled=!picked.size;
 $('forgetChats').textContent=picked.size?('Apagar '+picked.size):'Apagar selecionadas';
}
function clearOpenChat(){
 selected=null;currentSuggestion=null;
 $('contactTitle').textContent='Selecione uma conversa';
 $('contactJid').textContent='';
 $('refreshPhoto').hidden=true;$('openContactFolder').hidden=true;
 const hold=$('humanHold');if(hold)hold.hidden=true;
 const holdNote=$('humanHoldNote');if(holdNote)holdNote.hidden=true;
 $('learnSuggestion').hidden=true;
 const wait=$('learnSuggestionWait');if(wait)wait.hidden=true;
 $('messages').replaceChildren();
 refreshComposer();refreshAiContact();
}
function renderChats(){
 const filtered=visibleChats();
 $('conversations').replaceChildren(...filtered.map(c=>{
   const el=document.createElement('div');
   el.className='person'+(selected===c.jid?' selected':'')+(picking&&picked.has(c.jid)?' picked':'')+(heldJids.has(c.jid)?' needs-human':'');
   el.setAttribute('role','listitem');
   if(picking){
     const box=document.createElement('input');
     box.type='checkbox';box.checked=picked.has(c.jid);
     box.setAttribute('aria-label','Selecionar conversa');
     box.addEventListener('click',ev=>ev?.stopPropagation?.());
     box.addEventListener('change',()=>{
       if(box.checked)picked.add(c.jid);else picked.delete(c.jid);
       el.className='person'+(selected===c.jid?' selected':'')+(picked.has(c.jid)?' picked':'');
       refreshChatTools();
     });
     el.append(box);
   }
   const label=document.createElement('strong');label.textContent=c.name||readable(c.jid);
   const prev=document.createElement('div');prev.className='preview';prev.textContent=c.preview||('['+(c.preview_kind||'Conversa')+']');
   el.append(label,prev);
   if(heldJids.has(c.jid)){
    const flag=document.createElement('em');flag.className='hold-flag';flag.textContent='Você atende';
    el.append(flag);
   }
   el.addEventListener('click',()=>{
     if(picking){
       if(picked.has(c.jid))picked.delete(c.jid);else picked.add(c.jid);
       renderChats();return;
     }
     choose(c);
   });
   return el;
 }));
 refreshChatTools();
}
async function refreshHeld(){
 if(typeof window.whatsapp.learnHeld!=='function')return;
 const rows=await window.whatsapp.learnHeld();
 heldJids.clear();
 for(const jid of rows||[])heldJids.add(jid);
}
const holdNotes={
 pessoa:'Este cliente pediu para falar com você. A IA parou nesta conversa.',
 dados:'Este cliente pediu para apagar os dados. A IA parou. Nada foi apagado.',
 preco:'A IA não tinha esse preço. Avisou que você confirma e parou nesta conversa.',
 manual:'Você está atendendo. A IA não responde até você devolver.'
};
async function loadHumanHold(){
 const btn=$('humanHold'),note=$('humanHoldNote');
 if(!btn)return;
 if(!selected||typeof window.whatsapp.learnHold!=='function'){
  btn.hidden=true;if(note)note.hidden=true;return;
 }
 const info=await window.whatsapp.learnHold(selected);
 btn.hidden=false;
 btn.textContent=info?.active?'Devolver para a IA':'Estou atendendo';
 btn.className=info?.active?'approved':'';
 if(!note)return;
 if(!info?.active){note.hidden=true;return;}
 note.hidden=false;
 note.textContent=info.manual?(holdNotes[info.note]||holdNotes.manual):'A IA pausou porque você respondeu. Ela volta sozinha, ou clique em Devolver para a IA.';
}
async function conversations(){
 try{
  chats=await window.whatsapp.conversations();
  await refreshHeld().catch(()=>{});
  renderChats();
 }catch(e){error(e.message);}
}
async function choose(c){
 selected=c.jid;learnPage=1;pickedExamples.clear();$('contactTitle').textContent=c.name||readable(c.jid);$('contactJid').textContent=c.jid;
 $('refreshPhoto').hidden=false;$('openContactFolder').hidden=false;photo(c.jid,c.photo);renderChats();refreshComposer();refreshAiContact();await messages();await status();
 void loadHumanHold().catch(()=>{});
 void loadLearningDetails().catch(learningError);
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
     if(['image','audio','video','document','sticker'].includes(m.kind)&&!media){const missing=document.createElement('em');missing.textContent='[Mídia não disponível]';missing.title='O arquivo não abriu neste computador. Peça para enviarem de novo se ainda precisar dele.';div.append(missing);}
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
     if(needConversations){await conversations();await messages();await loadLearningSuggestion().catch(()=>{});}
     await status();
   }
 }finally{reloading=false;}
}
$('openSettings').addEventListener('click',()=>toggleSettings(true));
$('closeSettings').addEventListener('click',()=>toggleSettings(false));
for(const [id,name] of [['tabWhatsapp','whatsapp'],['tabIa','ia'],['tabMemoria','memoria'],['tabEmpresa','empresa']]){
 $(id).addEventListener('click',()=>{
  showTab(name);
  if(name==='ia')void loadAi();
  if(name==='memoria')void loadLearningOverview().then(()=>loadLearningDetails()).catch(learningError);
 });
}
$('learnRepair').addEventListener('click',async()=>{
 if(typeof window.whatsapp.learnRepair!=='function'){learningStatus('Atualização de memória indisponível nesta versão.');return;}
 const btn=$('learnRepair');btn.disabled=true;
 learningStatus('Reorganizando a fala do cliente nos exemplos observados...');
 try{
  const report=await window.whatsapp.learnRepair();
  learningStatus('Falas atualizadas: '+(report.updated||0)+' de '+(report.checked||0)+' exemplos observados.');
  await loadLearningOverview();await loadLearningDetails();
 }catch(e){learningError(e);}finally{btn.disabled=false;}
});
$('companyForm').addEventListener('submit',async event=>{
 event.preventDefault();
 if(typeof window.whatsapp.companySave!=='function')return;
 const btn=$('companySave');btn.disabled=true;
 $('companyResult').textContent='Salvando dados da empresa...';
 try{
  fillCompany(await window.whatsapp.companySave({
   name:$('companyName').value,about:$('companyAbout').value,hours:$('companyHours').value,
   address:$('companyAddress').value,catalog:$('companyCatalog').value
  }));
  $('companyResult').textContent='Dados da empresa salvos. A IA passa a usar isso como fato oficial.';
 }catch(e){$('companyResult').textContent=e.message;}
 finally{btn.disabled=false;}
});
$('companyPull').addEventListener('click',async()=>{
 if(typeof window.whatsapp.companyPull!=='function')return;
 const btn=$('companyPull');btn.disabled=true;
 $('companyResult').textContent='Buscando perfil e catálogo do WhatsApp...';
 try{
  const saved=await window.whatsapp.companyPull();
  fillCompany(saved);
  $('companyResult').textContent=saved.catalog?'Perfil e catálogo trazidos. Confira os preços antes de usar.':'Perfil trazido. Não veio catálogo — complete os preços à mão.';
 }catch(e){$('companyResult').textContent=e.message;}
 finally{btn.disabled=false;}
});
$('pickChats').addEventListener('click',()=>{
 picking=!picking;
 if(!picking)picked.clear();
 renderChats();
});
$('pickAll').addEventListener('click',async()=>{
 const query=$('search').value.trim();
 if(!query&&typeof window.whatsapp.conversationJids==='function'){
  try{
   const jids=await window.whatsapp.conversationJids();
   if(Array.isArray(jids)&&jids.length){
    const allOn=jids.every(j=>picked.has(j));
    for(const j of jids){if(allOn)picked.delete(j);else picked.add(j);}
    renderChats();
    return;
   }
  }catch(e){error(e.message);return;}
 }
 const visible=visibleChats();
 const allOn=visible.length>0&&visible.every(c=>picked.has(c.jid));
 for(const c of visible){if(allOn)picked.delete(c.jid);else picked.add(c.jid);}
 renderChats();
});
$('forgetChats').addEventListener('click',async()=>{
 if(!picked.size)return;
 if(typeof window.whatsapp.forgetChats!=='function'){error('Apagar conversas não está disponível nesta versão.');return;}
 const ids=[...picked];
 try{
  const result=await window.whatsapp.forgetChats(ids);
  if(!result||result.canceled)return;
  const removedOpen=selected&&ids.includes(selected);
  picked.clear();picking=false;
  if(removedOpen)clearOpenChat();
  await conversations();
  await loadLearningOverview().catch(()=>{});
  error('');
 }catch(e){error(e.message);}
});
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
$('aiScope').addEventListener('change',refreshAiScope);
$('learnMode').addEventListener('change',async()=>{
 const next=$('learnMode').value,previous=learningMode;
 try{
  const result=await window.whatsapp.learnMode(next);
  if(result?.canceled){
   $('learnMode').value=previous;
   if(result.message){
    learningStatus(result.message);
    if(result.openIa&&$('aiResult'))$('aiResult').textContent=result.message;
   }
   if(result.openIa)showTab('ia');
   return;
  }
  await loadLearningOverview();
  if(learningMode==='automatic'){
   try{aiConfig=await window.whatsapp.aiSettings();$('aiEnabled').checked=Boolean(aiConfig.enabled);}catch{}
  }
  learningStatus('Modo atualizado: '+(learningLabels[learningMode]||learningMode));
  await loadLearningSuggestion();
 }catch(e){$('learnMode').value=previous;learningError(e);}
});
$('learnBackfill').addEventListener('click',async()=>{
 const btn=$('learnBackfill');btn.disabled=true;
 learningStatus('Importando exemplos do histórico local, sem usar a API...');
 try{
  const report=await window.whatsapp.learnRebuild();
  learningStatus('Histórico importado: '+report.imported+' novos exemplos, total '+report.total+'. Nenhuma regra ou preço foi aprovado automaticamente.');
  await loadLearningOverview();await loadLearningDetails();
 }catch(e){learningError(e);}finally{btn.disabled=false;}
});
$('learnDeleteSelected').addEventListener('click',async()=>{
 if(!pickedExamples.size)return;
 if(typeof window.whatsapp.learnDeleteExamples!=='function'){learningStatus('Apagar exemplos não está disponível nesta versão.');return;}
 const ids=[...pickedExamples];
 try{
  const result=await window.whatsapp.learnDeleteExamples(ids);
  if(!result||result.canceled)return;
  pickedExamples.clear();
  learningStatus('Exemplos apagados. A IA deixa de usar essas respostas.');
  await loadLearningDetails();await loadLearningOverview();
 }catch(e){learningError(e);}
});
$('learnDeleteContact').addEventListener('click',async()=>{
 if(!selected){learningStatus('Selecione um contato primeiro.');return;}
 if(typeof window.whatsapp.learnDeleteContactExamples!=='function'){learningStatus('Apagar exemplos não está disponível nesta versão.');return;}
 try{
  const result=await window.whatsapp.learnDeleteContactExamples(selected);
  if(!result||result.canceled)return;
  pickedExamples.clear();
  learningStatus('Exemplos deste contato apagados. A IA não responde mais com base neles.');
  await loadLearningDetails();await loadLearningOverview();
 }catch(e){learningError(e);}
});
$('learnRuleAdd').addEventListener('click',async()=>{
 const text=$('learnRuleText').value,jid=$('learnRuleScope').value==='contact'?selected:null;
 if(!String(text||'').trim()){learningStatus('Escreva a regra antes de salvar.');return;}
 if($('learnRuleScope').value==='contact'&&!jid){learningStatus('Selecione um contato primeiro.');return;}
 try{
  await window.whatsapp.learnAddRule(text,jid);
  $('learnRuleText').value='';
  learningStatus('Regra salva como rascunho, aguardando aprovação.');
  await loadLearningDetails();
 }catch(e){learningError(e);}
});
$('learnSendSuggestion').addEventListener('click',async()=>{
 if(!selected||!currentSuggestion)return;
 const btn=$('learnSendSuggestion');btn.disabled=true;
 try{
  await window.whatsapp.learnSendSuggestion(currentSuggestion.id,selected,$('learnSuggestionText').value);
  $('learnSuggestionResult').textContent='Mensagem aprovada e enviada ao contato.';
  await loadLearningSuggestion();
  await reload('conversas');
 }catch(e){$('learnSuggestionResult').textContent=e.message;}
 finally{btn.disabled=false;}
});
$('learnRejectSuggestion').addEventListener('click',async()=>{
 if(!selected||!currentSuggestion)return;
 try{await window.whatsapp.learnRejectSuggestion(currentSuggestion.id,selected);
  await loadLearningSuggestion();
 }catch(e){$('learnSuggestionResult').textContent=e.message;}
});
$('aiForm').addEventListener('submit',async event=>{
 event.preventDefault();
 const saveButton=$('aiSave');
 if(saveButton.disabled)return;
 saveButton.disabled=true;
 $('aiResult').textContent='Salvando configurações...';
 const config={
  baseUrl:$('aiBaseUrl').value.trim(),model:$('aiModel').value.trim(),
  systemPrompt:$('aiPrompt').value,enabled:Boolean($('aiEnabled').checked),
  responseScope:$('aiScope').value,apiKey:$('aiApiKey').value
 };
 try{
  const result=await window.whatsapp.aiSave(config);
  aiConfig=result;
  $('aiApiKey').value='';
  $('aiEnabled').checked=Boolean(result.enabled);
  $('aiScope').value=result.responseScope||'selected';
  $('aiResult').textContent=result.enabled?
   (result.responseScope==='all'?'Configurações salvas! IA ativada para todos os contatos individuais.':
   'Configurações salvas! IA ativada para os contatos autorizados.'):
   'Configurações salvas! Respostas automáticas desativadas.';
  refreshAiScope();
  refreshAiContact();
 }catch(e){
  // Preserve os valores digitados e a seleção, permitindo corrigir sem recomeçar.
  $('aiResult').textContent='Não foi possível salvar: '+e.message;
 }finally{saveButton.disabled=false;}
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
  refreshAiScope();
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
$('humanHold').addEventListener('click',async()=>{
 if(!selected)return;
 if(typeof window.whatsapp.learnTake!=='function'||typeof window.whatsapp.learnRelease!=='function')return;
 try{
  const info=typeof window.whatsapp.learnHold==='function'?await window.whatsapp.learnHold(selected):null;
  if(info?.active)await window.whatsapp.learnRelease(selected);
  else await window.whatsapp.learnTake(selected);
  await loadHumanHold();
  await refreshHeld();
  renderChats();
 }catch(e){error(e);}
});
window.whatsapp.onChange(kind=>{
 if(kind==='learning'){
  void loadHumanHold().catch(()=>{});
  void refreshHeld().then(()=>renderChats()).catch(()=>{});
  void loadLearningOverview().then(()=>loadLearningDetails()).catch(learningError);return;
 }
 if(kind==='ai'){return;} // Não sobrescrever campos ainda não salvos enquanto o usuário edita.
 reload(kind).catch(e=>error(e.message));
});
refreshComposer();
void loadLearningOverview().then(()=>loadLearningDetails()).catch(learningError);
void loadAi();
reload('conversas').catch(e=>error(e.message));
