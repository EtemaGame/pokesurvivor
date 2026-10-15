const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'digimon-survivor-integral.html'),'utf8');
const names=['state-ui','gacha','combat','input'];
const modules=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(root,'js',n+'.js'),'utf8')]));
test('HTML loads four scripts in dependency order',()=>{
 const refs=[...html.matchAll(/<script src="([^"]+)"\s*><\/script>/g)].map(m=>m[1]);
 assert.deepEqual(refs,names.map(n=>'js/'+n+'.js'));
});
test('all scripts parse in Node',()=>{for(const [name,source] of Object.entries(modules))assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));});
test('mobile controls and local save',()=>{assert.match(html,/touch-action:none/);assert.match(modules.input,/setPointerCapture/);assert.match(modules['state-ui'],/localStorage\.setItem/);});
test('gacha and combat are independent files',()=>{assert.match(modules.gacha,/function pull\(/);assert.match(modules.gacha,/function choose\(/);assert.match(modules.combat,/function update\(/);assert.match(modules.combat,/function finish\(/);});
test('boss defeat ends in victory and shows health',()=>{assert.match(modules.combat,/r\.boss&&!r\.enemies\.some\(e=>e\.boss\)/);assert.match(modules.combat,/finish\(true\)/);assert.match(modules.combat,/e\.hp\/e\.maxHp/);});
test('save key remains compatible with v0.2',()=>assert.match(modules['state-ui'],/digimon-survivor-prototype-v2/));
test('rates and banners are configured',()=>{assert.match(modules['state-ui'],/WEIGHTS=\[50,30,15,4,1\]/);assert.match(modules['state-ui'],/BANNERS=\['General','Dragons Roar','Nature Spirits'\]/);});
test('elemental combat and collection previews',()=>{assert.match(modules['state-ui'],/ELEMENT_COLORS=/);assert.match(modules.combat,/r\.effects\.push/);assert.match(modules['state-ui'],/aria-hidden/);});
