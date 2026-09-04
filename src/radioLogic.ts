import type { EngineerMessage, RaceState } from './types';

export function selectRadioMessage(state:RaceState):EngineerMessage|null {
  const engineer=state.engineer.primary,coach=state.coach.message;
  if(engineer&&engineer.priority!=='info')return engineer;
  if(coach)return coach;
  return engineer?.id.startsWith('pace-outlook-status-')?null:engineer||null;
}

export function radioText(message:EngineerMessage,state:RaceState):string {
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
  if(id.startsWith('damage-')){const part=id.split('-')[1],label=part==='frontWing'?'alerón delantero':part==='rearWing'?'alerón trasero':part==='sidepod'?'pontones':part==='floor'?'piso':part==='diffuser'?'difusor':part==='gearbox'?'caja':part==='engine'?'motor':part==='brakes'?'frenos':'auto';return message.priority==='critical'?`Daño grave en ${label}. Entrá a boxes si el auto no es seguro.`:`Daño en ${label}. Evaluá el comportamiento esta vuelta.`;}
  if(id==='tyre-wear')return 'Neumáticos críticos. Entrá a boxes en la próxima oportunidad segura.';
  if(id==='hot-tyres')return 'Neumáticos sobrecalentados. Evitá deslizar durante una vuelta.';
  if(id==='low-fuel')return 'Falta combustible. Levantá antes y ahorrá inmediatamente.';
  if(id==='fuel-margin')return 'Margen de combustible bajo. Empezá a levantar antes de frenar.';
  if(id==='low-ers')return 'Batería baja. Cargá energía antes del próximo ataque.';
  if(id==='pit-window')return 'Ventana de boxes abierta. Revisá tráfico y neumáticos.';
  if(id==='ahead-pitting')return 'El auto de adelante entró a boxes. Empujá con pista libre.';
  if(id.startsWith('drs-attack-'))return `${ahead?.name||'El de adelante'} está a ${aheadGap?.toFixed(1)??'menos de uno'}. Tenés DRS; prepará el ataque.`;
  if(id.startsWith('drs-defend-'))return `${behind?.name||'El de atrás'} quedó a ${behindGap?.toFixed(1)??'menos de uno'}. Va a tener DRS; priorizá la salida.`;
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
  if(id==='strategy-box-next')return 'Box en la próxima vuelta. Empujá ahora y prepará el cambio de compuesto.';
  if(id==='strategy-box-latest')return 'Box ahora. Es la última vuelta segura para cumplir la parada obligatoria.';
  if(id.startsWith('strategy-pit-exit-'))return `Salida de boxes en posición ${state.strategy.lastStop?.exitPosition||state.player.position}. Empujá durante dos vueltas.`;
  if(id.startsWith('strategy-cycle-complete-'))return `Ciclo de boxes completado. Recuperaste ${state.strategy.lastStop?.positionsRecovered||0} posiciones. Administrá el resultado.`;
  if(id==='strategy-extend')return 'Extendé el stint. Empujá con pista libre y buscá el overcut.';
  if(id==='strategy-overcut')return 'Overcut. Quedate afuera una vuelta y empujá con pista libre.';
  if(id==='strategy-cover')return 'Cubrí la parada. Entrá a boxes si el reingreso sigue limpio.';
  if(id==='strategy-undercut')return 'Undercut disponible. Entrá antes que el auto de adelante.';
  if(id==='strategy-free-stop')return 'Tenés una parada gratis. Aprovechá el margen antes de perderlo.';
  if(id.startsWith('mode-manage-'))return `Carrera bajo control. Objetivo ${state.strategy.targetLapTime}. Cuidá neumáticos.`;
  if(id.startsWith('mode-push-'))return `Modo push. Objetivo ${state.strategy.targetLapTime}. Empujá durante dos vueltas.`;
  if(id.startsWith('mode-attack-'))return 'Modo ataque. Usá la batería donde genere una oportunidad real.';
  if(id.startsWith('mode-defend-'))return 'Modo defensa. Priorizá las salidas y guardá batería.';
  if(id.startsWith('coach-speed-'))return `Curva ${turn}. Podés llevar más velocidad mínima. Soltá el freno progresivamente.`;
  if(id.startsWith('coach-brake-'))return `Curva ${turn}. Probá frenar un poco más tarde.`;
  if(id.startsWith('coach-throttle-'))return `Curva ${turn}. Priorizá la rotación y acelerá antes.`;
  if(id.startsWith('coach-steer-'))return `Curva ${turn}. Abrí la entrada y usá menos volante.`;
  return 'Atención. Revisá la acción prioritaria en pantalla.';
}

export function radioEnglishText(message:EngineerMessage):string {
  const title=message.title.replace(/\s*·\s*/g,'. ').replace(/\s+/g,' ').trim();
  const action=message.action.replace(/\s+/g,' ').trim();
  return `${title}. ${action}`;
}
