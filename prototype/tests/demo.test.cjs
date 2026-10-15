const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'digimon-survivor-integral.html'),'utf8');
const names=['state-ui','gacha-engine','gacha','combat','input'];
const modules=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(root,'js',n+'.js'),'utf8')]));
test('HTML loads five scripts in dependency order',()=>{
 const refs=[...html.matchAll(/<script src="([^"]+)"\s*><\/script>/g)].map(m=>m[1]);
 assert.deepEqual(refs,names.map(n=>'js/'+n+'.js'));
});
test('all scripts parse in Node',()=>{for(const [name,source] of Object.entries(modules))assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));});
test('mobile controls and local save',()=>{assert.match(html,/touch-action:none/);assert.match(modules.input,/setPointerCapture/);assert.match(modules['state-ui'],/localStorage\.setItem/);});
test('gacha and combat are independent files',()=>{assert.match(modules.gacha,/function pull\(/);assert.match(modules['gacha-engine'],/function choose\(/);assert.match(modules.combat,/function update\(/);assert.match(modules.combat,/function finish\(/);});
test('boss defeat ends in victory and shows health',()=>{assert.match(modules.combat,/r\.boss&&!r\.enemies\.some\(e=>e\.boss\)/);assert.match(modules.combat,/finish\(true\)/);assert.match(modules.combat,/e\.hp\/e\.maxHp/);});
test('save key remains compatible with v0.2',()=>assert.match(modules['state-ui'],/digimon-survivor-prototype-v2/));
test('rates and banners are configured',()=>{assert.match(modules['state-ui'],/WEIGHTS=\[50,30,15,4,1\]/);assert.match(modules['state-ui'],/BANNERS=\['General','Dragons Roar','Nature Spirits'\]/);});
test('elemental combat and collection previews',()=>{assert.match(modules['state-ui'],/ELEMENT_COLORS=/);assert.match(modules.combat,/r\.effects\.push/);assert.match(modules['state-ui'],/aria-hidden/);});

const engine=require('../js/gacha-engine.js');
const species=[
{id:'a',name:'A',stage:'Rookie',field:'Dragons Roar'},
{id:'b',name:'B',stage:'Champion',field:'Dragons Roar'},
{id:'c',name:'C',stage:'Ultimate',field:'Nature Spirits'},
{id:'d',name:'D',stage:'Mega',field:'Nature Spirits'}];
const config={species,stages:['Rookie','Champion','Ultimate','Mega','Ultra'],weights:[50,30,15,4,1],duplicates:[10,25,60,150,400]};
const initial=()=>({tickets:20,coins:0,owned:['a'],pity:{},points:{}});
test('gacha draw is deterministic and does not mutate saved state',()=>{
 const state=initial(),out=engine.draw(state,config,'General',1,()=>0);
 assert.equal(out.ok,true);assert.equal(out.results[0].id,'a');assert.equal(out.state.coins,10);
 assert.equal(out.state.tickets,19);assert.equal(state.tickets,20);assert.equal(state.coins,0);
});
test('pity forces Champion or higher on tenth consecutive Rookie',()=>{
 const state=initial();state.pity.General=9;
 const out=engine.draw(state,config,'General',1,()=>0);
 assert.equal(out.results[0].stage,'Champion');assert.equal(out.state.pity.General,0);
});
test('banner excludes Digimon from other fields',()=>{
 for(let i=0;i<100;i++){const out=engine.draw(initial(),config,'Dragons Roar',1,()=>i/100);assert.ok(['a','b'].includes(out.results[0].id));}
});
test('stage weights renormalize when stages are missing',()=>{
 for(let i=0;i<100;i++){const s=engine.choose(species,'Dragons Roar',config.stages,config.weights,false,()=>i/100);assert.ok(['Rookie','Champion'].includes(s.stage));}
});
test('insufficient tickets does not spend currency',()=>{
 const state=initial(),out=engine.draw(state,config,'General',21);
 assert.equal(out.ok,false);assert.equal(state.tickets,20);
});
test('points accumulate independently by banner',()=>{
 let state=engine.draw(initial(),config,'General',1,()=>0).state;
 state=engine.draw(state,config,'Dragons Roar',1,()=>0).state;
 assert.equal(state.points.General,1);assert.equal(state.points['Dragons Roar'],1);
});
