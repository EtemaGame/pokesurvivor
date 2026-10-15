/* Pure, deterministic attack profiles; compatible with offline browser and Node. */
(function(root){
'use strict';
const PROFILES={
 Fire:{projectileSpeed:460,damageMultiplier:1.12,pierce:0,slow:0},
 Ice:{projectileSpeed:410,damageMultiplier:.90,pierce:0,slow:.35},
 Electric:{projectileSpeed:520,damageMultiplier:1,pierce:1,slow:0},
 Air:{projectileSpeed:570,damageMultiplier:.88,pierce:0,slow:0},
 Light:{projectileSpeed:460,damageMultiplier:1.08,pierce:0,slow:0},
 Dark:{projectileSpeed:400,damageMultiplier:1.2,pierce:0,slow:0},
 Neutral:{projectileSpeed:430,damageMultiplier:1,pierce:0,slow:0}
};
function profile(element){return PROFILES[element]||PROFILES.Neutral;}
function projectile(element,baseDamage,x,y,angle){
 const p=profile(element);
 return {x,y,vx:Math.cos(angle)*p.projectileSpeed,vy:Math.sin(angle)*p.projectileSpeed,ttl:1.5,damage:baseDamage*p.damageMultiplier,pierce:p.pierce,slow:p.slow,hitIds:[]};
}
function applyHit(projectile,enemy){
 if(projectile.hitIds.includes(enemy.uid))return false;
 projectile.hitIds.push(enemy.uid);
 enemy.hp-=projectile.damage/12;
 if(projectile.slow)enemy.slowUntil=Math.max(enemy.slowUntil||0,projectile.slow);
 if(projectile.pierce<=0)projectile.ttl=0;else projectile.pierce--;
 return true;
}
const api={PROFILES,profile,projectile,applyHit};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.DigimonCombat=api;
})(typeof globalThis!=='undefined'?globalThis:this);
