import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X, VideoCamera, Camera, CursorClick, FolderOpen, Sun, Moon, Microphone, Palette } from '@phosphor-icons/react';
import { BrandMark } from './BrandMark';
import type { ActiveTab } from '../types';
import type { Theme } from '../lib/useTheme';
import { version } from '../../package.json';
interface Props { activeTab: ActiveTab; onTabChange: (tab: ActiveTab) => void; isRecording: boolean; isVoiceRecording: boolean; isClicking: boolean; theme: Theme; onThemeChange: (theme: Theme) => void }
const tabs = [
  { id: 'recorder', label: 'Recorder', icon: VideoCamera },
  { id: 'voice', label: 'Voice Recorder', icon: Microphone },
  { id: 'screenshot', label: 'Screenshot', icon: Camera },
  { id: 'clicker', label: 'Auto-clicker', icon: CursorClick },
  { id: 'library', label: 'Library', icon: FolderOpen },
] as const;
export function TitleBar({ activeTab, onTabChange, isRecording, isVoiceRecording, isClicking, theme, onThemeChange }: Props) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow(); let disposed = false;
    void win.isMaximized().then(value => { if (!disposed) setMaximized(value); });
    const pending = win.onResized(async () => { const value = await win.isMaximized(); if (!disposed) setMaximized(value); });
    return () => { disposed = true; void pending.then(unlisten => unlisten()); };
  }, []);
  return <>
    <header className="windowbar" data-tauri-drag-region>
      <div className="wordmark" data-tauri-drag-region>FrameCue <span>{tabs.find(tab => tab.id === activeTab)?.label}</span></div>
      <span className="window-context" data-tauri-drag-region>{isRecording ? 'Recording' : isVoiceRecording ? 'Voice recording' : isClicking ? 'Clicking' : ''}</span>
      <div className="theme-switch" role="group" aria-label="Color theme">
        <button type="button" aria-label="Use light theme" title="Light theme" aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}><Sun size={16} weight={theme === 'light' ? 'fill' : 'regular'} /></button>
        <button type="button" aria-label="Use dark theme" title="Dark theme" aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}><Moon size={15} weight={theme === 'dark' ? 'fill' : 'regular'} /></button>
        <button type="button" aria-label="Use colorful theme" title="Colorful theme" aria-pressed={theme === 'colorful'} onClick={() => onThemeChange('colorful')}><Palette size={16} weight={theme === 'colorful' ? 'fill' : 'regular'} /></button>
      </div>
      {isTauri() && <div className="window-controls">
        <button aria-label="Minimize" title="Minimize to tray" onClick={() => void invoke('minimize_to_tray')}><Minus size={14} /></button>
        <button aria-label={maximized ? 'Restore window' : 'Maximize'} onClick={() => void getCurrentWindow().toggleMaximize()}>{maximized ? <Copy size={13} /> : <Square size={13} />}</button>
        <button className="window-close" aria-label="Close" onClick={() => void getCurrentWindow().close()}><X size={15} /></button>
      </div>}
    </header>
    <aside className="icon-rail">
      <div className="rail-brand" title="FrameCue" aria-label="FrameCue"><BrandMark size={28} /></div>
      <nav className="tool-nav" aria-label="Tools">{tabs.map(({id,label,icon:Icon}) => <button key={id} data-tool={id} title={label} aria-label={label} className={activeTab===id?'active':''} aria-current={activeTab===id?'page':undefined} onClick={() => onTabChange(id)}><Icon size={21} weight={activeTab===id?'fill':'regular'}/>{((id==='recorder'&&isRecording)||(id==='voice'&&isVoiceRecording)||(id==='clicker'&&isClicking))&&<i className="nav-live"/>}<span className="nav-tooltip">{label}</span></button>)}</nav>
      <span className="rail-version">v{version}</span>
    </aside>
  </>;
}
