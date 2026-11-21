'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isAllowedJid}=require('./messages.cjs');

const DEFAULTS=Object.freeze({
  enabled:false,
  baseUrl:'https://api.openai.com/v1',
  model:'',
  systemPrompt:'Você é um assistente virtual de atendimento pelo WhatsApp. Responda em português brasileiro de forma clara, cordial e breve. Não invente fatos, preços ou promessas. Quando não souber, diga que uma pessoa deverá conferir.',
  allowedJids:[],
});
function isLocalUrl(url){return url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';}
function validBaseUrl(value){
 if(typeof value!=='string'||value.length>250)throw Error('Endereço da API inválido');
 let u;try{u=new URL(value);}catch{throw Error('Endereço da API inválido');}
 if((u.protocol!=='https:'&&!(u.protocol==='http:'&&isLocalUrl(u)))||
 u.username||u.password||u.search||u.hash||
 /\/chat\/completions\/?$/i.test(u.pathname))throw Error('Use HTTPS (ou HTTP local) e a URL base da API, como https://servidor/v1');
 return u.href.replace(/\/$/,'');
}
function sanitized(patch,current){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Configuração inválida');
 const result={...current};
 if(Object.hasOwn(patch,'baseUrl'))result.baseUrl=validBaseUrl(patch.baseUrl);
 if(Object.hasOwn(patch,'model')){
  if(typeof patch.model!=='string'||!patch.model.trim()||patch.model.length>120)throw Error('Preencha o modelo da IA');
  result.model=patch.model.trim();
 }
 if(Object.hasOwn(patch,'systemPrompt')){
  if(typeof patch.systemPrompt!=='string'||patch.systemPrompt.length>4000)throw Error('Instruções devem ter até 4000 caracteres');
  result.systemPrompt=patch.systemPrompt.trim()||DEFAULTS.systemPrompt;
 }
 if(Object.hasOwn(patch,'allowedJids')){
  if(!Array.isArray(patch.allowedJids)||patch.allowedJids.length>100||patch.allowedJids.some(j=>!isAllowedJid(j)))
   throw Error('Lista de contatos permitidos inválida');
  result.allowedJids=[...new Set(patch.allowedJids)];
 }
 if(Object.hasOwn(patch,'enabled')){
  if(typeof patch.enabled!=='boolean')throw Error('Estado da IA inválido');
  result.enabled=patch.enabled;
 }
 return result;
}
function saveAtomic(file,value){
 const temp=file+'.tmp';
 fs.writeFileSync(temp,value,{mode:0o600});
 fs.renameSync(temp,file);
}
class AiSettings{
 constructor(dataDir,vault){
  this.dataDir=dataDir;this.file=path.join(dataDir,'ia-config.json');
  this.keyFile=path.join(dataDir,'ia-chave.enc');this.vault=vault;
  this.current={...DEFAULTS,allowedJids:[]};
  try{
   const parsed=JSON.parse(fs.readFileSync(this.file,'utf8'));
   const safe={...parsed,enabled:false}; // Config inválida nunca liga IA na abertura.
   this.current=sanitized(safe,this.current);
   this.current.enabled=parsed.enabled===true;
  }catch(e){if(e.code!=='ENOENT')this.current.enabled=false;}
 }
 hasKey(){try{return fs.statSync(this.keyFile).size>0;}catch{return false;}}
 public(){return{...this.current,allowedJids:[...this.current.allowedJids],hasKey:this.hasKey()};}
 getKey(){
  if(!this.hasKey())return '';
  if(!this.vault?.isEncryptionAvailable?.())throw Error('Proteção de chave do sistema indisponível');
  return this.vault.decryptString(fs.readFileSync(this.keyFile));
 }
 update(patch){
  if(Object.hasOwn(patch||{},'apiKey')&&patch.apiKey){
   if(typeof patch.apiKey!=='string'||patch.apiKey.length>1000)throw Error('Chave de API inválida');
   if(!this.vault?.isEncryptionAvailable?.())throw Error('Windows não disponibilizou criptografia para guardar a chave da API');
  }
  const next=sanitized(patch,this.current);
  const clearing=patch?.clearKey===true;
  const hasNewKey=typeof patch?.apiKey==='string'&&Boolean(patch.apiKey);
  if(next.enabled){
   if(!next.model||!next.allowedJids.length)throw Error('Defina o modelo e autorize pelo menos um contato antes de ativar a IA');
   const u=new URL(next.baseUrl);
   if(!isLocalUrl(u)&&!(this.hasKey()||hasNewKey)||clearing&&!hasNewKey&&!isLocalUrl(u))throw Error('Informe a chave da API para ativar respostas externas');
  }
  fs.mkdirSync(this.dataDir,{recursive:true});
  if(hasNewKey)saveAtomic(this.keyFile,this.vault.encryptString(patch.apiKey));
  else if(clearing)fs.rmSync(this.keyFile,{force:true});
  const payload={...next}; // nunca salvar segredo junto das configurações
  saveAtomic(this.file,JSON.stringify(payload,null,2));
  this.current=next;
  return this.public();
 }
}
class AutoResponder{
 constructor({settings,client,store,fetchImpl=globalThis.fetch,delayMs=1500}){
  this.settings=settings;this.client=client;this.store=store;this.fetch=fetchImpl;
  this.delayMs=delayMs;this.pending=new Map();this.running=new Set();
  this.lastSent=new Map();this.hourly=new Map();this.active=true;
  this.stats={sent:0,failed:0,skipped:0,observed:0,scheduled:0,apiCalls:0,lastTrigger:null,lastError:'',lastSkip:''};
 }
 allowed(jid){
  const config=this.settings.public();
  const target=this.store.resolveJid?.(jid)||jid;
  return config.enabled&&config.allowedJids.some(allowed=>(this.store.resolveJid?.(allowed)||allowed)===target);
 }
 skip(reason){this.stats.skipped++;this.stats.lastSkip=reason;}
 handleIncoming(m,source){
  this.stats.observed++;this.stats.lastTrigger=new Date().toISOString();
  if(!this.active){this.skip('IA encerrada');return;}
  if(source!=='tempo_real'){this.skip('Não é mensagem nova');return;}
  if(m.fromMe||m.type!=='text'||!m.text?.trim()||!isAllowedJid(m.jid)){
   this.skip('Mensagem não elegível');return;
  }
  if(!this.settings.public().enabled){this.skip('IA desativada');return;}
  if(!this.allowed(m.jid)){this.skip('Contato sem autorização');return;}
  const jid=this.store.resolveJid?.(m.jid)||m.jid;
  // Agrupa mensagens próximas e evita respostas para cada fragmento.
  if(this.pending.has(jid))clearTimeout(this.pending.get(jid));
  const t=setTimeout(()=>{
   this.pending.delete(jid);
   void this.reply(jid).catch(e=>{
    this.stats.failed++;this.stats.lastError=this.safeError(e);
   });
  },this.delayMs);
  this.pending.set(jid,t);this.stats.scheduled++;
  this.stats.lastSkip='';
 }
 safeError(error){
  const message=String(error?.message||error);
  // Nunca registrar cabeçalhos, prompts, chaves, URLs ou conteúdo do provedor.
  if(/HTTP 401|HTTP 403/.test(message))return 'A API recusou a autenticação (HTTP 401/403). Verifique chave e permissões.';
  if(/HTTP 404/.test(message))return 'A API retornou HTTP 404. Confirme a URL base e o nome do modelo.';
  if(/HTTP 429/.test(message))return 'A API retornou HTTP 429. Verifique limite, créditos ou taxa de uso.';
  if(/HTTP 5\d\d/.test(message))return 'O provedor de IA retornou erro no servidor.';
  if(/HTTP 400/.test(message))return 'A API retornou HTTP 400. Confira modelo e compatibilidade Chat Completions.';
  if(/tempo limite|abort|timeout/i.test(message))return 'A API demorou mais que o limite de espera.';
  if(/fetch failed|ENOTFOUND|ECONNREFUSED|network|certificate|TLS/i.test(message))return 'Falha na conexão com a API. Confira URL, rede e certificado.';
  if(/chave|criptografia|proteção/.test(message))return 'Não foi possível usar a chave de API protegida neste Windows.';
  if(/resposta de texto|JSON inválido|conteúdo excessivo/.test(message))return 'O provedor retornou resposta incompatível com Chat Completions.';
  if(/WhatsApp não conectado/.test(message))return 'WhatsApp estava desconectado na hora de enviar.';
  return 'Erro ao consultar a IA ou enviar resposta. Verifique a configuração e teste a API.';
 }
 async chatRequest(config,messages){
  if(!config.model?.trim())throw Error('Defina o modelo antes de testar a IA');
  const key=this.settings.getKey();
  const url=new URL(config.baseUrl);
  if(!isLocalUrl(url)&&!key)throw Error('A chave de API é obrigatória em serviços externos');
  const endpoint=config.baseUrl.replace(/\/$/,'')+'/chat/completions';
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),45000);
  this.stats.apiCalls++;
  try{
   const response=await this.fetch(endpoint,{
    method:'POST',signal:ctrl.signal,
    headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},
    body:JSON.stringify({model:config.model,stream:false,messages})
   });
   if(!response.ok)throw Error('HTTP '+response.status);
   const raw=await response.text();
   if(raw.length>65536)throw Error('conteúdo excessivo');
   let data;try{data=JSON.parse(raw);}catch{throw Error('JSON inválido');}
   const content=data?.choices?.[0]?.message?.content;
   const answer=typeof content==='string'?content:
     Array.isArray(content)?content.filter(p=>p?.type==='text'&&typeof p?.text==='string').map(p=>p.text).join('\n'):'';
   if(!answer.trim())throw Error('resposta de texto ausente');
   return answer.trim().slice(0,1400);
  }finally{clearTimeout(timer);}
 }
 async testConnection(){
  try{
   const reply=await this.chatRequest(this.settings.public(),[
    {role:'system',content:'Responda brevemente em português.'},
    {role:'user',content:'Teste técnico de conexão. Responda apenas OK.'}
   ]);
   this.stats.lastError='';
   return{success:true,preview:reply.slice(0,200)};
  }catch(e){
   const reason=this.safeError(e);this.stats.lastError=reason;
   return{success:false,error:reason};
  }
 }
 async generate(jid,config){
  const history=this.store.messages(jid,12).filter(m=>m.kind==='text'&&m.body).map(m=>({
   role:m.from_me?'assistant':'user',content:String(m.body).slice(0,1800)
  }));
  if(!history.some(m=>m.role==='user'))return '';
  return this.chatRequest(config,[{role:'system',content:config.systemPrompt},...history]);
 }
 async reply(jid){
  if(!this.active||this.running.has(jid)||!this.allowed(jid))return;
  if(this.client.status?.state!=='conectado'){this.skip('WhatsApp desconectado');return;}
  const now=Date.now();
  if(now-(this.lastSent.get(jid)||0)<8000){this.skip('Intervalo mínimo entre respostas');return;}
  const recent=this.hourly.get(jid)||[];
  const valid=recent.filter(t=>now-t<3600000);
  if(valid.length>=20){this.skip('Limite de 20 respostas por hora');return;}
  this.running.add(jid);
  try{
   const config=this.settings.public();
   const answer=await this.generate(jid,config);
   if(!answer){this.skip('Sem texto para responder');return;}
   if(!this.active||!this.allowed(jid)||this.client.status?.state!=='conectado')return;
   await this.client.sendText(jid,'🤖 '+answer);
   this.lastSent.set(jid,Date.now());this.hourly.set(jid,[...valid,Date.now()]);
   this.stats.sent++;this.stats.lastError='';this.stats.lastSkip='';
  }catch(e){
   this.stats.failed++;this.stats.lastError=this.safeError(e);
  }finally{this.running.delete(jid);}
 }
 stop(){
  this.active=false;
  for(const t of this.pending.values())clearTimeout(t);
  this.pending.clear();
 }
}
module.exports={AiSettings,AutoResponder,validBaseUrl};
