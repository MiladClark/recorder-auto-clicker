import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowSquareOut, ArrowUpRight, FolderOpen, Microphone, Pause, Play, Record, Stop, Waveform, ChartBar } from '@phosphor-icons/react';
import { dataUrl, desktop, download, duration, errorMessage, filename, bytes } from '../lib/media';
import { usePreference } from '../lib/usePreference';
import { AudioVisualizer } from './AudioVisualizer';
import { Notice } from './Notice';
import { Select } from './Select';
type Phase = 'idle' | 'connecting' | 'recording' | 'paused' | 'saving';

export function VoiceRecorderTab({ onRecordingChange }: { onRecordingChange: (active: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [micId, setMicId] = usePreference('voice.mic', '');
  const [mode, setMode] = usePreference('voice.visualizer', 'wave');
  const [destination, setDestination] = usePreference('voice.destination', '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [folder, setFolder] = useState('Music / OmniPulse');
  const [seconds, setSeconds] = useState(0), [size, setSize] = useState(0), [level, setLevel] = useState(0);
  const wholeSeconds = Math.floor(seconds);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState(''), [saved, setSaved] = useState(''), [preview, setPreview] = useState('');
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null);
  const elapsed = useRef(0), started = useRef(0), mounted = useRef(true), busy = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const actions = useRef({ start: () => {}, pause: () => {}, stop: () => {} });
  const objectUrl = useRef('');
  const enumerate = () => void navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(device => device.kind === 'audioinput'))).catch(console.error);
  const release = () => {
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
    void context.current?.close().catch(console.error); context.current = null; setAnalyser(null); setLevel(0);
  };
  useEffect(() => {
    mounted.current = true; enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    if (desktop) void invoke<{ audio: string }>('get_output_dirs').then(value => setFolder(value.audio)).catch(console.error);
    const pending = desktop ? listen<'start' | 'pause' | 'stop'>('voice:action', event => actions.current[event.payload]?.()) : null;
    return () => {
      mounted.current = false; navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
      void pending?.then(unlisten => unlisten());
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop()); void context.current?.close().catch(console.error);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  useEffect(() => { onRecordingChange(phase !== 'idle'); }, [phase, onRecordingChange]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setSeconds((elapsed.current + performance.now() - started.current) / 1000), 200);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!analyser || phase !== 'recording') { setLevel(0); return; }
    const samples = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => { analyser.getByteTimeDomainData(samples); let sum = 0; for (const sample of samples) sum += ((sample - 128) / 128) ** 2; setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3)); }, 100);
    return () => clearInterval(timer);
  }, [analyser, phase]);
  useEffect(() => { if (desktop) void invoke('sync_widget_status', { kind: 'voice', status: { phase, seconds: wholeSeconds, level } }).catch(console.error); }, [phase, wholeSeconds, level]);

  const stop = () => {
    const value = recorder.current;
    if (!value || value.state === 'inactive') return;
    if (value.state === 'recording') elapsed.current += performance.now() - started.current;
    setSeconds(elapsed.current / 1000); setPhase('saving'); value.stop();
  };
  const pause = () => {
    const value = recorder.current;
    if (value?.state === 'recording') { value.pause(); elapsed.current += performance.now() - started.current; setSeconds(elapsed.current / 1000); setPhase('paused'); }
    else if (value?.state === 'paused') { value.resume(); started.current = performance.now(); setPhase('recording'); }
  };
  const start = async () => {
    if (busy.current || phaseRef.current !== 'idle') return;
    busy.current = true; setError(''); setSaved(''); setPhase('connecting');
    let sessionId = '';
    try {
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('Audio recording is not supported.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!mounted.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input; enumerate();
      const audio = new AudioContext(); context.current = audio;
      const meter = audio.createAnalyser(); meter.fftSize = 2048; meter.smoothingTimeConstant = .8;
      audio.createMediaStreamSource(input).connect(meter); await audio.resume(); setAnalyser(meter);
      const name = filename('Voice', mime.includes('mp4') ? 'm4a' : 'webm');
      if (desktop) sessionId = await invoke<string>('begin_recording', { filename: name, customDir: destination || null, kind: 'audio' });
      const value = new MediaRecorder(input, { mimeType: mime, audioBitsPerSecond: 192000 }); recorder.current = value;
      let queue = Promise.resolve(), writeError: unknown = null, total = 0; const chunks: Blob[] = [];
      value.ondataavailable = event => {
        if (!event.data.size) return; total += event.data.size; setSize(total);
        if (desktop) queue = queue.then(async () => { if (!writeError) await invoke('append_recording', { sessionId, dataBase64: await dataUrl(event.data) }); }).catch(reason => { writeError = reason; actions.current.stop(); });
        else chunks.push(event.data);
      };
      value.onerror = () => { setError('Recording interrupted. Saving the captured audio.'); actions.current.stop(); };
      input.getAudioTracks()[0].onended = () => { setError('Microphone disconnected. Saving the captured audio.'); actions.current.stop(); };
      value.onstop = async () => {
        setPhase('saving'); release(); await queue;
        try {
          if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; }
          if (desktop) { const path = await invoke<string>('finish_recording', { sessionId }); setSaved(path); setPreview(convertFileSrc(path)); }
          else { const blob = new Blob(chunks, { type: mime }); objectUrl.current = URL.createObjectURL(blob); setPreview(objectUrl.current); setSaved(name); download(blob, name); }
          if (writeError) setError(errorMessage(writeError, 'Part of this recording could not be saved. Check your free disk space.'));
          window.dispatchEvent(new Event('media-saved'));
        } catch (reason) { setError(errorMessage(reason, 'Could not save the recording. Check your save folder and free disk space.')); }
        finally { recorder.current = null; setPhase('idle'); if (desktop) void invoke('close_widget', { kind: 'voice' }).then(() => invoke('tray_action', { action: 'voice' })).catch(console.error); }
      };
      elapsed.current = 0; started.current = performance.now(); setSeconds(0); setSize(0); setPreview(''); value.start(1000); setPhase('recording');
    } catch (reason) {
      release(); if (sessionId) await invoke('finish_recording', { sessionId }).catch(console.error);
      setError(errorMessage(reason, 'Could not start recording. Check your microphone and try again.')); setPhase('idle');
    } finally { busy.current = false; }
  };
  actions.current = { start: () => void start(), pause, stop };
  const locked = phase !== 'idle', active = phase === 'recording' || phase === 'paused';
  const floating = () => void invoke('show_widget', { kind: 'voice', displayId: null, minimize: true }).catch(reason => setError(errorMessage(reason)));
  const chooseFolder = async () => {
    try { const { open } = await import('@tauri-apps/plugin-dialog'); const selected = await open({ directory: true, title: 'Save voice recordings to' }); if (typeof selected === 'string') setDestination(selected); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  return <div className="page voice-page">
    <div className="page-heading"><h1>Voice Recorder</h1>{desktop && <button className="icon-button" aria-label="Voice floating controls" title="Floating controls" disabled={phase === 'connecting' || phase === 'saving'} onClick={floating}><ArrowSquareOut size={19} /></button>}</div>
    {error && <Notice error onDismiss={() => setError('')}>{error}</Notice>}
    {saved && <Notice onDismiss={() => setSaved('')}>Recording saved.{desktop && <button className="text-button" onClick={() => void invoke('open_file_in_explorer', { filePath: saved }).catch(reason => setError(errorMessage(reason)))}>Show in folder <ArrowUpRight size={14} /></button>}</Notice>}
    <div className="voice-sourcebar"><div className="inline-actions"><Microphone size={18} /><Select aria-label="Voice microphone" value={micId} disabled={locked} onValueChange={setMicId} options={[{ value: '', label: 'Default microphone' }, ...devices.filter(device => device.deviceId !== 'default').map((device, i) => ({ value: device.deviceId, label: device.label || `Microphone ${i + 1}` }))]} /></div><div className="segmented" aria-label="Visualizer style">{(['wave','bars'] as const).map(value => <button key={value} aria-label={value === 'wave' ? 'Waveform view' : 'Equalizer view'} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'wave' ? <Waveform size={17} /> : <ChartBar size={17} />}{value === 'wave' ? 'Wave' : 'Bars'}</button>)}</div></div>
    <section className="voice-console panel" aria-label="Voice recording">
      <div className="voice-topline"><span><i className={'status-dot ' + (phase === 'recording' ? 'recording pulse' : '')} />{phase === 'recording' ? 'Listening' : phase === 'paused' ? 'Paused' : phase === 'saving' ? 'Saving…' : phase === 'connecting' ? 'Connecting…' : 'Ready to record'}</span><span>{size ? bytes(size) : 'Microphone'}</span></div>
      <div className="voice-stage"><AudioVisualizer analyser={analyser} active={phase === 'recording'} variant={mode === 'bars' ? 'bars' : 'wave'} /></div>
      <div className="voice-transport"><span className="timer">{duration(seconds)}</span><div className="inline-actions">{active ? <><button className="button secondary" onClick={pause}>{phase === 'paused' ? <Play size={17} /> : <Pause size={17} />}{phase === 'paused' ? 'Resume' : 'Pause'}</button><button className="button primary" onClick={stop}><Stop size={17} weight="fill" />Stop & save</button></> : <button className="button primary" disabled={locked} onClick={() => void start()}><Record size={18} weight="fill" />{phase === 'connecting' ? 'Connecting…' : phase === 'saving' ? 'Saving…' : 'Record voice'}</button>}</div></div>
    </section>
    {preview && <div className="voice-playback"><span className="quiet-label">Last recording</span><audio aria-label="Voice recording preview" src={preview} controls preload="metadata" onError={() => setError('Could not play this recording. Open its folder to try another player.')} /></div>}
    <div className="save-destination"><FolderOpen size={16} /><span title={destination || folder}>{desktop ? destination || folder : 'Downloads'}</span>{desktop && <button className="text-button" disabled={locked} onClick={() => void chooseFolder()}>Change</button>}</div>
  </div>;
}
