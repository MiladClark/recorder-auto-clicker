import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DotsSixVertical, EyeSlash, Pause, Play, Stop, ArrowSquareOut, Check, X, Record } from '@phosphor-icons/react';
import { duration, errorMessage } from '../lib/media';
import { useTheme } from '../lib/useTheme';
import { WidgetSurface } from './WidgetSurface';

type Rect = { x: number; y: number; w: number; h: number };
type Status = { phase?: string; seconds?: number };
export function DesktopSurface({ surface }: { surface: string }) {
  useTheme();
  const [status, setStatus] = useState<Status>({});
  const [snapshot, setSnapshot] = useState<{ image: { data_url: string }; display: { width: number; height: number } } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const origin = useRef({ x: 0, y: 0 });
  const confirm = useCallback(async () => { if (!rect || busy) return; setBusy(true); try { await invoke('complete_selection', { region: rect }); } catch (e) { setError(errorMessage(e)); setBusy(false); } }, [rect, busy]);
  useEffect(() => {
    document.documentElement.dataset.surface = surface;
    if (surface === 'controls') {
      const pending = listen<Status>('recorder:state', e => setStatus(e.payload));
      void invoke<Status>('get_recording_overlay').then(setStatus).catch(e => setError(errorMessage(e)));
      return () => { void pending.then(unlisten => unlisten()); };
    }
    if (surface === 'selection') void invoke<typeof snapshot>('get_selection').then(setSnapshot).catch(e => setError(errorMessage(e)));
  }, [surface]);
  useEffect(() => {
    if (surface !== 'selection') return;
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') void invoke('cancel_selection'); if (e.key === 'Enter') void confirm(); };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [surface, confirm]);
  if (surface === 'widget') { const kind = new URLSearchParams(location.search).get('kind'); return <WidgetSurface kind={kind === 'voice' || kind === 'screenshot' ? kind : 'recorder'} />; }
  if (surface === 'frame') return <div className="recording-halo" aria-hidden="true" />;
  const action = (value: string) => { void invoke('recording_action', { action: value }).catch(e => setError(errorMessage(e))); };
  if (surface === 'controls') return <div className="recording-widget">
    <span className="widget-grip" data-tauri-drag-region title="Drag"><DotsSixVertical size={18} /></span>
    <i className={'status-dot ' + (status.phase === 'recording' ? 'recording pulse' : '')} />
    <span className="widget-time" title={error || status.phase}>{status.phase === 'ready' ? 'Ready' : status.phase === 'selecting' ? 'Connecting…' : status.phase === 'saving' ? 'Saving…' : duration(status.seconds || 0)}</span>
    {status.phase === 'ready' || status.phase === 'selecting' ? <button className="icon-button" aria-label="Start recording" title="Record" disabled={status.phase!=='ready'} onClick={() => action('start')}><Record size={20} /></button> : <><button className="icon-button" aria-label={status.phase === 'paused' ? 'Resume' : 'Pause'} title={status.phase === 'paused' ? 'Resume' : 'Pause'} disabled={status.phase === 'saving'} onClick={() => action('pause')}>{status.phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}</button><button className="icon-button stop-control" title="Stop and save" aria-label="Stop and save" disabled={status.phase === 'saving'} onClick={() => action('stop')}><Stop size={18} weight="fill" /></button></>}
    <span className="toolbar-divider" /><button className="icon-button" title="Open app" aria-label="Open app" onClick={() => action('restore')}><ArrowSquareOut size={18} /></button><button className="icon-button" title="Hide · reopen with Ctrl+Shift+R" aria-label="Hide widget" onClick={() => action('hide')}><EyeSlash size={18} /></button>
  </div>;
  return <div className="desktop-selection" onContextMenu={e => { e.preventDefault(); void invoke('cancel_selection'); }}>
    {snapshot && <img className="selection-backdrop" src={snapshot.image.data_url} alt="" draggable={false} />}
    <div className="selection-shade" style={rect ? { clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${rect.x*100}% ${rect.y*100}%,${rect.x*100}% ${(rect.y+rect.h)*100}%,${(rect.x+rect.w)*100}% ${(rect.y+rect.h)*100}%,${(rect.x+rect.w)*100}% ${rect.y*100}%,${rect.x*100}% ${rect.y*100}%)` } : undefined} />
    <div className="selection-hit" onPointerDown={e => { if (busy || !snapshot) return; e.currentTarget.setPointerCapture(e.pointerId); origin.current = { x: e.clientX / innerWidth, y: e.clientY / innerHeight }; setRect(null); }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const start=origin.current; const x=Math.max(0,Math.min(1,e.clientX/innerWidth)),y=Math.max(0,Math.min(1,e.clientY/innerHeight)); setRect({x:Math.min(start.x,x),y:Math.min(start.y,y),w:Math.abs(x-start.x),h:Math.abs(y-start.y)}); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />
    {rect && snapshot && <div className="desktop-selection-box" style={{ left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%' }}><span>{Math.round(rect.w*snapshot.display.width)} × {Math.round(rect.h*snapshot.display.height)}</span></div>}
    <div className="selection-toolbar"><span>{error || (snapshot ? 'Drag to select' : 'Loading…')}</span><kbd>Esc</kbd><button className="icon-button" title="Cancel" aria-label="Cancel selection" onClick={() => void invoke('cancel_selection')}><X size={18} /></button><button className="button primary compact" disabled={!rect || rect.w<.002 || rect.h<.002 || busy} onClick={confirm}><Check size={17} />{busy ? 'Capturing…' : 'Capture'}</button></div>
  </div>;
}
