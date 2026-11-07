import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Image as NativeImage } from '@tauri-apps/api/image';
import { Camera, Crop, Copy, FloppyDisk, ArrowArcLeft, PencilSimple, Square, ArrowUpRight, EyeClosed, Monitor, Check, X, ArrowSquareOut } from '@phosphor-icons/react';
import { desktop, download, errorMessage, filename } from '../lib/media';
import { Notice } from './Notice';
import { usePreference } from '../lib/usePreference';
import type { ScreenCaptureResult, Display } from '../types';

type Tool = 'pen' | 'arrow' | 'rect' | 'redact' | 'crop';
type Point = { x: number; y: number };
const tools = [{ id: 'pen', label: 'Pen', icon: PencilSimple }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight }, { id: 'rect', label: 'Rectangle', icon: Square }, { id: 'redact', label: 'Redact', icon: EyeClosed }, { id: 'crop', label: 'Crop', icon: Crop }] as const;
export function ScreenshotTab() {
  const [image, setImage] = useState('');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ee696c');
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoCopy, setAutoCopy] = usePreference('screenshot.autoCopy', true);
  const [autoSave, setAutoSave] = usePreference('screenshot.autoSave', true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [displayId, setDisplayId] = useState(0);
  const finishRef = useRef<(url:string)=>Promise<void>>(async()=>{});
  const finishing = useRef(false);
  const captureAction = useRef<(region: boolean) => void>(() => {});
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const start = useRef<Point>({ x: 0, y: 0 });
  const snapshot = useRef<ImageData | null>(null);
  const options = useRef({ autoCopy, autoSave });
  options.current = { autoCopy, autoSave };
  useEffect(() => {
    if (!desktop) return;
    void invoke<Display[]>('get_displays').then(setDisplays).catch(err=>setError(errorMessage(err)));
    const result = listen<ScreenCaptureResult>('capture:result', e => {
      finishing.current=true;setBusy(true);setImage(e.payload.data_url);setSelecting(false);setTool('pen');
      void finishRef.current(e.payload.data_url).finally(()=>{finishing.current=false;setBusy(false);});
    });
    const closed = listen('capture:closed',()=>{if(!finishing.current)setBusy(false);});
    const action = listen<string>('screenshot:action', event => captureAction.current(event.payload === 'area'));
    return ()=>{void result.then(unlisten=>unlisten());void closed.then(unlisten=>unlisten());void action.then(unlisten=>unlisten());};
  },[]);
  useEffect(() => { if (desktop) void invoke('sync_widget_status', { kind:'screenshot',status:{phase:busy?'busy':'idle'} }).catch(console.error); }, [busy]);

  const loadCanvas = (url: string, reset = true) => new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return reject(new Error('Screenshot editor is unavailable.'));
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      setDimensions(img.width + ' × ' + img.height);
      if (reset) setHistory([url]);
      resolve();
    };
    img.onerror = () => reject(new Error('Could not load the screenshot.'));
    img.src = url;
  });
  useEffect(() => { if (image) void loadCanvas(image).catch(err => setError(errorMessage(err))); }, [image]);

  const copy = async (url?: string) => {
    const value = url || canvasRef.current?.toDataURL('image/png');
    if (!value) return;
    const blob = await (await fetch(value)).blob();
    if (desktop) {
      const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');

      const native = await NativeImage.fromBytes(new Uint8Array(await blob.arrayBuffer()));
      try { await writeImage(native); } finally { await native.close(); }
    } else await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  };
  const save = async (url?: string) => {
    const value = url || canvasRef.current?.toDataURL('image/png');
    if (!value) return '';
    if (desktop) {
      const path = await invoke<string>('save_screenshot', { dataUrl: value, customPath: null });
      window.dispatchEvent(new Event('media-saved')); return path;
    }
    const blob = await (await fetch(value)).blob();
    const name = filename('Screenshot', 'png'); download(blob, name); return name;
  };
  const finishCapture = async (url: string) => {
    const notices: string[] = [];
    const failures: string[] = [];
    if (options.current.autoSave) {
      try { notices.push('Saved to ' + await save(url)); } catch (err) { console.error('Screenshot save:',err); failures.push('Could not save. Try Save again.'); }
    }
    if (options.current.autoCopy) {
      try { await copy(url); notices.push('Copied to clipboard.'); } catch (err) { console.error('Screenshot clipboard:',err); failures.push('Could not copy. Try Copy again.'); }
    }
    setMessage(notices.length ? notices.map(n=>n.startsWith('Saved to ')?'Saved':n.startsWith('Copied')?'Copied':n).join(' · ') : 'Captured');
    if (failures.length) setError(failures.join(' '));
  };
  finishRef.current = finishCapture;
  const capture = async (region: boolean) => {
    setBusy(true); setError(''); setMessage(''); setSelection(null);
    let pendingOverlay = false;
    try {
      let url: string;
      if (desktop) {
        const result = await invoke<ScreenCaptureResult | null>('capture_display', { displayId, region, purpose:'screenshot' });
        if (!result) { pendingOverlay=true; return; }
        url = result.data_url;
      } else {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        try {
          const video = document.createElement('video'); video.srcObject = stream; video.muted = true; await video.play();
          const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          canvas.getContext('2d')!.drawImage(video, 0, 0); url = canvas.toDataURL('image/png');
        } finally { stream.getTracks().forEach(track => track.stop()); }
      }
      const editCrop = region && !desktop;
      setImage(url); setSelecting(editCrop); setTool(editCrop ? 'crop' : 'pen');
      if (!editCrop) await finishCapture(url);
    } catch (err) { if (!(err instanceof DOMException && err.name === 'NotAllowedError')) setError(errorMessage(err)); }
    finally {
      if (!pendingOverlay) setBusy(false);
    }
  };
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
  };
  const pushHistory = () => {
    const url = canvasRef.current!.toDataURL('image/png');
    setHistory(previous => [...previous.slice(-19), url]);
  };
  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const canvas = event.currentTarget; const context = canvas.getContext('2d')!;
    event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true;
    start.current = point(event); snapshot.current = context.getImageData(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = Math.max(3, canvas.width / 500); context.strokeStyle = color;
    context.beginPath(); context.moveTo(start.current.x, start.current.y);
    if (tool === 'crop') setSelection(null);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d')!; const end = point(event); const origin = start.current;
    if (tool === 'pen') { context.lineTo(end.x, end.y); context.stroke(); return; }
    if (tool === 'crop') {
      setSelection({ x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), w: Math.abs(end.x - origin.x), h: Math.abs(end.y - origin.y) }); return;
    }
    context.putImageData(snapshot.current!, 0, 0); context.strokeStyle = color; context.lineWidth = Math.max(3, event.currentTarget.width / 500);
    if (tool === 'rect') context.strokeRect(origin.x, origin.y, end.x - origin.x, end.y - origin.y);
    if (tool === 'redact') { context.fillStyle = '#111111'; context.fillRect(origin.x, origin.y, end.x - origin.x, end.y - origin.y); }
    if (tool === 'arrow') {
      const angle = Math.atan2(end.y - origin.y, end.x - origin.x); const head = Math.max(18, event.currentTarget.width / 90);
      context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(end.x, end.y);
      context.moveTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6)); context.lineTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6)); context.stroke();
    }
  };
  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    move(event); drawing.current = false; event.currentTarget.releasePointerCapture(event.pointerId);
    if (tool !== 'crop') pushHistory();
  };
  const applyCrop = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !selection || selection.w < 2 || selection.h < 2) return;
    const context = canvas.getContext('2d')!;
    const pixels = context.getImageData(Math.floor(selection.x), Math.floor(selection.y), Math.floor(selection.w), Math.floor(selection.h));
    canvas.width = pixels.width; canvas.height = pixels.height; context.putImageData(pixels, 0, 0);
    setDimensions(canvas.width + ' × ' + canvas.height); pushHistory(); setSelection(null); setTool('pen');
    if (selecting) { setSelecting(false); setBusy(true); await finishCapture(canvas.toDataURL('image/png')); setBusy(false); }
  };
  const undo = async () => {
    if (history.length < 2) return;
    const previous = history.slice(0, -1); await loadCanvas(previous[previous.length - 1], false); setHistory(previous); setSelection(null);
  };
  const action = async (type: 'save' | 'copy') => {
    setBusy(true); setError('');
    try { if (type === 'copy') { await copy(); setMessage('Copied'); } else { await save(); setMessage('Saved'); } }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  captureAction.current = region => { if (!busy) void capture(region); };
  return <div className="page screenshot-page">
    <div className="page-heading"><h1>Screenshot</h1><div className="inline-actions"><span className="quiet-label">{dimensions?dimensions+' px':''}</span>{desktop&&<button className="icon-button" aria-label="Screenshot floating controls" title="Floating controls" onClick={()=>void invoke('show_widget',{kind:'screenshot',displayId,minimize:true}).catch(error=>setError(errorMessage(error)))}><ArrowSquareOut size={19}/></button>}</div></div>
    {error&&<Notice error onDismiss={()=>setError('')}>{error}</Notice>}{message&&<Notice onDismiss={()=>setMessage('')}>{message}</Notice>}
    <div className="screenshot-topbar"><div className="inline-actions">
      {desktop&&<Select aria-label="Capture display" value={displayId} disabled={busy} onValueChange={value=>setDisplayId(+value)} onOpen={()=>void invoke<Display[]>('get_displays').then(setDisplays).catch(()=>{})} options={displays.map(d=>({value:d.id,label:d.name+' · '+d.width+' × '+d.height}))} />}
      <button className="button primary" disabled={busy} onClick={()=>capture(false)}><Monitor size={17}/>{busy?'Capturing…':'Capture screen'}</button><button className="button secondary" disabled={busy} onClick={()=>capture(true)}><Crop size={17}/>Capture area</button>
    </div><div className="inline-actions preferences-row"><label title="Copy after capture"><input type="checkbox" checked={autoCopy} disabled={busy} onChange={e=>setAutoCopy(e.target.checked)}/>Copy</label><label title="Save after capture"><input type="checkbox" checked={autoSave} disabled={busy} onChange={e=>setAutoSave(e.target.checked)}/>Save</label></div></div>
    <section className="editor panel">
      <div className="editor-toolbar"><div className="inline-actions">{tools.map(({id,label,icon:Icon})=><button key={id} title={label} aria-label={label} aria-pressed={tool===id} className={'icon-button '+(tool===id?'selected':'')} disabled={!image||busy} onClick={()=>{setTool(id);setSelection(null);}}><Icon size={19}/></button>)}<span className="toolbar-divider"/><input className="brush-color" type="color" title="Brush color" aria-label="Brush color" value={color} disabled={!image||busy} onChange={e=>setColor(e.target.value)}/></div>
      <div className="inline-actions"><button className="icon-button" title="Undo" aria-label="Undo" disabled={history.length<2||busy} onClick={()=>void undo().catch(err=>setError(errorMessage(err)))}><ArrowArcLeft size={19}/></button><button className="icon-button" title="Copy" aria-label="Copy screenshot" disabled={!image||busy||selecting} onClick={()=>action('copy')}><Copy size={19}/></button><button className="icon-button" title="Save" aria-label="Save screenshot" disabled={!image||busy||selecting} onClick={()=>action('save')}><FloppyDisk size={19}/></button>{image&&<button className="icon-button" title="Clear" aria-label="Clear screenshot" disabled={busy} onClick={()=>{setImage('');setHistory([]);setDimensions('');setSelection(null);setSelecting(false);}}><X size={18}/></button>}</div></div>
      {image?<div className="canvas-stage"><div className="canvas-wrap"><canvas ref={canvasRef} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={event=>{drawing.current=false;if(snapshot.current)event.currentTarget.getContext('2d')!.putImageData(snapshot.current,0,0);}}/>{selection&&canvasRef.current&&<div className="image-selection" style={{left:selection.x/canvasRef.current.width*100+'%',top:selection.y/canvasRef.current.height*100+'%',width:selection.w/canvasRef.current.width*100+'%',height:selection.h/canvasRef.current.height*100+'%'}}/>}</div></div>:<div className="editor-empty"><Camera size={38} weight="thin"/><span>Select a display. Capture a moment.</span></div>}
      <div className="editor-status"><span>{image?(tool==='crop'?'Drag to crop':tools.find(t=>t.id===tool)?.label):'No capture'}</span>{selection&&<div className="inline-actions"><button className="icon-button" title="Cancel crop" aria-label="Cancel crop" onClick={()=>setSelection(null)}><X size={16}/></button><button className="button secondary compact" onClick={()=>void applyCrop().catch(err=>setError(errorMessage(err)))}><Check size={16}/>Apply crop</button></div>}</div>
    </section>
  </div>;
}
