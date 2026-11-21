'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const JID='5511999999999@s.whatsapp.net';
function element(id=''){
 return{id,value:'',textContent:'',hidden:false,disabled:false,checked:false,children:[],handlers:{},
  style:{},addEventListener(kind,fn){this.handlers[kind]=fn;},focus(){},setAttribute(){},
  append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};
}
test('UI da engrenagem permite configurar provedor, chave e autorizar contato sem habilitar automaticamente',async()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 $('settingsPanel').hidden=true;
 const saved=[],grants=[];
 let config={enabled:false,responseScope:'selected',baseUrl:'https://api.openai.com/v1',model:'',
  systemPrompt:'Atendimento cordial',allowedJids:[],hasKey:false};
 const window={whatsapp:{
  status:async()=>({state:'conectado',upserts:0,received:0,errors:0}),conversations:async()=>[{jid:JID,name:'Teste',preview:'oi'}],
  messages:async()=>[],onChange:()=>{},aiSettings:async()=>({...config,allowedJids:[...config.allowedJids]}),
  aiDiagnostics:async()=>({sent:0,failed:0,skipped:0}),
  aiTest:async()=>({success:true,preview:'OK'}),
  aiSave:async patch=>{saved.push(patch);config={...config,...patch,hasKey:config.hasKey||Boolean(patch.apiKey)};delete config.apiKey;return config;},
  aiContact:async(jid,allowed)=>{grants.push({jid,allowed});config.allowedJids=allowed?[jid]:[];return {...config};}
 }};
 const document={getElementById:$,addEventListener(){},createElement:()=>element(),createDocumentFragment:()=>element()};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8'),{window,document,Date,console});
 await tick();await tick();
 assert.equal($('aiEnabled').checked,false,'a IA inicia desligada');
 assert.equal($('aiScope').value,'selected','modo seguro padrão exige contatos autorizados');
 $('conversations').children[0].handlers.click();
 await tick();
 assert.equal($('aiContact').hidden,false);
 assert.equal($('aiContact').textContent,'Autorizar IA');
 await $('aiContact').handlers.click();await tick();
 assert.deepEqual(grants,[{jid:JID,allowed:true}]);
 assert.equal($('aiContact').textContent,'IA autorizada');
 $('aiBaseUrl').value='https://api.exemplo.com/v1';
 $('aiModel').value='modelo-v1';
 $('aiPrompt').value='Seja breve';
 $('aiApiKey').value='CHAVE-SINTETICA';
 $('aiEnabled').checked=true;
 await $('aiForm').handlers.submit({preventDefault(){}});await tick();
 assert.equal(saved.length,1);
 assert.equal(saved[0].baseUrl,'https://api.exemplo.com/v1');
 assert.equal(saved[0].model,'modelo-v1');
 assert.equal(saved[0].enabled,true);
 assert.equal(saved[0].responseScope,'selected');
 assert.equal(saved[0].apiKey,'CHAVE-SINTETICA');
 assert.equal($('aiApiKey').value,'','chave não permanece no campo após salvar');
 assert.equal($('aiEnabled').checked,true);
 assert.match($('aiResult').textContent,/IA ativada/);
 await $('aiTest').handlers.click();
 assert.match($('aiTestResult').textContent,/API funcionando/);
 assert.match($('aiTestResult').textContent,/OK/);
 await $('aiContact').handlers.click();await tick();
 assert.equal(grants[1].allowed,false);
 assert.equal($('aiContact').textContent,'Autorizar IA');
});

test('UI permite selecionar todos os contatos individuais e não apaga campos após falha de salvamento',async()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 $('settingsPanel').hidden=true;
 let fails=true;const saved=[];
 const config={enabled:false,responseScope:'selected',baseUrl:'http://127.0.0.1:31415/v1',model:'auto',
  systemPrompt:'Responda educadamente',allowedJids:[],hasKey:true};
 const window={whatsapp:{
  status:async()=>({state:'conectado'}),conversations:async()=>[],messages:async()=>[],onChange:()=>{},
  aiSettings:async()=>config,aiDiagnostics:async()=>({}),
  aiSave:async next=>{saved.push(next);if(fails)throw Error('Falha simulada');
   Object.assign(config,next);return{...config};}
 }};
 const document={getElementById:$,addEventListener(){},createElement:()=>element(),createDocumentFragment:()=>element()};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8'),{window,document,Date,console});
 await tick();await tick();
 $('aiScope').value='all';$('aiScope').handlers.change();
 $('aiEnabled').checked=true;
 $('aiPrompt').value='Texto que não deve sumir';
 await $('aiForm').handlers.submit({preventDefault(){}});
 assert.equal(saved[0].responseScope,'all');
 assert.equal(saved[0].enabled,true);
 assert.equal($('aiEnabled').checked,true,'falha não desmarca ativação');
 assert.equal($('aiPrompt').value,'Texto que não deve sumir','falha não restaura configurações antigas');
 assert.equal($('aiScope').value,'all');
 assert.match($('aiResult').textContent,/Não foi possível salvar/);
 fails=false;
 await $('aiForm').handlers.submit({preventDefault(){}});
 assert.equal(config.responseScope,'all');
 assert.equal(config.enabled,true);
 assert.match($('aiResult').textContent,/todos os contatos individuais/);
 assert.equal($('aiEnabled').checked,true);
});
