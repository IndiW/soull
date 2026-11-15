import { useEffect,useRef,useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {api,type Feature,type Manager,type Session} from './api';
export function Terminal({feature,manager,sessions,refresh,onError}:{feature:Feature;manager:Manager;sessions:Session[];refresh:()=>void;onError:(e:unknown)=>void}){
 const [selected,setSelected]=useState(''),[launching,setLaunching]=useState(false),container=useRef<HTMLDivElement>(null);
 const active=sessions.find(s=>s.id===selected)||sessions.find(s=>s.provider===manager.provider&&s.state==='running')||sessions.at(-1);
 async function launch(provider:string){setLaunching(true);try{const s=await api<Session>('/sessions','POST',{featureId:feature.id,provider});setSelected(s.id);refresh();}catch(e){onError(e);}finally{setLaunching(false);}}
 useEffect(()=>{
  if(!active||!container.current)return;
  const terminal=new XTerm({fontFamily:'SFMono-Regular, Menlo, monospace',fontSize:14,lineHeight:1.35,cursorBlink:false,scrollback:5000,theme:{background:'#1d1b23',foreground:'#e8e5ef',cursor:'#bca3ec',selectionBackground:'#66507a'}}),fit=new FitAddon();
  terminal.loadAddon(fit);terminal.open(container.current);let gone=false,offset=0,ended=false,errors=0;
  const resize=()=>{fit.fit();api('/sessions/'+active.id+'/resize','POST',{cols:terminal.cols,rows:terminal.rows}).catch(()=>{});};
  const observer=new ResizeObserver(resize);observer.observe(container.current);resize();
  const input=terminal.onData(input=>{api('/sessions/'+active.id+'/input','POST',{input}).catch(onError);});
  async function poll(){if(gone)return;try{const data=await api<{chunks:{data:string}[];offset:number;truncated:boolean;state:string;exit?:number}>('/sessions/'+active!.id+'/output?offset='+offset);if(gone)return;
   if(data.truncated){terminal.reset();terminal.writeln('[Older terminal output was trimmed]');}
   for(const chunk of data.chunks){const bytes=Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0));terminal.write(bytes);}offset=data.offset;errors=0;
   if(data.state==='exited'){if(!ended){terminal.writeln(`\r\n[Session ended: ${data.exit??'unknown'}]`);ended=true;}return;}
  }catch(e){if(!gone&&++errors===3)onError(e);}if(!gone)timer=window.setTimeout(poll,150);}
  let timer=window.setTimeout(poll,0);terminal.focus();
  return()=>{gone=true;clearTimeout(timer);observer.disconnect();input.dispose();terminal.dispose();};
 },[active?.id]);
 return <section className="terminal-view"><div className="terminal-toolbar"><div className="session-tabs">{sessions.map(s=><button key={s.id} className={active?.id===s.id?'selected':''} onClick={()=>setSelected(s.id)}>{s.provider==='claude'?'Claude Code':s.provider} <span className={'dot '+(s.state==='running'?'green':'')}/></button>)}</div><button disabled={launching} onClick={()=>launch(manager.provider)}>+ {manager.provider==='claude'?'Claude Code':'Codex'}</button><button disabled={launching} onClick={()=>launch('shell')}>+ Shell</button>{active?.state==='running'&&<button onClick={()=>{if(confirm('Stop this session? Its running process will end.'))api('/sessions/'+active.id+'/stop','POST').then(refresh).catch(onError);}}>Stop</button>}</div>
 {active?<div className="terminal-surface" ref={container}/>:<div className="empty"><RobotPlaceholder/><h2>Your workspace is ready</h2><p>Start your manager using its installed CLI.<br/>Your subscription sign-in stays with the provider.</p><button className="primary" disabled={launching} onClick={()=>launch(manager.provider)}>Start {manager.provider==='claude'?'Claude Code':'Codex'}</button><code>{feature.workspace}</code></div>}
 <footer className="pane-footer">{feature.branch}<span>Real PTY · sessions survive UI reloads</span></footer></section>;
}
function RobotPlaceholder(){return <div className="terminal-mark">›_</div>;}
