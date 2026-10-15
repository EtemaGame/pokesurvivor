const {test,expect}=require('@playwright/test');
const path=require('node:path');
const url='file://'+path.resolve(__dirname,'../digimon-survivor-integral.html');
test.beforeEach(async({page})=>{await page.goto(url);});
test('loads mobile layout and joystick',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('header h1')).toContainText('Digimon Survivor');
 await page.getByRole('button',{name:'Combate'}).click();
 await expect(page.locator('#stick')).toBeVisible();
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
 const movement=await page.evaluate(()=>({x:run.player.x,stick:window.stick.x}));
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
