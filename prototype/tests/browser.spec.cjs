const {test,expect}=require('@playwright/test');
const path=require('node:path');
test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
const url='file://'+path.resolve(__dirname,'../digimon-survivor-integral.html');
test.beforeEach(async({page})=>{await page.goto(url);});
test('loads mobile layout and joystick',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('h1')).toContainText('Digimon Survivor');
 await page.getByRole('button',{name:'Combate'}).click();
 await expect(page.locator('#stick')).toBeAttached();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 await expect(page.locator('#runHud')).toContainText('HP');
});
test('gacha, collection, upgrades and persistence',async({page})=>{
 await page.getByRole('button',{name:'Gacha'}).click();
 await page.getByRole('button',{name:'Invocar ×1'}).click();
 await expect(page.locator('#wallet')).toContainText('Tickets 19');
 await page.reload();
 await expect(page.locator('#wallet')).toContainText('Tickets 19');
 await page.getByRole('button',{name:'Colección'}).click();
 await expect(page.getByText('DigiDex')).toBeVisible();
 await page.getByRole('button',{name:'Mejoras'}).click();
 await expect(page.getByText('Mejoras permanentes')).toBeVisible();
});
test('movement via keyboard changes player position',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const before=await page.evaluate(()=>run.player.x);
 await page.keyboard.down('d');
 await page.waitForTimeout(350);
 await page.keyboard.up('d');
 const after=await page.evaluate(()=>run.player.x);
 expect(after).toBeGreaterThan(before);
});
test('virtual joystick responds to pointer input',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const stick=page.locator('#stick'),rect=await stick.boundingBox();
 const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+38,y);await page.waitForTimeout(300);
 const movement=await page.evaluate(()=>({x:run.player.x,stick:stick.x}));
 expect(movement.stick).toBeGreaterThan(0);
 expect(movement.x).toBeGreaterThan(400);
 await page.mouse.up();
});

test('duplicate rewards and guaranteed champion after ten rookie pulls',async({page})=>{
 await page.getByRole('button',{name:'Gacha'}).click();
 await page.evaluate(()=>{
   data.tickets=20;data.owned=SPECIES.map(s=>s.id);data.coins=0;
   data.pity.General=9;Math.random=()=>0;
 });
 await page.getByRole('button',{name:'Invocar ×1'}).click();
 const state=await page.evaluate(()=>({pity:data.pity.General,coins:data.coins,tickets:data.tickets}));
 expect(state.pity).toBe(0);
 expect(state.coins).toBeGreaterThanOrEqual(25);
 expect(state.tickets).toBe(19);
});
test('permanent upgrades persist after reload',async({page})=>{
 await page.evaluate(()=>{data.coins=100;save();});
 await page.getByRole('button',{name:'Mejoras'}).click();
 await page.getByRole('button',{name:'Mejorar · 20 DigiCoins'}).first().click();
 await page.reload();
 await page.getByRole('button',{name:'Mejoras'}).click();
 await expect(page.getByText('Nivel 1/5')).toBeVisible();
 await expect(page.locator('#wallet')).toContainText('DigiCoins 80');
});

test('elemental attacks work in actual browser runtime',async({page})=>{
 const result=await page.evaluate(()=>{
  const ice=DigimonCombat.projectile('Ice',24,0,0,0);
  const foe={uid:101,hp:20,slowUntil:0};
  DigimonCombat.applyHit(ice,foe);
  const electric=DigimonCombat.projectile('Electric',24,0,0,0);
  const a={uid:102,hp:20},b={uid:103,hp:20};
  DigimonCombat.applyHit(electric,a);
  const afterFirst=electric.ttl;
  DigimonCombat.applyHit(electric,b);
  return {slow:foe.slowUntil,firstPierces:afterFirst>0,secondStops:electric.ttl===0};
 });
 expect(result.slow).toBeGreaterThan(0);
 expect(result.firstPierces).toBe(true);
 expect(result.secondStops).toBe(true);
});
test('boss victory rewards persist without waiting 90 seconds',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const before=await page.evaluate(()=>({tickets:data.tickets,coins:data.coins}));
 await page.evaluate(()=>{
  run.time=65;run.kills=30;run.boss=true;
  run.enemies=[{uid:1,x:500,y:200,hp:0,boss:true,maxHp:55,slowUntil:0}];
  run.spawn=100;run.shot=100;
  update(0.016);
 });
 const state=await page.evaluate(()=>({ended:run.ended,tickets:data.tickets,coins:data.coins,runs:data.runs}));
 expect(state.ended).toBe(true);
 expect(state.tickets).toBeGreaterThan(before.tickets);
 expect(state.coins).toBeGreaterThan(before.coins);
 await page.reload();
 const saved=await page.evaluate(()=>({tickets:data.tickets,coins:data.coins,runs:data.runs}));
 expect(saved).toEqual({tickets:state.tickets,coins:state.coins,runs:state.runs});
});
test('ten-pull pity guarantees at least one Champion',async({page})=>{
 const result=await page.evaluate(()=>{
  const state={tickets:10,coins:0,owned:['agumon'],pity:{General:0},points:{}};
  const outcome=DigimonGacha.draw(state,{species:SPECIES,stages:STAGES,weights:WEIGHTS,duplicates:DUP},'General',10,()=>0);
  return {ok:outcome.ok,champions:outcome.results.filter(s=>STAGES.indexOf(s.stage)>=1).length,points:outcome.state.points.General,tickets:outcome.state.tickets};
 });
 expect(result).toEqual({ok:true,champions:1,points:10,tickets:0});
});

test('Patamon is faster and Greymon has more health',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const outcome=await page.evaluate(()=>{
  run.spawn=999;run.shot=999;run.time=40;run.player={x:400,y:240};
  run.enemies=[
   {uid:1,x:100,y:240,hp:10,boss:false,type:'runner',speciesId:'patamon',slowUntil:0},
   {uid:2,x:100,y:240,hp:30,boss:false,type:'tank',speciesId:'greymon',slowUntil:0}
  ];
  update(.05);
  return {runnerX:run.enemies[0].x,tankX:run.enemies[1].x,tankHp:run.enemies[1].hp,runnerHp:run.enemies[0].hp};
 });
 expect(outcome.runnerX).toBeGreaterThan(outcome.tankX);
 expect(outcome.tankHp).toBeGreaterThan(outcome.runnerHp);
});

test('enemies are Digimon and boss is a Mega Digimon',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const outcome=await page.evaluate(()=>{
  run.spawn=0;update(.016);
  const enemy=run.enemies.find(e=>!e.boss);
  run.time=65;run.spawn=999;update(.016);
  const boss=run.enemies.find(e=>e.boss);
  return {enemyId:enemy.speciesId,enemyStage:byId[enemy.speciesId].stage,bossId:boss.speciesId,bossStage:byId[boss.speciesId].stage};
 });
 expect(outcome.enemyId).toBeTruthy();
 expect(outcome.enemyStage).toBe('Rookie');
 expect(outcome.bossId).toBeTruthy();
 expect(outcome.bossStage).toBe('Mega');
});

test('enemy contact damage depends on Digimon species',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const damages=await page.evaluate(()=>{
  const values=[];
  for(const id of ['patamon','greymon']){
   run.player={x:400,y:240};run.hp=100;run.hit=0;run.spawn=999;run.shot=999;
   run.enemies=[{uid:99,x:400,y:240,hp:20,boss:false,speciesId:id,slowUntil:0}];
   update(.016);values.push(100-run.hp);
  }
  return values;
 });
 expect(damages[1]).toBeGreaterThan(damages[0]);
});

test('wild Digimon spawn outside visible arena',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const spawn=await page.evaluate(()=>{
  run.spawn=0;update(.001);
  const e=run.enemies[0];
  return {x:e.x,y:e.y,speciesId:e.speciesId};
 });
 expect(spawn.speciesId).toBeTruthy();
 expect(spawn.x<0||spawn.x>800||spawn.y<0||spawn.y>480).toBe(true);
});
test('ranged Digimon fire visible projectiles and keep distance',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const result=await page.evaluate(()=>{
  run.spawn=999;run.shot=999;run.player={x:400,y:240};
  run.enemies=[{uid:999,x:550,y:240,hp:100,boss:false,type:'ranged',speciesId:'angemon',slowUntil:0,cast:0}];
  update(.016);
  return {shots:run.enemyShots.length,x:run.enemies[0].x};
 });
 expect(result.shots).toBe(1);
 expect(result.x).toBeGreaterThan(550);
});

test('charging Digimon telegraphs before dashing',async({page})=>{
 await page.getByRole('button',{name:'Combate'}).click();
 await page.getByRole('button',{name:'Nueva partida'}).click();
 const phases=await page.evaluate(()=>{
  run.spawn=999;run.shot=999;run.player={x:400,y:240};
  run.enemies=[{uid:555,x:250,y:240,hp:100,boss:false,type:'charger',speciesId:'agumon',slowUntil:0,phase:'walk',phaseTime:0,dashX:0,dashY:0}];
  update(.016);const aim={phase:run.enemies[0].phase,x:run.enemies[0].x};
  update(.56);const dash={phase:run.enemies[0].phase,x:run.enemies[0].x};
  return {aim,dash};
 });
 expect(phases.aim.phase).toBe('aim');
 expect(phases.dash.phase).toBe('dash');
 expect(phases.dash.x).toBeGreaterThan(phases.aim.x);
});
