import type { EngineerMessage, RaceState } from './types.js';
type RadioState=Pick<RaceState,'engineer'|'coach'|'strategy'|'player'|'context'|'sessionSummary'> & {safetyCar:string};

export function selectRadioMessage(state:RadioState):EngineerMessage|null {
  const engineer=state.engineer.primary,coach=state.coach.message;
  if(engineer&&engineer.priority!=='info')return engineer;
  if(coach)return coach;
  return engineer||null;
}

export function radioText(message:EngineerMessage,state:RadioState):string {
  if(message.radio)return message.radio.es;
  const id=message.id,turn=message.title.match(/CORNER\s+(\d+)/i)?.[1]||'';
  const ahead=state.strategy.ahead,behind=state.strategy.behind;
  const aheadGap=ahead?.gap,behindGap=behind?.gap;
  if(id==='final-lap'){
    if(behindGap!==null&&behindGap!==undefined&&behindGap<=1.2)return `Última vuelta. ${behind?.name||'El de atrás'} está a ${behindGap.toFixed(1)}. Defendé las salidas y traelo a casa.`;
    if(aheadGap!==null&&aheadGap!==undefined&&aheadGap<=1.5)return `Última vuelta. ${ahead?.name||'El de adelante'} está a ${aheadGap.toFixed(1)}. Usá la batería si la oportunidad es limpia.`;
    return `Última vuelta. Posición ${state.player.position}. Sin riesgos innecesarios, traelo a casa.`;
  }
  if(id==='race-finished'){
    const summary=state.sessionSummary,delta=summary?.positionsGained??0,movement=delta>0?` Ganaste ${delta} ${delta===1?'posición':'posiciones'}.`:delta<0?` Perdiste ${Math.abs(delta)} ${delta===-1?'posición':'posiciones'}.`:'';
    return `Bandera a cuadros. Posición ${summary?.finalPosition||state.player.position}.${movement} Buen trabajo.`;
  }
  if(id==='race-retired')return 'Carrera terminada. Detené el auto de forma segura y seguí a control de carrera.';
  if(id.startsWith('incident-collision-'))return message.priority==='critical'?'Contacto. Revisá dirección y daños antes de atacar la próxima curva.':'Accidente cerca. Preparáte para una amarilla y no tomes riesgos.';
  if(id.startsWith('incident-retirement-'))return 'El rival inmediato se retiró. Reordenamos objetivos; mantené el ritmo.';
  if(id==='red-flag')return 'Bandera roja. Bajá la velocidad y seguí las indicaciones.';
  if(id==='safety-car')return state.safetyCar==='VSC'?'Virtual Safety Car. Respetá el delta.':'Safety Car. Respetá el delta y prepará la estrategia.';
  if(id==='severe-damage')return 'Daño grave en el auto. Entrá a boxes si podés controlarlo.';
  if(id==='car-damage')return 'El daño está afectando el ritmo. Revisá el comportamiento esta vuelta.';
  if(id.startsWith('damage-')){if(message.context?.damageBefore!==undefined)return `El daño en ${message.title.includes('FRONT WING')?'el alerón delantero':'el auto'} aumentó del ${message.context.damageBefore} al ${message.context.damageAfter} por ciento. Evaluá el comportamiento antes de volver a atacar.`;const part=id.split('-')[1],label=part==='frontWing'?'alerón delantero':part==='rearWing'?'alerón trasero':part==='sidepod'?'pontones':part==='floor'?'piso':part==='diffuser'?'difusor':part==='gearbox'?'caja':part==='engine'?'motor':part==='brakes'?'frenos':'auto';return message.priority==='critical'?`Daño grave en ${label}. Entrá a boxes si el auto no es seguro.`:`Daño en ${label}. Evaluá el comportamiento esta vuelta.`;}
  if(id==='tyre-wear')return 'Neumáticos críticos. Entrá a boxes en la próxima oportunidad segura.';
  if(id==='hot-tyres')return 'Neumáticos sobrecalentados. Evitá deslizar durante una vuelta.';
  if(id==='low-fuel')return 'Falta combustible. Levantá antes y ahorrá inmediatamente.';
  if(id==='fuel-margin')return 'Margen de combustible bajo. Empezá a levantar antes de frenar.';
  if(id==='low-ers')return 'Batería baja. Cargá energía antes del próximo ataque.';
  if(id==='pit-window')return 'Ventana de boxes abierta. Revisá tráfico y neumáticos.';
  if(id==='ahead-pitting')return 'El auto de adelante entró a boxes. Empujá con pista libre.';
  if(id.startsWith('drs-attack-'))return `${ahead?.name||'El de adelante'} está a ${aheadGap?.toFixed(1)??'menos de uno'}. ${state.player.drs?'DRS activo; prepará el ataque.':'Prepará el ataque si la oportunidad es limpia.'}`;
  if(id.startsWith('drs-defend-'))return `${behind?.name||'El de atrás'} quedó a ${behindGap?.toFixed(1)??'menos de uno'}. Priorizá la salida y prepará la defensa.`;
  if(id.startsWith('prediction-ahead-')){const eta=Math.max(1,Math.ceil(ahead?.catchLaps??1));return `Le descontás ${Math.abs(ahead?.rate??0).toFixed(1)} por vuelta a ${ahead?.name||'el de adelante'}. Lo alcanzás en ${eta} ${eta===1?'vuelta':'vueltas'}.`;}
  if(id.startsWith('prediction-behind-')){const eta=Math.max(1,Math.ceil(behind?.catchLaps??1));return `${behind?.name||'El de atrás'} viene recortando. Puede alcanzarte en ${eta} ${eta===1?'vuelta':'vueltas'}; cuidá las salidas.`;}
  if(id==='catching-ahead')return `Te acercás a ${ahead?.name||'el auto de adelante'}. Mantené la presión.`;
  if(id==='defend')return `${behind?.name||'El auto de atrás'} está en rango de DRS. Priorizá la salida.`;
  if(id==='closing-behind')return `${behind?.name||'El auto de atrás'} se acerca. Evitá errores y prepará la defensa.`;
  if(id==='tyre-advantage')return 'Tenés ventaja de neumáticos. Presioná sin sobrecalentarlos.';
  if(id.startsWith('penalty-'))return `Penalización de ${state.context.penalties} segundos. Construí margen con el auto de atrás.`;
  if(id.startsWith('rain-forecast-'))return 'Se aproxima lluvia. Cuidá temperaturas y prepará el cambio de neumáticos.';
  if(id.startsWith('weather-'))return 'Cambió el clima. Revisá el agarre durante esta vuelta.';
  if(id==='strategy-box'||id==='strategy-box-window')return 'Box esta vuelta. El stint ya está perdiendo demasiado tiempo.';
  if(id==='strategy-mandatory-window')return `Ventana de boxes. Prepará la parada para la vuelta ${state.strategy.rules.recommendedPitLap||'indicada'} y cambiá de compuesto.`;
  if(id==='strategy-box-mandatory')return 'Box esta vuelta. Necesitamos cambiar de compuesto para completar la estrategia.';
  if(id==='strategy-box-next')return `Box en la próxima vuelta. ${state.strategy.raceMode==='MANAGE'||state.player.fuelRemainingLaps<.35||state.player.ers<15||Math.max(...state.player.tyreTemps)>110?'Cuidá el auto':'Empujá ahora'} y prepará el cambio de compuesto.`;
  if(id==='strategy-box-latest')return 'Box ahora. Es la última vuelta segura para cumplir la parada obligatoria.';
  if(id.startsWith('strategy-pit-exit-'))return `Salida de boxes en posición ${state.strategy.lastStop?.exitPosition||state.player.position}. ${state.strategy.raceMode==='DEFEND'?'Defendé las salidas y guardá batería.':state.strategy.raceMode==='ATTACK'?'Prepará un ataque limpio.':state.strategy.raceMode==='PUSH'?'Empujá esta vuelta y las dos siguientes.':'Evaluá el auto y las condiciones.'}`;
  if(id.startsWith('strategy-cycle-complete-'))return `Desde la salida de boxes recuperaste ${state.strategy.lastStop?.positionsRecovered||0} posiciones. ${state.strategy.raceMode==='DEFEND'?'Seguí defendiendo las salidas.':state.strategy.raceMode==='ATTACK'?'Mantené la presión adelante.':state.strategy.raceMode==='PUSH'?'Seguí empujando.':'Mantené el ritmo y evaluamos la diferencia.'}`;
  if(id==='strategy-extend')return 'Extendé el stint. Empujá con pista libre y buscá el overcut.';
  if(id==='strategy-overcut')return 'Overcut. Quedate afuera una vuelta y empujá con pista libre.';
  if(id==='strategy-cover')return 'Cubrí la parada. Entrá a boxes si el reingreso sigue limpio.';
  if(id==='strategy-undercut')return 'Undercut disponible. Entrá antes que el auto de adelante.';
  if(id==='strategy-free-stop')return 'Tenés una parada gratis. Aprovechá el margen antes de perderlo.';
  if(id.startsWith('mode-manage-'))return `Cuidá neumáticos. ${state.strategy.targetLapTime==='—'?'Mantené el ritmo.':`Objetivo ${state.strategy.targetLapTime}.`}`;
  if(id.startsWith('mode-push-'))return `Modo push. ${state.strategy.targetLapTime==='—'?'':`Objetivo ${state.strategy.targetLapTime}. `}Aprovechá esta fase y reevaluamos al completar la vuelta.`;
  if(id.startsWith('mode-attack-'))return 'Modo ataque. Usá la batería donde genere una oportunidad real.';
  if(id.startsWith('mode-defend-'))return 'Modo defensa. Priorizá las salidas y guardá batería.';
  if(id.startsWith('pace-outlook-'))return `${state.strategy.raceMode==='PUSH'?'Seguimos en push. ':''}${ahead?.gap!=null?`${ahead.name} a ${ahead.gap.toFixed(1)} adelante. `:''}${behind?.gap!=null?`${behind.name} a ${behind.gap.toFixed(1)} atrás. `:''}${state.strategy.targetLapTime==='—'?'Mantené el plan.':`Objetivo ${state.strategy.targetLapTime}.`}`;
  if(id.startsWith('coach-speed-'))return `Curva ${turn}. Podés llevar más velocidad mínima. Soltá el freno progresivamente.`;
  if(id.startsWith('coach-brake-'))return `Curva ${turn}. Probá frenar un poco más tarde.`;
  if(id.startsWith('coach-throttle-'))return `Curva ${turn}. Priorizá la rotación y acelerá antes.`;
  if(id.startsWith('coach-steer-'))return `Curva ${turn}. Abrí la entrada y usá menos volante.`;
  return 'Atención. Revisá la acción prioritaria en pantalla.';
}

function englishVariant(message:EngineerMessage,phrases:string[]){
  return phrases[Math.abs(message.phraseVariant??Number(message.id.match(/(\d+)$/)?.[1]??0))%phrases.length];
}
function spokenTarget(value:string){
  const match=/^(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if(!match)return '';
  const tenths=Math.round((Number(match[1])*60+Number(match[2]))*10);
  return `${Math.floor(tenths/600)}:${((tenths%600)/10).toFixed(1).padStart(4,'0')}`;
}
function spokenName(name:string){return name.toLowerCase().replace(/(^|[ .-])\p{L}/gu,letter=>letter.toUpperCase());}

export function radioEnglishText(message:EngineerMessage,state?:RadioState):string {
  if(message.radio)return message.radio.en;
  const id=message.id;
  if(id.startsWith('incident-collision-'))return message.priority==='critical'
    ?englishVariant(message,['Contact. Check steering and damage before pushing.','We had contact. Check the car before attacking.','Contact detected. Check the handling before you push.'])
    :englishVariant(message,['Incident nearby. Be ready to slow down.','Contact nearby. Watch for yellow flags.','Incident close by. Stay alert for yellows.']);
  if(id==='hot-tyres')return englishVariant(message,['Tyres are hot. Reduce sliding for a lap.','Temperatures are up. Keep the tyres from sliding.','Cool the tyres this lap. Keep it smooth.']);
  if(id==='low-ers')return englishVariant(message,['Battery low. Harvest before the next attack.','Recharge now. Save the next attack for later.','ERS is low. Build the battery back up.']);
  if(id.startsWith('mode-defend-'))return englishVariant(message,['Protect the exits. Keep battery for defence.','Defend now. Good exits and reserve some ERS.','Focus on corner exits. Save energy to defend.']);
  if(id.startsWith('mode-attack-'))return englishVariant(message,['Attack is on. Use ERS for a clean move.','Keep the pressure on. Deploy where you can pass.','Look for a clean move. Use the battery wisely.']);
  if(id.startsWith('coach-')){
    const turn=message.title.match(/CORNER\s+(\d+)/i)?.[1]??'';
    if(id.startsWith('coach-speed-'))return englishVariant(message,[`Corner ${turn}. Release the brake smoothly; carry more speed.`,`Carry more speed through corner ${turn}. Ease off the brake.`,`Corner ${turn}: a smoother brake release will help.`]);
    if(id.startsWith('coach-brake-'))return englishVariant(message,[`Corner ${turn}. Try braking a little later.`,`Brake slightly later into corner ${turn}. Small steps.`,`A little later on the brakes at corner ${turn}.`]);
    if(id.startsWith('coach-throttle-'))return englishVariant(message,[`Corner ${turn}. Rotate the car, then get on throttle earlier.`,`Earlier throttle at corner ${turn}. Get the car rotated first.`,`Focus on the exit of corner ${turn}. Earlier throttle.`]);
  }
  if(state){
    const target=spokenTarget(state.strategy.targetLapTime);
    if(id.startsWith('pace-outlook-')){
      const ahead=state.strategy.ahead,behind=state.strategy.behind;
      const gapAhead=ahead?.gap!=null?`${spokenName(ahead.name)} ${ahead.gap.toFixed(1)} ahead.`:'';
      const gapBehind=behind?.gap!=null?`${spokenName(behind.name)} ${behind.gap.toFixed(1)} behind.`:'';
      const gaps=[gapAhead,gapBehind].filter(Boolean).join(' ');
      const pace=target?`Target ${target}.`:'Keep the current pace.';
      return englishVariant(message,[`${gaps} ${pace}`,`Position ${state.player.position}. ${gaps} ${target?`Aim for ${target}.`:'Stay on this pace.'}`,`${target?`Hold ${target}.`:'Keep this rhythm.'} ${gaps}`]).trim();
    }
    if(id.startsWith('mode-manage-'))return englishVariant(message,[`Look after the tyres. ${target?`Target ${target}.`:'Hold this pace.'}`,`${target?`Aim for ${target}.`:'Keep this rhythm.'} Protect the tyres.`,`Manage the tyres now. ${target?`Hold ${target}.`:'Keep it consistent.'}`]);
    if(id.startsWith('mode-push-'))return englishVariant(message,[`Push now. ${target?`Target ${target}.`:'Make these laps count.'}`,`${target?`Aim for ${target}. `:''}Time to push.`,`Let's push this lap. ${target?`Hold ${target}.`:'Reassess next lap.'}`]);
    if(id.startsWith('strategy-pit-exit-')){
      const action=state.strategy.raceMode==='PUSH'?'Push on fresh tyres.':state.strategy.raceMode==='DEFEND'?'Protect the exits.':state.strategy.raceMode==='ATTACK'?'Prepare a clean move.':'Check the grip and settle in.';
      return englishVariant(message,[`Out in P${state.strategy.lastStop?.exitPosition??state.player.position}. ${action}`,`Pit exit, position ${state.strategy.lastStop?.exitPosition??state.player.position}. ${action}`]);
    }
    if(id.startsWith('drs-attack-')&&state.strategy.ahead?.gap!=null){const rival=state.strategy.ahead;return englishVariant(message,[`${spokenName(rival.name)} ${rival.gap!.toFixed(1)} ahead. Prepare a clean attack.`,`You're ${rival.gap!.toFixed(1)} behind ${spokenName(rival.name)}. Look for the opening.`]);}
    if(id.startsWith('drs-defend-')&&state.strategy.behind?.gap!=null){const rival=state.strategy.behind;return englishVariant(message,[`${spokenName(rival.name)} ${rival.gap!.toFixed(1)} behind. Protect your exits.`,`${spokenName(rival.name)} is close, ${rival.gap!.toFixed(1)} back. Be ready to defend.`]);}
    if(id==='strategy-box-next')return 'Box next lap. Prepare to change compound.';
    if(id==='strategy-box-mandatory')return 'Box this lap. We need the other dry compound.';
    if(id==='strategy-box-latest')return 'Box now. Last safe lap for the required stop.';
    if(id==='final-lap')return state.strategy.behind?.gap!=null&&state.strategy.behind.gap<=1.2?'Final lap. Protect the exits and bring it home.':'Final lap. Keep it clean and bring it home.';
  }
  const title=message.title.replace(/\s*·\s*/g,'. ').replace(/\s+/g,' ').trim();
  const action=message.action.replace(/\s+/g,' ').trim();
  return `${title}. ${action}`;
}
