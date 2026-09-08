import { Component,type ReactNode } from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){window.speechSynthesis?.cancel();}
  render(){return this.state.failed?<main className="panel pairing-screen"><h1>Dashboard unavailable</h1><p>Reload to reconnect. Telemetry recording continues on the server.</p><button onClick={()=>location.reload()}>Reload dashboard</button></main>:this.props.children;}
}
