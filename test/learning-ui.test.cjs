'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const JID='5511999999999@s.whatsapp.net';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const elem=id=>({
 id,hidden:false,disabled:false,value:'',textContent:'',children:[],style:{},handlers:{},checked:false,
 setAttribute(){},focus(){},replaceChildren(...children){this.children=children;},
 append(...children){this.children.push(...children);},
 addEventListener(kind,fn){this.handlers[kind]=fn;}
});
test('modo observação, importação, sugestão editável e correção funcionam na UI sem enviar sozinhos',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,elem(id));return elements.get(id);};
 get('settingsPanel').hidden=true;
 const calls={send:[],modes:[],examples:[],rules:[],approved:[],rebuild:0,approveRules:[]};
 let mode='observation',suggestion={id:17,jid:JID,question_id:'q1',answer:'Sugestão de teste',status:'pending'};
 const whatsapp={
  status:async()=>({state:'conectado'}),conversations:async()=>[{jid:JID,name:'Cliente',preview:'Oi'}],
  messages:async()=>[],onChange:callback=>{whatsapp.changed=callback;},
  aiSettings:async()=>({enabled:true,baseUrl:'http://localhost:11434/v1',model:'auto',systemPrompt:'Seja breve',allowedJids:[],responseScope:'all',hasKey:false}),
  aiDiagnostics:async()=>({}),
  learnStats:async()=>({mode,examples:1,approved:0,approvedRules:0,contacts:1}),
  learnMode:async next=>{calls.modes.push(next);
   if(next==='automatic')return{canceled:true,mode};
   mode=next;return{canceled:false,mode};},
  learnExamples:async()=>[{id:2,question:'Qual o horário?',reply:'Das 9h às 17h',status:'observed',source:'human'}],
  learnExampleUpdate:async(...args)=>{calls.approved.push(args);return true;},
  learnRules:async()=>[{id:3,jid:null,content:'Fechamos aos domingos',state:'draft'}],
  learnApproveRule:async(...args)=>{calls.approveRules.push(args);return true;},
  learnAddRule:async(...args)=>{calls.rules.push(args);return 4;},
  learnRebuild:async()=>{calls.rebuild++;return{imported:7,total:19};},
  learnSuggestion:async()=>suggestion,
  learnSendSuggestion:async(...args)=>{calls.send.push(args);suggestion=null;return{id:'sent'};},
  learnRejectSuggestion:async()=>{suggestion=null;return true;}
 };
 const document={getElementById:get,createElement:()=>elem(),createDocumentFragment:()=>elem(),addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8'),{window:{whatsapp},document,Date,console});
 await tick();await tick();await tick();
 assert.equal(get('learnMode').value,'observation');
 assert.equal(get('learnSuggestion').hidden,true);
 assert.match(get('learnModeHint').textContent,/não sugere nem envia/);
 await get('conversations').children[0].handlers.click();await tick();await tick();
 assert.equal(get('learnExamples').children.length,1);
 assert.equal(get('learnRules').children.length,1);
 assert.equal(calls.send.length,0);
 const ruleCard=get('learnRules').children[0];
 await ruleCard.children[2].children[0].handlers.click();await tick();
 assert.deepEqual(calls.approveRules,[[3,true]]);
 await get('learnBackfill').handlers.click();await tick();
 assert.equal(calls.rebuild,1);
 assert.match(get('learnResult').textContent,/7 novos exemplos/);
 get('learnMode').value='suggestion';
 await get('learnMode').handlers.change();await tick();await tick();
 assert.equal(mode,'suggestion');
 assert.equal(get('learnSuggestion').hidden,false);
 assert.equal(get('learnSuggestionText').value,'Sugestão de teste');
 assert.equal(calls.send.length,0,'a IA não envia antes da aprovação');
 get('learnSuggestionText').value='Resposta corrigida manualmente';
 await get('learnSendSuggestion').handlers.click();await tick();
 assert.deepEqual(calls.send,[[17,JID,'Resposta corrigida manualmente']]);
 assert.equal(get('learnSuggestion').hidden,true);
 const card=get('learnExamples').children[0];
 card.children[2].value='Resposta ensinada pelo dono';
 await card.children[3].children[0].handlers.click();await tick();
 assert.deepEqual(calls.approved.at(-1),[2,'Resposta ensinada pelo dono','approved']);
 get('learnMode').value='automatic';
 await get('learnMode').handlers.change();
 assert.equal(get('learnMode').value,'suggestion','cancelamento não ativa o automático');
});

test('abas, paginação, regra vazia, empresa e apagar conversa ficam fora do cartão de exemplo',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,elem(id));return elements.get(id);};
 get('settingsPanel').hidden=true;
 let mode='observation',forgotten=null,rules=0;const seenPages=[];
 const chats=[{jid:JID,name:'Cliente',preview:'Oi'}];
 const whatsapp={
  status:async()=>({state:'conectado',detail:'',mediaErrors:4,lastMediaNote:'mídia antiga não abriu (o celular não reenviou a chave). Peça o arquivo de novo se precisar.'}),
  conversations:async()=>forgotten?[]:chats,
  messages:async()=>[],onChange(){},
  aiSettings:async()=>({enabled:false,baseUrl:'http://127.0.0.1:31415/v1',model:'auto',systemPrompt:'',allowedJids:[],responseScope:'selected',hasKey:false}),
  aiDiagnostics:async()=>({}),
  learnStats:async()=>({mode,examples:20,approved:0,approvedRules:0,contacts:1}),
  learnMode:async next=>{mode=next;return{canceled:false,mode};},
  learnExamplesPage:async(_jid,requested)=>{seenPages.push(requested);return{items:[{id:requested,question:'quero um orçamento',reply:'Pode me informar o papel?',status:'observed'}],total:20,page:requested,pages:3,size:8};},
  learnRules:async()=>[],
  learnAddRule:async()=>{rules++;return 9;},
  learnSuggestion:async()=>null,
  learnRepair:async()=>({updated:2,checked:4}),
  companyGet:async()=>({name:'Gráfica do Sorriso',about:'Impressos',hours:'8h às 18h',address:'Centro',catalog:'1000 cartões — R$ 90,00'}),
  companySave:async input=>({...input}),
  forgetChats:async jids=>{forgotten=[...jids];return{canceled:false,messages:3,contacts:1};}
 };
 const document={getElementById:get,createElement:()=>elem(),createDocumentFragment:()=>elem(),addEventListener(){},body:{classList:{toggle(name,on){this[name]=on;}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8'),{window:{whatsapp},document,Date,console});
 await tick();await tick();await tick();
 assert.match(get('health').textContent,/celular não reenviou/);
 assert.equal(get('detail').textContent,'');
 await get('openSettings').handlers.click();
 assert.equal(document.body.classList['settings-open'],true);
 assert.equal(get('panelWhatsapp').hidden,false);
 assert.equal(get('panelIa').hidden,true);
 await get('tabEmpresa').handlers.click();await tick();
 assert.equal(get('panelEmpresa').hidden,false);
 assert.equal(get('panelWhatsapp').hidden,true);
 assert.equal(get('companyName').value,'Gráfica do Sorriso');
 get('companyCatalog').value='Banner 1m — R$ 40,00';
 await get('companyForm').handlers.submit({preventDefault(){}});await tick();
 assert.match(get('companyResult').textContent,/salvos/i);
 await get('tabMemoria').handlers.click();await tick();
 await get('conversations').children[0].handlers.click();await tick();await tick();
 assert.equal(get('learnExamples').children.length,1);
 assert.equal(get('learnExamples').children[0].children[2].value,'Pode me informar o papel?');
 assert.equal(get('learnExamples').children[0].children[3].children[0].textContent,'Corrigir / aprovar');
 assert.equal(get('learnPager').hidden,false);
 assert.equal(get('learnExamples').children.includes(get('learnPager')),false);
 await get('learnPager').children[2].handlers.click();await tick();
 assert.equal(seenPages.at(-1),2);
 assert.match(get('learnExamples').children[0].children[0].textContent,/quero um orçamento/);
 get('learnRuleText').value='   ';
 await get('learnRuleAdd').handlers.click();
 assert.equal(rules,0);
 assert.match(get('learnResult').textContent,/Escreva a regra/);
 get('learnMode').value='suggestion';
 await get('learnMode').handlers.change();await tick();
 assert.equal(get('learnSuggestion').hidden,true);
 assert.equal(get('learnSuggestionWait').hidden,false);
 await get('learnRepair').handlers.click();await tick();
 assert.match(get('learnResult').textContent,/Falas atualizadas: 2/);
 await get('closeSettings').handlers.click();
 await get('pickChats').handlers.click();
 await get('conversations').children[0].handlers.click();
 assert.equal(get('forgetChats').disabled,false);
 await get('forgetChats').handlers.click();await tick();
 assert.deepEqual(forgotten,[JID]);
 assert.equal(get('conversations').children.length,0);
});
