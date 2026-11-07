import { Select } from './Select';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Display } from '../types';
import { Monitor, AppWindow, Crop, Record, Pause, Play, Stop, FolderOpen, ArrowUpRight, SpeakerHigh, Microphone, ArrowsClockwise, X, SlidersHorizontal, ArrowSquareOut } from '@phosphor-icons/react';
import { desktop, dataUrl, download, duration, errorMessage, filename, bytes } from '../lib/media';
import { Notice } from './Notice';
import { usePreference } from '../lib/usePreference';

type Phase = 'idle' | 'selecting' | 'ready' | 'recording' | 'paused' | 'saving';
type Rect = { x: number; y: number; w: number; h: number };
const sources = [
  { id: 'monitor', name: 'Entire screen', description: 'Capture a full display', icon: Monitor },
  { id: 'window', name: 'App window', description: 'Keep the focus on one app', icon: AppWindow },
  { id: 'region', name: 'Selected area', description: 'Draw your own capture frame', icon: Crop },
] as const;

export function RecorderTab({ onRecordingChange }: { onRecordingChange: (active: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [source, setSource] = useState<'monitor' | 'window' | 'region'>('monitor');
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState(8);
  const [systemAudio, setSystemAudio] = usePreference('recorder.systemAudio', true);
  const [mic, setMic] = usePreference('recorder.mic', false);
  const [micId, setMicId] = usePreference('recorder.micId', '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micGain, setMicGain] = useState(100);
  const [systemGain, setSystemGain] = useState(100);
  const [micLevel, setMicLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [size, setSize] = useState(0);
  const [screenInfo, setScreenInfo] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState('');
  const [crop, setCrop] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);
  const [destination, setDestination] = usePreference('recorder.destination', '');
  const [folderLabel, setFolderLabel] = useState('Videos / OmniPulse');
  const [displays, setDisplays] = useState<Display[]>([]);
  const [displayId, setDisplayId] = useState(0);
  const [autoMinimize, setAutoMinimize] = usePreference('recorder.minimize', true);
  const [showFrame, setShowFrame] = usePreference('recorder.frame', true);
  const [more, setMore] = useState(false);
  const overlayOptions = useRef({ autoMinimize, displayId }); overlayOptions.current = { autoMinimize, displayId };
  const actions = useRef({ start: () => {}, pause: () => {}, stop: () => {} });
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const mixedRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameRef = useRef(0);
  const meterRef = useRef(0);
  const startPoint = useRef({ x: 0, y: 0 });
  const elapsedRef = useRef(0);
  const activeSince = useRef(0);
  const currentPhase = useRef(phase);
  const stopRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);
  const savedBlob = useRef<Blob | null>(null);
  const savedName = useRef('');
  const locked = ['recording', 'paused', 'saving', 'selecting'].includes(phase);
  currentPhase.current = phase;

  useEffect(() => {
    const enumerate = () => navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audioinput'))).catch(() => {});
    void enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    if (desktop) void invoke<{ videos: string }>('get_output_dirs').then(dirs => setFolderLabel(destination || dirs.videos)).catch(() => {});
    if (desktop) void invoke<Display[]>('get_displays').then(setDisplays).catch(err => setError(errorMessage(err)));
    return () => navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const action = listen<'start' | 'pause' | 'stop'>('recorder:action', e => actions.current[e.payload]?.());
    const region = listen<Rect>('capture:region', e => { setCrop(e.payload); setCropping(false); if (overlayOptions.current.autoMinimize) void invoke('sync_recording_overlay',{status:{phase:'ready',seconds:0}}).then(()=>invoke('show_recording_overlay',{displayId:overlayOptions.current.displayId,frame:false,minimize:true})).catch(err=>setWarning(errorMessage(err))); });
    return () => { void action.then(unlisten => unlisten()); void region.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => { if (desktop) void invoke('sync_recording_overlay', { status: { phase, seconds: Math.floor(seconds) } }).catch(() => {}); }, [phase, Math.floor(seconds)]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = window.setInterval(() => setSeconds((elapsedRef.current + performance.now() - activeSince.current) / 1000), 250);
    return () => clearInterval(interval);
  }, [phase]);

  const releaseAudio = useCallback(() => {
    cancelAnimationFrame(meterRef.current); clearInterval(frameRef.current);
    micRef.current?.getTracks().forEach(track => track.stop()); micRef.current = null;
    mixedRef.current?.getTracks().forEach(track => track.stop()); mixedRef.current = null;
    void contextRef.current?.close().catch(() => {}); contextRef.current = null;
    setMicLevel(0);
  }, []);
  const releaseScreen = useCallback(() => {
    screenRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    screenRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScreenInfo(''); setCrop(null); setCropping(false);
  }, []);
  useEffect(() => () => {
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    releaseAudio(); releaseScreen();
  }, [releaseAudio, releaseScreen]);

  const chooseSource = async () => {
    if (busyRef.current || locked) return;
    busyRef.current = true;
    setError(''); setWarning(''); setSaved(''); setPhase('selecting');
    releaseScreen();
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is unavailable. Install the latest Microsoft Edge WebView2 Runtime and reopen FrameCue.');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps }, displaySurface: source === 'window' ? 'window' : 'monitor' },
        audio: systemAudio,
      });
      screenRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track was provided by the selected source.');
      track.onended = () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') stopRef.current();
        else { releaseScreen(); setPhase('idle'); }
      };
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const settings = track.getSettings();
      const matches = displays.filter(display => display.width === settings.width && display.height === settings.height);
      if (source !== 'window' && displays.length > 1 && matches.length !== 1) setWarning('Use the same display in the picker and “Display frame”.');
      const selectedDisplay = matches.length === 1 ? matches[0].id : displayId;
      setDisplayId(selectedDisplay);
      setScreenInfo((settings.width ?? '?') + ' × ' + (settings.height ?? '?'));
      if (systemAudio && !stream.getAudioTracks().length) setWarning('No system audio. Enable “Share audio” in the source picker.');
      setCropping(source === 'region');
      if (desktop && source === 'region') { await invoke('capture_display', { displayId: selectedDisplay, region: true, purpose: 'recording' }); }
      else if (desktop && autoMinimize) { await invoke('sync_recording_overlay', {status:{phase:'selecting',seconds:0}}); await invoke('show_recording_overlay', { displayId:selectedDisplay, frame:false, minimize:true }); }
      setPhase('ready');
    } catch (err) {
      releaseScreen(); setPhase('idle');
      if (desktop) void invoke('close_recording_overlay',{restoreMain:true}).catch(()=>{});
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) setError(errorMessage(err));
    } finally { busyRef.current = false; }
  };

  const stopRecording = () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    if (currentPhase.current === 'recording') elapsedRef.current += performance.now() - activeSince.current;
    setSeconds(elapsedRef.current / 1000);
    setPhase('saving');
    recorderRef.current.stop();
    releaseAudio(); releaseScreen();
  };
  stopRef.current = stopRecording;

  const startRecording = async () => {
    if (busyRef.current || phase !== 'ready' || !screenRef.current) return;
    if (source === 'region' && (!crop || crop.w < 0.02 || crop.h < 0.02)) { setError('Draw a capture area on the preview first.'); return; }
    busyRef.current = true; setError(''); setSaved(''); savedBlob.current = null;
    let sessionId: string | null = null;
    try {
      const screen = screenRef.current;
      await screen.getVideoTracks()[0].applyConstraints({ frameRate: { ideal: fps, max: fps } });
      let videoTrack = screen.getVideoTracks()[0];
      if (source === 'region' && crop && videoRef.current) {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.floor(video.videoWidth * crop.w / 2) * 2);
        canvas.height = Math.max(2, Math.floor(video.videoHeight * crop.h / 2) * 2);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the region capture canvas.');
        const draw = () => {
          context.drawImage(video, crop.x * video.videoWidth, crop.y * video.videoHeight, crop.w * video.videoWidth, crop.h * video.videoHeight, 0, 0, canvas.width, canvas.height);
        };
        draw();
        frameRef.current = window.setInterval(draw, 1000 / fps);
        videoTrack = canvas.captureStream(fps).getVideoTracks()[0];
      }
      const audioTracks: MediaStreamTrack[] = [];
      const audio = new AudioContext(); contextRef.current = audio;
      await audio.resume();
      const output = audio.createMediaStreamDestination();
      if (systemAudio && screen.getAudioTracks().length) {
        const node = audio.createMediaStreamSource(new MediaStream(screen.getAudioTracks()));
        const gain = audio.createGain(); gain.gain.value = systemGain / 100; node.connect(gain).connect(output);
        audioTracks.push(...screen.getAudioTracks());
      }
      if (mic) {
        // A requested microphone failure is visible; never silently produce a recording without it.
        const input = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true });
        micRef.current = input;
        const node = audio.createMediaStreamSource(input);
        const gain = audio.createGain(); gain.gain.value = micGain / 100;
        const analyser = audio.createAnalyser(); analyser.fftSize = 256;
        node.connect(gain); gain.connect(output); gain.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const measure = () => {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / samples.length);
          setMicLevel(Math.min(100, rms * 350));
          meterRef.current = requestAnimationFrame(measure);
        };
        measure(); audioTracks.push(...input.getAudioTracks());
        void navigator.mediaDevices.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audioinput')));
      }
      const combined = new MediaStream([videoTrack, ...(audioTracks.length ? output.stream.getAudioTracks() : [])]);
      mixedRef.current = combined;
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('No supported video encoder is available in this WebView. Update Microsoft Edge WebView2 Runtime.');
      const name = filename('Recording', mime.includes('mp4') ? 'mp4' : 'webm');
      savedName.current = name;
      if (desktop) sessionId = await invoke<string>('begin_recording', { filename: name, customDir: destination || null });
      const chunks: Blob[] = [];
      let queue = Promise.resolve();
      let writeError: unknown = null;
      let totalBytes = 0;
      const recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: quality * 1_000_000 });
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        totalBytes += event.data.size; setSize(totalBytes);
        if (desktop) {
          queue = queue.then(async () => {
            if (writeError) return;
            await invoke('append_recording', { sessionId, dataBase64: await dataUrl(event.data) });
          }).catch(err => {
            writeError = err;
            stopRef.current();
          });
        } else chunks.push(event.data);
      };
      recorder.onerror = () => { setError('The video encoder stopped unexpectedly. Any captured data will be saved.'); stopRef.current(); };
      recorder.onstop = async () => {
        setPhase('saving'); releaseAudio(); releaseScreen();
        await queue;
        try {
          if (desktop) {
            const file = await invoke<string>('finish_recording', { sessionId });
            if (writeError) throw new Error('The recording could not be fully written: ' + errorMessage(writeError) + '. Partial file: ' + file);
            setSaved(file);
          } else {
            const blob = new Blob(chunks, { type: mime });
            savedBlob.current = blob; download(blob, name); setSaved(name);
          }
          window.dispatchEvent(new Event('media-saved'));
        } catch (err) { setError(errorMessage(err)); }
        finally { recorderRef.current = null; setPhase('idle'); onRecordingChange(false); busyRef.current = false; if (desktop) void invoke('close_recording_overlay', {restoreMain:true}).catch(() => {}); }
      };
      elapsedRef.current = 0; activeSince.current = performance.now();
      setSeconds(0); setSize(0); recorder.start(1000); setCropping(false); setPhase('recording'); onRecordingChange(true);
      if (desktop) {
        await invoke('sync_recording_overlay', {status:{phase:'recording',seconds:0}});
        await invoke('show_recording_overlay', {displayId,frame:showFrame && source!=='window',minimize:autoMinimize}).catch(err => setWarning('Floating controls: '+errorMessage(err)));
      }
    } catch (err) {
      releaseAudio(); releaseScreen();
      if (sessionId) await invoke('finish_recording', { sessionId }).catch(() => {});
      setPhase('idle'); onRecordingChange(false); setError(errorMessage(err));
    } finally { busyRef.current = false; }
  };
  const pause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause(); elapsedRef.current += performance.now() - activeSince.current; setSeconds(elapsedRef.current / 1000); setPhase('paused');
    } else if (recorder.state === 'paused') { recorder.resume(); activeSince.current = performance.now(); setPhase('recording'); }
  };
  actions.current = { start: () => { void startRecording(); }, pause, stop: stopRecording };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const pickFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const value = await open({ directory: true, title: 'Save recordings to' });
      if (typeof value === 'string') { setDestination(value); setFolderLabel(value); }
    } catch (err) { setError(errorMessage(err)); }
  };
  return <div className="page recorder-page">
    <div className="page-heading"><h1>Recorder</h1><div className="inline-actions"><span className="quiet-label">{screenInfo}</span><button className={'icon-button '+(more?'selected':'')} title="Recording settings" aria-label="Recording settings" aria-expanded={more} onClick={() => setMore(!more)}><SlidersHorizontal size={20}/></button></div></div>
    {error && <Notice error onDismiss={() => setError('')}>{error}</Notice>}
    {warning && <Notice onDismiss={() => setWarning('')}>{warning}</Notice>}
    {saved && <Notice><strong>Recording saved.</strong><button className="text-button" onClick={() => desktop ? void invoke('open_file_in_explorer', { filePath: saved }).catch(err => setError(errorMessage(err))) : savedBlob.current && download(savedBlob.current, savedName.current)}>{desktop?'Show in folder':'Download'} <ArrowUpRight size={14}/></button></Notice>}
    <div className="recorder-sourcebar">
      <div className="segmented">{sources.map(({id,icon:Icon}) => <button key={id} disabled={locked} aria-pressed={source===id} onClick={() => { if(source!==id){releaseScreen();setPhase('idle');}setSource(id); }}><Icon size={17}/>{id==='monitor'?'Screen':id==='window'?'Window':'Area'}</button>)}</div>
      {desktop && displays.length > 1 && source !== 'window' && <div className="frame-display"><span>Display frame</span><Select aria-label="Display frame" value={displayId} disabled={locked} onValueChange={value=>setDisplayId(+value)} options={displays.map(d=>({value:d.id,label:d.name}))} /></div>}
      {screenInfo && <div className="inline-actions"><button className="icon-button" title="Change source" aria-label="Change source" disabled={locked} onClick={chooseSource}><ArrowsClockwise size={18}/></button><button className="icon-button" title="Disconnect" aria-label="Disconnect source" disabled={locked} onClick={() => {releaseScreen();setPhase('idle');if(desktop)void invoke('close_recording_overlay',{restoreMain:false});}}><X size={17}/></button></div>}
    </div>
    <section className="capture-workspace" aria-label="Capture preview">
      <div className="preview-topline"><span><i className={'status-dot '+(phase==='recording'?'recording pulse':'')}/>{phase==='recording'?'Recording':phase==='paused'?'Paused':phase==='ready'?'Source connected':'Preview'}</span><span>{source==='region'&&crop&&videoRef.current?Math.round(crop.w*videoRef.current.videoWidth)+' × '+Math.round(crop.h*videoRef.current.videoHeight):fps+' fps'}</span></div>
      <div className={'preview-stage '+(screenInfo?'has-source':'')}>
        <div className="video-wrap"><video ref={videoRef} muted autoPlay playsInline className={screenInfo?'':'no-video'}/>
          {screenInfo&&source==='region'&&<div className={'crop-layer '+(cropping?'editable':'')} onPointerDown={e=>{if(!cropping||locked)return;e.currentTarget.setPointerCapture(e.pointerId);startPoint.current=point(e);setCrop(null);}} onPointerMove={e=>{if(!cropping||!e.currentTarget.hasPointerCapture(e.pointerId))return;const end=point(e),start=startPoint.current;setCrop({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)});}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}>{crop&&<div className="crop-box" style={{left:crop.x*100+'%',top:crop.y*100+'%',width:crop.w*100+'%',height:crop.h*100+'%'}}/>}</div>}
        </div>
        {!screenInfo&&<div className="preview-empty"><div className="capture-symbol"><Monitor size={38} weight="thin"/><Record size={12} weight="fill"/></div><button className="button secondary" disabled={locked} onClick={chooseSource}><Monitor size={17}/>{phase==='selecting'?'Selecting…':'Choose capture source'}</button></div>}
        {screenInfo&&cropping&&<span className="preview-help">Drag to select</span>}
      </div>
      <div className="transport"><div className="timer-block"><span className="timer">{duration(seconds)}</span><span className="quiet-label">{phase==='saving'?'Saving…':size?bytes(size):phase==='ready'?'Ready':''}</span></div><div className="transport-buttons">
        {(phase==='recording'||phase==='paused')?<><button className="icon-button" title="Floating controls" aria-label="Floating controls" onClick={()=>{if(desktop)void invoke('show_recording_overlay',{displayId,frame:showFrame&&source!=='window',minimize:true}).catch(err=>setError(errorMessage(err)));}}><ArrowSquareOut size={19}/></button><button className="button secondary" onClick={pause}>{phase==='paused'?<Play size={17}/>:<Pause size={17}/>} {phase==='paused'?'Resume':'Pause'}</button><button className="button primary" onClick={stopRecording}><Stop size={16} weight="fill"/>Stop & save</button></>:<button className="button primary" disabled={phase!=='ready'} onClick={startRecording}><Record size={17} weight="fill" className="record-icon"/>{phase==='saving'?'Saving…':'Start recording'}</button>}
      </div></div>
    </section>
    <div className="recorder-quick"><label className="quick-toggle"><SpeakerHigh size={18}/><span>System audio</span><input type="checkbox" role="switch" checked={systemAudio} disabled={locked||phase==='ready'} onChange={e=>setSystemAudio(e.target.checked)}/></label><label className="quick-toggle"><Microphone size={18}/><span>Mic</span><input type="checkbox" role="switch" checked={mic} disabled={locked} onChange={e=>setMic(e.target.checked)}/></label><div className="segmented">{[30,60].map(rate=><button key={rate} disabled={locked} aria-pressed={fps===rate} onClick={()=>setFps(rate)}>{rate} fps</button>)}</div></div>
    {more&&<section className="advanced-settings panel"><div className="form-grid">
      <div className="field"><span>Quality</span><Select aria-label="Quality" value={quality} disabled={locked} onValueChange={value=>setQuality(+value)} options={[{value:4,label:'Standard · 4 Mbps'},{value:8,label:'High · 8 Mbps'},{value:16,label:'Ultra · 16 Mbps'}]} /></div>
      {desktop&&<div className="field"><span>Frame display</span><Select aria-label="Frame display" value={displayId} disabled={locked} onValueChange={value=>setDisplayId(+value)} options={displays.map(d=>({value:d.id,label:d.name+' · '+d.width+' × '+d.height}))} /></div>}
      <label className="field"><span>System volume · {systemGain}%</span><input aria-label="System volume" type="range" min="0" max="100" value={systemGain} disabled={locked} onChange={e=>setSystemGain(+e.target.value)}/></label>
      {mic&&<><div className="field"><span>Microphone</span><Select aria-label="Microphone device" value={micId} disabled={locked} onValueChange={setMicId} options={[{value:'',label:'Default'},...devices.filter(d=>d.deviceId!=='default').map((d,i)=>({value:d.deviceId,label:d.label||'Microphone '+(i+1)}))]} /></div><label className="field"><span>Mic volume · {micGain}%</span><input aria-label="Microphone volume" type="range" min="0" max="100" value={micGain} disabled={locked} onChange={e=>setMicGain(+e.target.value)}/><div className="meter"><div style={{width:micLevel+'%'}}/></div></label></>}
    </div>{desktop&&<div className="inline-actions preferences-row"><label><input type="checkbox" checked={autoMinimize} disabled={locked} onChange={e=>setAutoMinimize(e.target.checked)}/>Minimize after selection</label><label><input type="checkbox" checked={showFrame} disabled={locked} onChange={e=>setShowFrame(e.target.checked)}/>Display border</label></div>}
    {source==='region'&&screenInfo&&<button className="text-button" disabled={locked} onClick={()=>desktop?void invoke('capture_display',{displayId,region:true,purpose:'recording'}).catch(err=>setError(errorMessage(err))):setCropping(!cropping)}><Crop size={16}/>Select area</button>}
    </section>}
    <div className="save-destination"><FolderOpen size={16}/><span title={folderLabel}>{desktop?folderLabel:'Downloads'}</span>{desktop&&<button className="text-button" disabled={locked} onClick={pickFolder}>Change</button>}</div>
  </div>;
}
