function poolFor(b){return DigimonGacha.poolFor(SPECIES,b);}
function choose(b,guaranteed){return DigimonGacha.choose(SPECIES,b,STAGES,WEIGHTS,guaranteed);}
function pull(n){
 const outcome=DigimonGacha.draw(data,{species:SPECIES,stages:STAGES,weights:WEIGHTS,duplicates:DUP},banner,n);
 if(!outcome.ok)return message('Necesitas '+n+' DigiTickets');
 data=outcome.state;
 save();render();
 message(outcome.results.map(s=>s.duplicate?s.name+' (duplicado +'+s.coins+' monedas)':'¡NUEVO! '+s.name).join(' · '));
}
