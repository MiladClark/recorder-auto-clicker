import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, Keyboard, Mouse, PencilSimple, Play, Plus, Stop, Trash, X } from '@phosphor-icons/react';
import type { AutoClickerStatus, Binding, ClickerItem } from '../types';
import { desktop, errorMessage } from '../lib/media';
import { Notice } from './Notice';
import { ClickSpeedPreview } from './ClickSpeedPreview';
import { DurationField } from './DurationField';
import { ClickPatternPreview } from './ClickPatternPreview';

const previewKey = 'framecue.clicker.items.v1';
const f6: Binding = { vk: 117, ctrl: false, alt: false, shift: false, win: false, label: 'F6' };
type Learning = 'output' | 'trigger' | null;
const mouseNames: Record<number, string> = { 1: 'Mouse left', 2: 'Mouse right', 4: 'Mouse middle', 5: 'Mouse 4', 6: 'Mouse 5' };
const isMouse = (binding: Binding | null) => !!binding && binding.vk < 8;
const intervalText = (value: number) => value >= 1000 ? (value / 1000).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' s' : value.toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' ms';
const normalizeItem = (item: ClickerItem): ClickerItem => ({ ...item, hold_ms: item.hold_ms ?? 1000, burst_ms: item.burst_ms ?? 1000, pause_ms: item.pause_ms ?? 1000 });
function previewItems(): ClickerItem[] { try { const value: unknown = JSON.parse(localStorage.getItem(previewKey) || '[]'); return Array.isArray(value) ? value.map(normalizeItem) : []; } catch { return []; } }
const modeLabels: Record<ClickerItem['mode'], string> = { repeat: 'Repeat clicks', cycle: 'Hold & repeat', burst: 'Click in bursts', hold: 'Keep held' };
const modeHelp: Record<ClickerItem['mode'], string> = { repeat: 'Continuous clicks at your speed.', cycle: 'Press, hold, release, pause. Repeat.', burst: 'Click at your speed, pause. Repeat.', hold: 'Keep pressed until you stop.' };
function itemSummary(item: ClickerItem) {
  if (item.mode === 'hold') return 'Hold';
  if (item.mode === 'cycle') return 'Hold ' + intervalText(item.hold_ms) + ' · Pause ' + intervalText(item.pause_ms);
  if (item.mode === 'burst') return 'Click ' + intervalText(item.burst_ms) + ' · Pause ' + intervalText(item.pause_ms);
  return 'Repeat · ' + intervalText(item.interval_ms);
}

function BindingField({ label, value, listening, disabled, onBind, onClear, target }: {
  label: string; value: Binding | null; listening: boolean; disabled: boolean;
  onBind: () => void; onClear: () => void; target: 'output' | 'trigger';
}) {
  const Icon = isMouse(value) ? Mouse : Keyboard;
  return <div className="clicker-setting"><div><span>{label}</span>{target === 'trigger' && <small>{value ? 'Press once to start. Again to stop.' : 'Shortcut disabled'}</small>}</div>
    <div className="binding-actions"><button className={'binding-button ' + target + '-binding ' + (listening ? 'listening' : '')} aria-label={target === 'output' ? 'Choose action button' : 'Set start/stop shortcut'} disabled={disabled} onClick={onBind}><Icon size={19} /><span>{listening ? 'Press a button…' : value?.label || (target === 'output' ? 'Choose button' : 'Set shortcut')}</span></button>
      {value && <button className="icon-button" title="Clear" aria-label={target === 'output' ? 'Clear action button' : 'Clear start/stop shortcut'} disabled={disabled} onClick={onClear}><X size={16} /></button>}
    </div>
  </div>;
}
export function ClickerTab({ onStatusChange }: { onStatusChange: (running: boolean) => void }) {
  const [items, setItems] = useState<ClickerItem[]>(desktop ? [] : previewItems);
  const [statuses, setStatuses] = useState<Record<string, AutoClickerStatus>>({});
  const [draft, setDraft] = useState<ClickerItem | null>(null);
  const [learning, setLearning] = useState<Learning>(null);
  const [unit, setUnit] = useState<'ms' | 's'>('ms');
  const [delay, setDelay] = useState('100');
  const [ready, setReady] = useState(!desktop);
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState<Record<string, number>>({});
  const startTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const learningRef = useRef(learning); learningRef.current = learning;
  const anyRunning = Object.values(statuses).some(status => status.running) || Object.keys(starting).length > 0;
  const locked = pending || !!learning;

  useEffect(() => { onStatusChange(anyRunning); }, [anyRunning, onStatusChange]);
  useEffect(() => () => { startTimers.current.forEach(clearInterval); }, []);
  useEffect(() => {
    mounted.current = true;
    if (!desktop) return () => { mounted.current = false; };
    const subscriptions = [
      listen<AutoClickerStatus>('autoclicker:update', event => {
        if (!mounted.current) return;
        if (event.payload.running) {
          clearInterval(startTimers.current.get(event.payload.id)); startTimers.current.delete(event.payload.id);
          setStarting(previous => { const next = { ...previous }; delete next[event.payload.id]; return next; });
        }
        setStatuses(previous => ({ ...previous, [event.payload.id]: event.payload }));
      }),
      listen('autoclicker:stop-all', () => { startTimers.current.forEach(clearInterval); startTimers.current.clear(); if (mounted.current) setStarting({}); }),
      listen<ClickerItem[]>('clicker:items', event => { if (mounted.current) setItems(event.payload); }),
      listen<string>('autoclicker:error', event => { if (mounted.current) setError(errorMessage(event.payload)); }),
      listen<string>('binding:error', event => { if (mounted.current) { setError(errorMessage(event.payload)); setLearning(null); } }),
      listen<{ target: Learning; binding: Binding }>('binding:changed', event => {
        if (!mounted.current || learningRef.current !== event.payload.target) return;
        setDraft(previous => previous ? { ...previous, [event.payload.target === 'output' ? 'action' : 'trigger']: event.payload.binding } : previous);
        setLearning(null);
      }),
    ];
    void Promise.all([invoke<ClickerItem[]>('get_clicker_items'), invoke<AutoClickerStatus[]>('get_autoclicker_status'), invoke<string>('get_binding_error'), invoke<string>('get_hotkey_status')])
      .then(([saved, current, bindingError, hotkeyError]) => {
        if (!mounted.current) return;
        setItems(saved); setStatuses(Object.fromEntries(current.map(status => [status.id, status])));
        setError(bindingError || hotkeyError ? errorMessage(bindingError || hotkeyError, 'Shortcuts are unavailable. Restart FrameCue to try again.') : ''); setReady(true);
      }).catch(reason => { if (mounted.current) setError(errorMessage(reason)); });
    return () => { mounted.current = false; subscriptions.forEach(subscription => void subscription.then(unlisten => unlisten())); };
  }, []);
  useEffect(() => {
    if (!learning) return;
    let captured = false;
    const timer = setTimeout(() => { setLearning(null); if (desktop) void invoke('cancel_binding'); }, 10000);
    const choose = (binding: Binding) => {
      if (captured) return;
      captured = true;
      setDraft(previous => previous ? { ...previous, [learning === 'output' ? 'action' : 'trigger']: binding } : previous);
      setLearning(null); if (desktop) void invoke('cancel_binding');
    };
    const keyboard = (event: KeyboardEvent) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      choose({ vk: event.keyCode, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, win: event.metaKey,
        label: [...(event.ctrlKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.metaKey ? ['Win'] : []), event.key.length === 1 ? event.key.toUpperCase() : event.key].join(' + ') });
    };
    const mouse = (event: PointerEvent) => {
      const vk = [1, 4, 2, 5, 6][event.button]; if (!vk) return;
      event.preventDefault(); event.stopPropagation();
      choose({ vk, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, win: event.metaKey, label: mouseNames[vk] });
    };
    const modifier = (event: KeyboardEvent) => {
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      choose({ vk: event.keyCode, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, win: event.metaKey, label: event.key === 'Control' ? 'Ctrl' : event.key === 'Meta' ? 'Win' : event.key });
    };
    window.addEventListener('keydown', keyboard, true); window.addEventListener('keyup', modifier, true); window.addEventListener('pointerdown', mouse, true);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('keyup', modifier, true); window.removeEventListener('pointerdown', mouse, true); };
  }, [learning]);
  const edit = (item?: ClickerItem) => {
    setError('');
    const next = item ? normalizeItem(structuredClone(item)) : { id: crypto.randomUUID(), action: null, mode: 'repeat' as const, interval_ms: 100, hold_ms: 1000, burst_ms: 1000, pause_ms: 1000, trigger: items.some(value => value.trigger?.vk === 117) ? null : { ...f6 } };
    setDraft(next); setUnit(next.interval_ms >= 1000 ? 's' : 'ms'); setDelay(String(next.interval_ms >= 1000 ? next.interval_ms / 1000 : next.interval_ms));
  };
  const bind = async (target: Exclude<Learning, null>) => {
    setError(''); setPending(true);
    try { setLearning(target); learningRef.current = target; if (desktop) await invoke('arm_binding', { target }); }
    catch (reason) { setLearning(null); setError(errorMessage(reason)); } finally { setPending(false); }
  };
  const save = async () => {
    if (!draft) return;
    const interval = Number(delay) * (unit === 's' ? 1000 : 1);
    const usesSpeed = draft.mode === 'repeat' || draft.mode === 'burst';
    if (usesSpeed && (!Number.isFinite(interval) || interval < 0.1 || interval > 3600000)) { setError('Click interval must be between 0.1 ms and 1 hour.'); return; }
    const activeFields = draft.mode === 'cycle' ? [['Hold time', draft.hold_ms], ['Pause time', draft.pause_ms]] : draft.mode === 'burst' ? [['Click time', draft.burst_ms], ['Pause time', draft.pause_ms]] : [];
    for (const [label, value] of activeFields) {
      if (!Number.isFinite(value) || Number(value) < 0.1 || Number(value) > 3600000) { setError(label + ' must be between 0.1 ms and 1 hour.'); return; }
    }
    // Invalid text in a hidden field must not break a different action mode.
    const safe = (value: number) => Number.isFinite(value) && value >= 0.1 && value <= 3600000 ? value : 1000;
    const item = { ...draft, interval_ms: usesSpeed ? interval : draft.interval_ms, hold_ms: safe(draft.hold_ms), burst_ms: safe(draft.burst_ms), pause_ms: safe(draft.pause_ms) };
    setError(''); setPending(true);
    try {
      if (desktop) setItems(await invoke<ClickerItem[]>('save_clicker_item', { item }));
      else { const next = items.some(value => value.id === item.id) ? items.map(value => value.id === item.id ? item : value) : [...items, item]; localStorage.setItem(previewKey, JSON.stringify(next)); setItems(next); }
      setDraft(null);
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(false); }
  };
  const remove = async (id: string) => {
    setError(''); setPending(true);
    try {
      if (desktop) setItems(await invoke<ClickerItem[]>('delete_clicker_item', { id }));
      else { const next = items.filter(item => item.id !== id); localStorage.setItem(previewKey, JSON.stringify(next)); setItems(next); }
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(false); }
  };
  const toggle = async (id: string) => {
    setError(''); setPending(true);
    try {
      if (!desktop) throw new Error('Open the Windows app to run this item.');
      if (starting[id]) {
        clearInterval(startTimers.current.get(id)); startTimers.current.delete(id);
        setStarting(previous => { const next = { ...previous }; delete next[id]; return next; });
      } else if (statuses[id]?.running) await invoke('stop_autoclicker', { id });
      else {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (isMouse(items.find(item => item.id === id)?.action || null)) {
          // Give a mouse action time to leave its own Start/Stop button.
          let remaining = 2; setStarting(previous => ({ ...previous, [id]: remaining }));
          const timer = setInterval(() => {
            remaining--;
            if (remaining) { setStarting(previous => ({ ...previous, [id]: remaining })); return; }
            clearInterval(timer); startTimers.current.delete(id);
            setStarting(previous => { const next = { ...previous }; delete next[id]; return next; });
            void invoke('start_autoclicker', { id }).catch(reason => { if (mounted.current) setError(errorMessage(reason)); });
          }, 1000);
          startTimers.current.set(id, timer);
        } else await invoke('start_autoclicker', { id });
      }
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(false); }
  };
  const stopAll = async () => { setError(''); startTimers.current.forEach(clearInterval); startTimers.current.clear(); setStarting({}); try { await invoke('stop_autoclicker', { id: null }); } catch (reason) { setError(errorMessage(reason)); } };

  return <div className="page clicker-page">
    <div className="page-heading"><div className="clicker-heading">{draft && <button className="icon-button" aria-label="Back to items" disabled={locked} onClick={() => { setDraft(null); setError(''); }}><ArrowLeft size={19} /></button>}<h1>{draft ? items.some(item => item.id === draft.id) ? 'Edit item' : 'New item' : 'Auto-clicker'}</h1></div>
      {!draft && <div className="inline-actions">{anyRunning && <button className="button secondary" onClick={stopAll}><Stop size={16} />Stop all</button>}<button className="button primary" disabled={!ready || pending || anyRunning} onClick={() => edit()}><Plus size={17} />Add item</button></div>}
    </div>
    {error && <Notice error onDismiss={() => setError('')}>{error}</Notice>}
    {draft ? <>
      <section className="clicker-editor panel" aria-label="Item settings">
        <BindingField label="Button" value={draft.action} target="output" listening={learning === 'output'} disabled={locked} onBind={() => void bind('output')} onClear={() => setDraft({ ...draft, action: null })} />
        <div className="clicker-setting"><span>Action</span><Select aria-label="Action mode" value={draft.mode} options={Object.entries(modeLabels).map(([value, label]) => ({ value, label }))} disabled={locked} onValueChange={mode => setDraft({ ...draft, mode: mode as ClickerItem['mode'] })} /></div>
        <p className="clicker-help">{modeHelp[draft.mode]}</p>
        {(draft.mode === 'repeat' || draft.mode === 'burst') && <div className="clicker-setting delay-setting"><label htmlFor="clicker-delay">Speed</label><div className="delay-adjustment"><div className="delay-control"><input id="clicker-delay" aria-label="Delay between actions" type="number" min={unit === 's' ? 0.0001 : 0.1} max={unit === 's' ? 3600 : 3600000} step="any" value={delay} disabled={locked} onChange={event => setDelay(event.target.value)} /><Select aria-label="Delay unit" value={unit} disabled={locked} options={[{value:'ms',label:'ms'},{value:'s',label:'sec'}]} onValueChange={value => { const next = value as 'ms' | 's'; if (delay && Number.isFinite(Number(delay))) setDelay(String(Number((next === 's' ? Number(delay) / 1000 : Number(delay) * 1000).toPrecision(12)))); setUnit(next); }} /></div><ClickSpeedPreview intervalMs={delay.trim() ? Number(delay) * (unit === 's' ? 1000 : 1) : NaN} /></div></div>}
        {draft.mode === 'cycle' && <DurationField key="hold" id="clicker-hold" label="Hold for" value={draft.hold_ms} disabled={locked} onChange={hold_ms => setDraft({ ...draft, hold_ms })} />}
        {draft.mode === 'burst' && <DurationField key="burst" id="clicker-burst" label="Click for" value={draft.burst_ms} disabled={locked} onChange={burst_ms => setDraft({ ...draft, burst_ms })} />}
        {(draft.mode === 'cycle' || draft.mode === 'burst') && <>
          <DurationField id="clicker-pause" label="Pause for" value={draft.pause_ms} disabled={locked} onChange={pause_ms => setDraft({ ...draft, pause_ms })} />
          <ClickPatternPreview mode={draft.mode} activeMs={draft.mode === 'cycle' ? draft.hold_ms : draft.burst_ms} pauseMs={draft.pause_ms} />
        </>}
        <BindingField label="Start / stop" value={draft.trigger} target="trigger" listening={learning === 'trigger'} disabled={locked} onBind={() => void bind('trigger')} onClear={() => setDraft({ ...draft, trigger: null })} />
      </section>
      {learning && <p className="binding-prompt" role="status">Press a key or mouse button.</p>}
      <div className="clicker-editor-footer"><button className="button secondary" disabled={locked} onClick={() => { setDraft(null); setError(''); }}>Cancel</button><button className="button primary" disabled={locked} onClick={() => void save()}>Save item</button></div>
    </> : <section className="clicker-items" aria-label="Auto-clicker items">
      {!ready ? <p className="clicker-empty" role="status">Loading items…</p> : !items.length ? <div className="clicker-empty"><Mouse size={29} /><p>No items yet.</p><button className="text-button" onClick={() => edit()}>Add your first item</button></div> : items.map(item => {
        const status = statuses[item.id]; const running = !!status?.running; const countdown = starting[item.id]; const Icon = isMouse(item.action) ? Mouse : Keyboard;
        return <article className={'clicker-item panel ' + (running ? 'is-running' : '')} key={item.id} data-item-id={item.id}>
          <Icon className="item-input-icon" size={22} />
          <button className="clicker-item-description" aria-label={'Edit ' + (item.action?.label || 'item')} disabled={anyRunning || pending} onClick={() => edit(item)}><strong>{item.action?.label || 'No button'}</strong><span>{countdown ? 'Starting in ' + countdown : running ? (status?.phase === 'resting' ? 'Paused · ' : status?.phase === 'holding' ? 'Holding · ' : '') + (status?.clicks || 0).toLocaleString() + (item.mode === 'cycle' || item.mode === 'hold' ? ' presses' : ' clicks') : itemSummary(item)}</span></button>
          <span className={'item-shortcut ' + (!item.trigger ? 'is-disabled' : '')}>{item.trigger ? <kbd>{item.trigger.label}</kbd> : 'No shortcut'}</span>
          <div className="item-actions"><button className={'icon-button item-run ' + (running || countdown ? 'is-running' : '')} disabled={pending || !item.action} aria-label={(running || countdown ? 'Stop ' : 'Start ') + (item.action?.label || 'item')} title={running || countdown ? 'Stop' : 'Start'} onClick={() => void toggle(item.id)}>{running || countdown ? <Stop size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><button className="icon-button item-edit" disabled={anyRunning || pending} aria-label={'Edit settings for ' + (item.action?.label || 'item')} title="Edit" onClick={() => edit(item)}><PencilSimple size={18} /></button><button className="icon-button" disabled={anyRunning || pending} aria-label={'Delete ' + (item.action?.label || 'item')} title="Delete item" onClick={() => void remove(item.id)}><Trash size={18} /></button></div>
        </article>;
      })}
    </section>}
    {!draft && <div className="shortcut-note"><span>Stop all</span><kbd>Ctrl + Shift + F12</kbd></div>}
  </div>;
}
