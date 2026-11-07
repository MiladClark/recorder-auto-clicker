import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowSquareOut, Camera, Crop, DotsSixVertical, EyeSlash, Pause, Play, Record, Stop } from '@phosphor-icons/react';
import { duration } from '../lib/media';

type Status = { phase?: string; seconds?: number; level?: number };
type Dock = { edge: 'top' | 'left' | 'right'; offset: number; display_id: number };
export function WidgetSurface({ kind }: { kind: 'recorder' | 'voice' | 'screenshot' }) {
  const [status, setStatus] = useState<Status>({});
  const [dock, setDock] = useState<Dock>({ edge: 'top', offset: .5, display_id: 0 });
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const drag = useRef(false);
  const start = useRef<Promise<unknown>>(Promise.resolve());
  const moving = useRef<Promise<unknown> | null>(null);
  const action = (action: string) => void invoke('widget_action', { kind, action }).catch(error => { console.error('Widget action:', error); setNotice('Open the app to try again.'); });
  useEffect(() => {
    document.documentElement.dataset.tool = kind;
    void invoke<{ status: Status; dock: Dock }>('get_widget_state', { kind }).then(value => { setStatus(value.status); setDock(value.dock); }).catch(console.error);
    const statusEvent = listen<Status>('widget:status', event => setStatus(event.payload));
    const dockEvent = listen<Dock>('widget:dock', event => setDock(event.payload));
    return () => { void statusEvent.then(fn => fn()); void dockEvent.then(fn => fn()); };
  }, [kind]);
  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = true; setDragging(true);
    start.current = invoke('begin_widget_drag', { kind });
    void start.current.catch(error => { console.error(error); drag.current = false; setDragging(false); });
  };
  const move = () => {
    if (!drag.current || moving.current) return;
    moving.current = start.current.then(() => invoke('drag_widget', { kind })).catch(console.error).finally(() => { moving.current = null; });
  };
  const end = async (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      await start.current; await moving.current;
      await invoke('drag_widget', { kind });
      await invoke('dock_widget', { kind, edge: null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    } catch (error) { console.error('Dock widget:', error); }
    finally { setDragging(false); }
  };
  const active = status.phase === 'recording' || status.phase === 'paused';
  const busy = status.phase === 'saving' || status.phase === 'connecting' || status.phase === 'busy';
  const time = duration(status.seconds || 0);
  return <div className={'recording-widget dock-widget' + (dragging ? ' is-dragging' : '')} data-edge={dock.edge} aria-label={`${kind} floating controls`}>
    <button className="widget-grip" aria-label="Move widget" title="Drag to an edge · Arrow keys: left, right, top" onPointerDown={begin} onPointerMove={move} onPointerUp={event => void end(event)} onPointerCancel={event => void end(event)}
      onKeyDown={event => { const edge = event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'top' : null; if (edge) { event.preventDefault(); void invoke('dock_widget', { kind, edge, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }).catch(console.error); } }}><DotsSixVertical size={18} /></button>
    {kind !== 'screenshot' && <><i className={'status-dot ' + (status.phase === 'recording' ? 'recording pulse' : '')} /><span className="widget-time" title={notice || time}>{status.phase === 'ready' ? 'Ready' : busy ? status.phase === 'connecting' ? '…' : 'Saving' : dock.edge === 'top' ? time : time.startsWith('00:') ? time.slice(3) : time}</span></>}
    {kind === 'voice' && <span className="widget-level" aria-hidden="true">{[.4,.7,1,.7,.4].map((factor, index) => <i key={index} style={{ height: `${3 + (status.level || 0) * factor * 17}px` }} />)}</span>}
    {kind === 'screenshot' ? <><button className="icon-button" aria-label="Capture screen" title="Capture screen" disabled={busy} onClick={() => action('screen')}><Camera size={19} /></button><button className="icon-button" aria-label="Capture area" title="Capture area" disabled={busy} onClick={() => action('area')}><Crop size={19} /></button><span className="widget-spacer" /></> : active ? <>
      <button className="icon-button" aria-label={status.phase === 'paused' ? 'Resume' : 'Pause'} title={status.phase === 'paused' ? 'Resume' : 'Pause'} disabled={busy} onClick={() => action('pause')}>{status.phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}</button>
      <button className="icon-button stop-control" title="Stop and save" aria-label="Stop and save" disabled={busy} onClick={() => action('stop')}><Stop size={18} weight="fill" /></button>
    </> : <button className="icon-button" title="Record" aria-label="Start recording" disabled={busy || kind === 'recorder' && status.phase !== 'ready'} onClick={() => action('start')}><Record size={20} /></button>}
    <span className="toolbar-divider" /><button className="icon-button" title="Open app" aria-label="Open app" onClick={() => action('restore')}><ArrowSquareOut size={18} /></button><button className="icon-button" title="Hide · reopen from tray" aria-label="Hide widget" onClick={() => action('hide')}><EyeSlash size={18} /></button>
  </div>;
}
