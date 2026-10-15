/* Pure gacha logic: no DOM, no storage. Exposed for browser and Node tests. */
(function(root){
'use strict';
function poolFor(species,banner){return species.filter(s=>banner==='General'||s.field===banner);}
function choose(species,banner,stages,weights,guaranteed,rng=Math.random){
 const eligible=poolFor(species,banner).filter(s=>!guaranteed||stages.indexOf(s.stage)>=1);
 const effective=stages.map((stage,i)=>eligible.some(s=>s.stage===stage)?weights[i]:0);
 const total=effective.reduce((a,b)=>a+b,0);
 if(!total)throw new Error('No eligible Digimon in banner '+banner);
 let roll=rng()*total,stage=stages[effective.findIndex(v=>v>0)];
 for(let i=0;i<stages.length;i++){roll-=effective[i];if(roll<0){stage=stages[i];break;}}
 const options=eligible.filter(s=>s.stage===stage);
 return options[Math.min(options.length-1,Math.floor(rng()*options.length))];
}
function draw(state,config,banner,count,rng=Math.random){
 if(!Number.isSafeInteger(count)||count<=0)throw new Error('Invalid draw count');
 if(state.tickets<count)return {ok:false,reason:'tickets'};
 const next={...state,tickets:state.tickets-count,coins:state.coins,owned:[...state.owned],pity:{...state.pity},points:{...state.points}};
 const results=[];
 for(let i=0;i<count;i++){
  const pity=next.pity[banner]||0;
  const s=choose(config.species,banner,config.stages,config.weights,pity>=9,rng);
  const stage=config.stages.indexOf(s.stage);
  next.pity[banner]=stage>=1?0:pity+1;
  next.points[banner]=(next.points[banner]||0)+1;
  const duplicate=next.owned.includes(s.id);
  if(duplicate)next.coins+=config.duplicates[stage];
  else next.owned.push(s.id);
  results.push({id:s.id,name:s.name,stage:s.stage,duplicate,coins:duplicate?config.duplicates[stage]:0});
 }
 return {ok:true,state:next,results};
}
const api={poolFor,choose,draw};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.DigimonGacha=api;
})(typeof globalThis!=='undefined'?globalThis:this);
