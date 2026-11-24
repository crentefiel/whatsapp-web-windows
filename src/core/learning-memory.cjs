'use strict';
const {isAllowedJid}=require('./messages.cjs');

const MODES=Object.freeze(['observation','suggestion','automatic']);
const LIMIT_REPLY=3000;
const MINUTE=60000;
function words(s){
 return new Set(String(s||'').toLocaleLowerCase('pt-BR')
   .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .match(/[a-z0-9]{2,}/g)?.filter(x=>!['de','da','do','em','ao','na','no','pra','para','com','que','uma','um','por','tem'].includes(x))||[]);
}
function similarity(a,b){
 const x=words(a),y=words(b);
 if(!x.size||!y.size)return 0;
 let hits=0;for(const token of x)if(y.has(token))hits++;
 return hits/Math.max(x.size,y.size);
}
function describeInbound(row){
 const body=String(row?.body||'').trim();
 if(!row||row.kind==='protocol'||row.kind==='reaction')return '';
 if(row.kind==='text'||!row.kind)return body;
 const label={image:'imagem',video:'vídeo',audio:'áudio',document:'documento',sticker:'figurinha'}[row.kind]||row.kind;
 return body?`[${label}] ${body}`:`[${label} do cliente]`;
}
function hasPrice(text){return /\bR\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:reais|real)\b/i.test(text);}
class LearningMemory{
 constructor(store,changed=()=>{}){
  this.store=store;this.db=store.db;this.changed=changed;
  // Tabelas novas, nunca modifica nem apaga o histórico/credenciais existentes.
  this.db.exec(`CREATE TABLE IF NOT EXISTS learning_state(id INTEGER PRIMARY KEY CHECK(id=1),
    mode TEXT NOT NULL DEFAULT 'observation');
   INSERT OR IGNORE INTO learning_state(id,mode) VALUES(1,'observation');
   CREATE TABLE IF NOT EXISTS learning_examples(
    id INTEGER PRIMARY KEY AUTOINCREMENT,jid TEXT NOT NULL,question_id TEXT,
    reply_id TEXT NOT NULL,question TEXT NOT NULL,reply TEXT NOT NULL,
    reply_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'observed',
    source TEXT NOT NULL DEFAULT 'whatsapp',
    UNIQUE(jid,reply_id));
   CREATE INDEX IF NOT EXISTS idx_learning_samples ON learning_examples(jid,reply_at DESC);
   CREATE TABLE IF NOT EXISTS learning_rules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,jid TEXT,content TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS learning_suggestions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,jid TEXT NOT NULL,question_id TEXT NOT NULL,
    answer TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_learning_suggest ON learning_suggestions(jid,id DESC);
   CREATE TABLE IF NOT EXISTS learning_bot_messages(
    jid TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(jid,id));
   CREATE TABLE IF NOT EXISTS learning_human_hold(
    jid TEXT PRIMARY KEY,until_ms INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS company_profile(
    id INTEGER PRIMARY KEY CHECK(id=1),
    name TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    catalog TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0);
   INSERT OR IGNORE INTO company_profile(id) VALUES(1);`);
  this.getModeStmt=this.db.prepare('SELECT mode FROM learning_state WHERE id=1');
 }
 mode(){return this.getModeStmt.get()?.mode||'observation';}
 setMode(mode){
  if(!MODES.includes(mode))throw Error('Modo de aprendizado inválido');
  this.db.prepare('UPDATE learning_state SET mode=? WHERE id=1').run(mode);
  this.changed('learning');return this.mode();
 }
 jid(jid){if(!isAllowedJid(jid))throw Error('Contato inválido');return this.store.resolveJid(jid);}
 isBot(jid,id){return !!this.db.prepare('SELECT 1 AS ok FROM learning_bot_messages WHERE jid=? AND id=?').get(this.jid(jid),String(id||''));}
 markBot(jid,id){
  if(!id)return;
  this.db.prepare('INSERT OR IGNORE INTO learning_bot_messages(jid,id) VALUES(?,?)').run(this.jid(jid),id);
 }
 humanHold(jid){return (this.db.prepare('SELECT until_ms FROM learning_human_hold WHERE jid=?').get(this.jid(jid))?.until_ms||0)>Date.now();}
 pauseForHuman(jid,ms=10*MINUTE){
  this.db.prepare('INSERT INTO learning_human_hold(jid,until_ms) VALUES(?,?) ON CONFLICT(jid) DO UPDATE SET until_ms=excluded.until_ms').run(this.jid(jid),Date.now()+ms);
  this.db.prepare("UPDATE learning_suggestions SET status='stale' WHERE jid=? AND status='pending'").run(this.jid(jid));
  this.changed('learning');
 }
 // Junta o que o cliente falou desde a sua resposta anterior (texto, legenda ou tipo da mídia).
 customerTurn(jid,replyAt){
  const prev=this.db.prepare(`SELECT MAX(timestamp) AS t FROM messages
    WHERE jid=? AND from_me=1 AND timestamp<?`).get(jid,replyAt)?.t||0;
  const start=Math.max(Number(prev)||0,replyAt-30*MINUTE);
  const rows=this.db.prepare(`SELECT id,kind,body FROM messages
    WHERE jid=? AND from_me=0 AND timestamp<=? AND timestamp>?
     AND kind NOT IN('protocol','reaction')
    ORDER BY timestamp ASC,id ASC LIMIT 12`).all(jid,replyAt,start);
  const parts=[];
  let lastId=null;
  for(const row of rows){
    const line=describeInbound(row);
    if(!line)continue;
    parts.push(line);
    lastId=row.id;
  }
  const text=parts.join('\n').slice(0,2000);
  return text?{id:lastId,text}:null;
 }
 recordHuman(m,source='tempo_real'){
  if(!m?.fromMe||m.type!=='text'||!m.text?.trim()||!isAllowedJid(m.jid)||source==='historico')return false;
  const jid=this.jid(m.jid);
  if(this.isBot(jid,m.id)||/^🤖\s/.test(m.text))return false;
  this.pauseForHuman(jid);
  // A fala inteira do cliente desde a resposta anterior, inclusive áudio e legenda.
  const turn=this.customerTurn(jid,m.timestamp);
  if(!turn?.text)return false;
  const result=this.db.prepare(`INSERT OR IGNORE INTO learning_examples
   (jid,question_id,reply_id,question,reply,reply_at,status,source)
   VALUES(?,?,?,?,?,?,'observed',?)`)
   .run(jid,turn.id,m.id,turn.text.slice(0,2000),m.text.slice(0,LIMIT_REPLY),m.timestamp,source);
  if(result.changes)this.changed('learning');
  return result.changes>0;
 }
 // Importa exemplos de TODO o histórico local que o Baileys já salvou.
 // Não envia dados à API nem promove hipóteses/preços para regras oficiais.
 rebuild(){
  const before=this.db.prepare('SELECT COUNT(*) AS n FROM learning_examples').get().n;
  this.db.prepare(`INSERT OR IGNORE INTO learning_examples
   (jid,question_id,reply_id,question,reply,reply_at,status,source)
   SELECT a.jid,
      (SELECT q.id FROM messages q WHERE q.jid=a.jid AND q.from_me=0
       AND q.kind='text' AND q.body<>'' AND q.timestamp<=a.timestamp
       AND q.timestamp>=a.timestamp-1800000 ORDER BY q.timestamp DESC,q.id DESC LIMIT 1),
      a.id,
      (SELECT CASE
         WHEN q.kind='text' THEN q.body
         WHEN q.body<>'' THEN '['||q.kind||'] '||q.body
         ELSE '['||q.kind||' do cliente]'
       END FROM messages q WHERE q.jid=a.jid AND q.from_me=0
       AND q.kind NOT IN('protocol','reaction')
       AND q.timestamp<=a.timestamp AND q.timestamp>=a.timestamp-1800000
       AND (q.kind<>'text' OR q.body<>'')
       ORDER BY q.timestamp DESC,q.id DESC LIMIT 1),
      substr(a.body,1,3000),a.timestamp,'observed','historico_local'
   FROM messages a WHERE a.from_me=1 AND a.kind='text' AND a.body<>''
    AND a.body NOT LIKE '🤖 %'
    AND (a.jid GLOB '*@s.whatsapp.net' OR a.jid GLOB '*@lid')
    AND NOT EXISTS(SELECT 1 FROM learning_bot_messages b WHERE b.jid=a.jid AND b.id=a.id)
    AND EXISTS(SELECT 1 FROM messages q WHERE q.jid=a.jid AND q.from_me=0
      AND q.kind NOT IN('protocol','reaction')
      AND q.timestamp<=a.timestamp AND q.timestamp>=a.timestamp-1800000
      AND (q.kind<>'text' OR q.body<>''))`).run();
  const after=this.db.prepare('SELECT COUNT(*) AS n FROM learning_examples').get().n;
  this.changed('learning');
  return{imported:after-before,total:after};
 }
 examples(jid,limit=40){
  return this.db.prepare(`SELECT id,jid,question,reply,reply_at,status,source FROM learning_examples
    WHERE jid=? ORDER BY reply_at DESC,id DESC LIMIT ?`).all(this.jid(jid),Math.min(100,Math.max(1,limit)));
 }
 examplesPage(jid,page=1){
  jid=this.jid(jid);
  const size=8;
  const total=this.db.prepare('SELECT COUNT(*) AS n FROM learning_examples WHERE jid=?').get(jid).n;
  const pages=Math.max(1,Math.ceil(total/size)||1);
  const current=Math.min(pages,Math.max(1,Math.floor(Number(page))||1));
  const items=this.db.prepare(`SELECT id,jid,question,reply,reply_at,status,source FROM learning_examples
    WHERE jid=? ORDER BY reply_at DESC,id DESC LIMIT ? OFFSET ?`).all(jid,size,(current-1)*size);
  return{items,total,page:current,pages,size};
 }
 repairQuestions(){
  const rows=this.db.prepare(`SELECT id,jid,reply_at,question FROM learning_examples WHERE status='observed'`).all();
  const update=this.db.prepare(`UPDATE learning_examples SET question=? WHERE id=? AND status='observed'`);
  let updated=0;
  for(const row of rows){
   const turn=this.customerTurn(row.jid,row.reply_at);
   if(turn?.text&&turn.text!==row.question){update.run(turn.text,row.id);updated++;}
  }
  if(updated)this.changed('learning');
  return{updated,checked:rows.length};
 }
 forgetContacts(jids){
  if(!Array.isArray(jids)||!jids.length||jids.length>20000)throw Error('Selecione as conversas para apagar');
  const seen=new Set(),unique=[];
  for(const raw of jids){
   const jid=this.jid(raw);
   if(!seen.has(jid)){seen.add(jid);unique.push(jid);}
  }
  const tables=['learning_examples','learning_suggestions','learning_human_hold','learning_bot_messages','learning_rules'];
  let removed=0;
  this.db.exec('BEGIN');
  try{
   for(let i=0;i<unique.length;i+=400){
    const group=unique.slice(i,i+400);
    const marks=group.map(()=>'?').join(',');
    for(const table of tables)removed+=this.db.prepare(`DELETE FROM ${table} WHERE jid IN (${marks})`).run(...group).changes;
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.changed('learning');
  return{removed,contacts:unique.length};
 }
 deleteExamples(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>5000)throw Error('Selecione os exemplos para apagar');
  const unique=[];
  for(const raw of ids){
   const id=Number(raw);
   if(Number.isInteger(id)&&id>0&&!unique.includes(id))unique.push(id);
  }
  if(!unique.length)throw Error('Nenhum exemplo válido');
  let removed=0;
  this.db.exec('BEGIN');
  try{
   for(let i=0;i<unique.length;i+=400){
    const group=unique.slice(i,i+400);
    const marks=group.map(()=>'?').join(',');
    removed+=this.db.prepare(`DELETE FROM learning_examples WHERE id IN (${marks})`).run(...group).changes;
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  if(removed)this.changed('learning');
  return{removed};
 }
 deleteContactExamples(jid){
  jid=this.jid(jid);
  let removed=0;
  this.db.exec('BEGIN');
  try{
   removed+=this.db.prepare('DELETE FROM learning_examples WHERE jid=?').run(jid).changes;
   removed+=this.db.prepare('DELETE FROM learning_suggestions WHERE jid=?').run(jid).changes;
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.changed('learning');
  return{removed,jid};
 }
 company(){
  return this.db.prepare('SELECT name,about,hours,address,catalog,updated_at FROM company_profile WHERE id=1').get()
   ||{name:'',about:'',hours:'',address:'',catalog:'',updated_at:0};
 }
 saveCompany(input={}){
  const clip=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  const row={
   name:clip(input.name,120),about:clip(input.about,2000),hours:clip(input.hours,500),
   address:clip(input.address,500),catalog:clip(input.catalog,8000)
  };
  this.db.prepare(`UPDATE company_profile SET name=?,about=?,hours=?,address=?,catalog=?,updated_at=? WHERE id=1`)
   .run(row.name,row.about,row.hours,row.address,row.catalog,Date.now());
  this.changed('learning');
  return this.company();
 }
 companyBrief(){
  const c=this.company();
  const lines=[];
  if(c.name)lines.push('Nome: '+c.name);
  if(c.about)lines.push('Sobre: '+c.about);
  if(c.hours)lines.push('Horário: '+c.hours);
  if(c.address)lines.push('Endereço: '+c.address);
  if(c.catalog)lines.push('Catálogo e preços informados pelo proprietário:\n'+c.catalog);
  return lines.join('\n');
 }
 sampleUpdate(id,{reply,status}){
  if(!Number.isInteger(id)||id<=0||!['approved','rejected','observed'].includes(status)||typeof reply!=='string'||!reply.trim()||reply.length>LIMIT_REPLY)throw Error('Correção de exemplo inválida');
  const result=this.db.prepare('UPDATE learning_examples SET reply=?,status=? WHERE id=?').run(reply.trim(),status,id);
  if(result.changes)this.changed('learning');
  return result.changes>0;
 }
 rules(jid=null){return this.db.prepare(`SELECT id,jid,content,state,created_at FROM learning_rules
   WHERE jid IS NULL OR jid=? ORDER BY created_at DESC,id DESC LIMIT 80`).all(jid?this.jid(jid):'',);}
 addRule(content,jid=null){
  if(typeof content!=='string'||!content.trim()||content.length>1000)throw Error('Regra inválida');
  if(jid)jid=this.jid(jid);
  const result=this.db.prepare("INSERT INTO learning_rules(jid,content,state,created_at) VALUES(?,?,'draft',?)").run(jid,content.trim(),Date.now());
  this.changed('learning');return result.lastInsertRowid;
 }
 approveRule(id,approve){
  if(!Number.isInteger(id)||id<1||typeof approve!=='boolean')throw Error('Regra inválida');
  const result=this.db.prepare('UPDATE learning_rules SET state=? WHERE id=?').run(approve?'approved':'rejected',id);
  if(result.changes)this.changed('learning');return result.changes>0;
 }
 // Agrega somente características de escrita, não compartilha falas de outro cliente.
 globalStyle(){
  const s=this.db.prepare(`SELECT COUNT(*) AS n,ROUND(AVG(LENGTH(reply))) AS mean_length,
   SUM(CASE WHEN lower(reply) LIKE 'bom dia%' THEN 1 ELSE 0 END) AS good_morning,
   SUM(CASE WHEN lower(reply) LIKE 'olá%' OR lower(reply) LIKE 'oi%' THEN 1 ELSE 0 END) AS greeting
   FROM learning_examples WHERE status IN('observed','approved')`).get();
  if(!s||s.n<5)return '';
  return 'O atendente humano costuma responder com cerca de '+s.mean_length+
    ' caracteres por mensagem. Em '+(s.greeting+s.good_morning)+' de '+s.n+
    ' exemplos, começou com uma saudação. Imite a concisão e o tom cordial sem compartilhar fatos de outros clientes.';
 }
 context(jid,question){
  jid=this.jid(jid);
  // Nunca usar conversas de outros clientes como exemplos brutos.
  const samples=this.db.prepare(`SELECT id,question,reply,status FROM learning_examples
   WHERE jid=? AND status IN('observed','approved') ORDER BY reply_at DESC LIMIT 300`).all(jid);
  const related=samples.map(x=>({...x,score:similarity(x.question,question)}))
   .filter(x=>x.score>.10).sort((a,b)=>b.score-a.score).slice(0,4);
  const approvedRules=this.rules(jid).filter(x=>x.state==='approved');
  return{examples:related,rules:approvedRules,globalStyle:this.globalStyle(),score:related[0]?.score||0};
 }
 canAuto(jid,question){
  const evidence=this.context(jid,question);
  const supported=evidence.examples.some(x=>x.score>=.70);
  return{ok:supported,reason:supported?'Exemplo humano semelhante':'Ainda sem exemplos humanos suficientemente semelhantes',evidence};
 }
 saveSuggestion(jid,questionId,answer){
  jid=this.jid(jid);
  if(!questionId||typeof answer!=='string'||!answer.trim()||answer.length>LIMIT_REPLY)throw Error('Sugestão inválida');
  this.db.prepare("UPDATE learning_suggestions SET status='stale' WHERE jid=? AND status='pending'").run(jid);
  const result=this.db.prepare("INSERT INTO learning_suggestions(jid,question_id,answer,status,created_at) VALUES(?,?,?,'pending',?)").run(jid,String(questionId),answer.trim(),Date.now());
  this.changed('learning');return Number(result.lastInsertRowid);
 }
 suggestion(jid){return this.db.prepare("SELECT * FROM learning_suggestions WHERE jid=? AND status='pending' ORDER BY id DESC LIMIT 1").get(this.jid(jid))||null;}
 beginSuggestion(id,jid){
  jid=this.jid(jid);
  if(!Number.isInteger(id)||id<1)throw Error('Sugestão inválida');
  const result=this.db.prepare("UPDATE learning_suggestions SET status='sending' WHERE id=? AND jid=? AND status='pending'").run(id,jid);
  if(!result.changes)throw Error('Sugestão já utilizada ou cancelada');
  return true;
 }
 cancelSuggestionSend(id,jid){
  jid=this.jid(jid);
  const target=this.humanHold(jid)?'stale':'pending';
  this.db.prepare("UPDATE learning_suggestions SET status=? WHERE id=? AND jid=? AND status='sending'").run(target,id,jid);
  this.changed('learning');
 }
 finishSuggestion(id,jid,answer,status){
  jid=this.jid(jid);
  if(!Number.isInteger(id)||id<1||!['approved','rejected'].includes(status))throw Error('Sugestão inválida');
  const s=this.db.prepare("SELECT * FROM learning_suggestions WHERE id=? AND jid=? AND status IN('pending','sending')").get(id,jid);
  if(!s)throw Error('Sugestão não disponível, talvez tenha sido substituída');
  if(status==='approved'&&(!answer||answer.length>LIMIT_REPLY))throw Error('Resposta inválida');
  this.db.prepare("UPDATE learning_suggestions SET status=?,answer=? WHERE id=?").run(status,status==='approved'?answer:s.answer,id);
  this.changed('learning');return s;
 }
 stats(){
  const q=this.db.prepare("SELECT COUNT(*) AS n FROM learning_examples").get().n;
  const approved=this.db.prepare("SELECT COUNT(*) AS n FROM learning_examples WHERE status='approved'").get().n;
  const rules=this.db.prepare("SELECT COUNT(*) AS n FROM learning_rules WHERE state='approved'").get().n;
  const contacts=this.db.prepare("SELECT COUNT(DISTINCT jid) AS n FROM learning_examples").get().n;
  return{mode:this.mode(),examples:q,approved,approvedRules:rules,contacts};
 }
}
module.exports={LearningMemory,similarity,hasPrice,MODES};
