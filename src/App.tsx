import { NavLink, Route, Routes } from 'react-router-dom';
import { Activity, Car, ChartNoAxesColumnIncreasing, CircleGauge, Flag, Radio, Settings as SettingsIcon, Volume2, VolumeX } from 'lucide-react';
import { useRaceState } from './useRaceState';
import { useRaceRadio } from './useRaceRadio';
import { RacePage, TimingPage, TyresPage, CarPage, AnalysisPage, SettingsPage } from './pages';

const nav = [['/', 'Race', Flag], ['/timing', 'Timing', ChartNoAxesColumnIncreasing], ['/tyres', 'Tyres', CircleGauge], ['/car', 'Car', Car], ['/analysis', 'Analysis', Activity], ['/settings', 'Settings', SettingsIcon]] as const;
export function App() {
  const state = useRaceState();
  const radio = useRaceRadio(state);
  const statusLabel = state.status === 'DEMO' ? 'DEMO LIVE' : state.status === 'PAUSED' ? 'PAUSED · LAST DATA' : state.status;
  const timed = !['RACE','SPRINT'].includes(state.context.category);
  return <div className="app"><header><div className="brand"><span className="brand-mark">F1</span><div><b>RACE MONITOR</b><small>LOCAL TELEMETRY</small></div></div><div className="header-actions"><button className={`radio-pill ${radio.armed?'on':''} ${radio.status.toLowerCase()}`} onClick={radio.toggle} disabled={!radio.supported} aria-pressed={radio.armed} title="Enable race radio audio">{radio.armed?<Volume2/>:<VolumeX/>}<span>{radio.armed?radio.status:'RADIO OFF'}</span></button><div className={`status ${state.status.toLowerCase()}`}><Radio size={14} /><span>{statusLabel}</span></div></div></header><main><section className="session-bar"><div><span className="eyebrow">{state.sessionType}</span><h1>{state.track}</h1></div><div className="session-meta"><span>{state.weather}</span><span className={`flag ${state.flag.toLowerCase()}`}>{state.flag}</span><strong>{timed?<>TIME <i>{Math.floor(state.context.timeLeft/60)}:{String(state.context.timeLeft%60).padStart(2,'0')}</i></>:<>LAP {state.lap}<i> / {state.totalLaps || '—'}</i></>}</strong></div></section><Routes><Route path="/" element={<RacePage s={state} />} /><Route path="/timing" element={<TimingPage s={state} />} /><Route path="/tyres" element={<TyresPage s={state} />} /><Route path="/car" element={<CarPage s={state} />} /><Route path="/analysis" element={<AnalysisPage s={state} />} /><Route path="/sessions" element={<AnalysisPage s={state} />} /><Route path="/settings" element={<SettingsPage radio={radio}/>} /></Routes></main><nav>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'}><Icon /><span>{label}</span></NavLink>)}</nav></div>;
}
