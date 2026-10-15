// Ejecutar: node --test prototype/tests/demo.test.cjs
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../digimon-survivor-integral.html'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
test('demo contains inline JavaScript with valid syntax',()=>{assert.ok(match,'missing script');new vm.Script(match[1]);});
test('mobile controls and offline save are present',()=>{assert.match(html,/setPointerCapture/);assert.match(html,/touch-action:none/);assert.match(html,/localStorage\.setItem/);});
test('core gameplay and economy are connected',()=>{for(const fn of ['start','update','draw','pull','choose','gainXp','finish','save','load'])assert.match(html,new RegExp('function '+fn+'\\('));});
test('victory requires boss defeated',()=>{assert.match(html,/const bossAlive=r\.enemies\.some\(e=>e\.boss\)/);assert.match(html,/finish\(!bossAlive\)/);});
test('saved progress key remains compatible with v0.2',()=>{assert.match(html,/digimon-survivor-prototype-v2/);});
test('all banners, probabilities and stage definitions exist',()=>{assert.match(html,/WEIGHTS=\[50,30,15,4,1\]/);assert.match(html,/BANNERS=\['General','Dragons Roar','Nature Spirits'\]/);});

test('boss has health bar and victory follows its defeat',()=>{assert.match(html,/maxHp:55/);assert.match(html,/e\.hp\/e\.maxHp/);assert.match(html,/else if\(r\.boss&&!r\.enemies\.some\(e=>e\.boss\)\)\{finish\(true\)/);});

test('elemental combat effects and collection previews exist',()=>{assert.match(html,/ELEMENT_COLORS=/);assert.match(html,/r\.effects\.push/);assert.match(html,/aria-hidden/);});
