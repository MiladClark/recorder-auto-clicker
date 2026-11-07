import { useEffect, useLayoutEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { RecorderTab } from './components/RecorderTab';
import { ScreenshotTab } from './components/ScreenshotTab';
import { ClickerTab } from './components/ClickerTab';
import { LibraryTab } from './components/LibraryTab';
import type { ActiveTab } from './types';
import { useTheme } from './lib/useTheme';
import { VoiceRecorderTab } from './components/VoiceRecorderTab';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('recorder');
  const [theme, setTheme] = useTheme();
  useLayoutEffect(() => { document.documentElement.dataset.tool = activeTab; }, [activeTab]);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyR') {
        event.preventDefault(); setActiveTab('recorder');
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyS') {
        event.preventDefault(); setActiveTab('screenshot');
      }
    };
    window.addEventListener('keydown', keydown);
    const pending = isTauri() ? listen<ActiveTab>('navigate', event => setActiveTab(event.payload)) : null;
    return () => {
      window.removeEventListener('keydown', keydown);
      void pending?.then(unlisten => unlisten());
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const pending = getCurrentWindow().onCloseRequested(event => {
      if (isRecording || isVoiceRecording || isClicking) { event.preventDefault(); setClosing(true); }
    });
    return () => { void pending.then(unlisten => unlisten()); };
  }, [isRecording, isVoiceRecording, isClicking]);
  return <div className="app-shell">
    <TitleBar activeTab={activeTab} onTabChange={setActiveTab} isRecording={isRecording} isVoiceRecording={isVoiceRecording} isClicking={isClicking} theme={theme} onThemeChange={setTheme} />
    <main className="workspace">
      {/* Keep streams, editor history and settings alive when switching tools. */}
      <div hidden={activeTab !== 'recorder'}><RecorderTab onRecordingChange={setIsRecording} /></div>
      <div hidden={activeTab !== 'voice'}><VoiceRecorderTab onRecordingChange={setIsVoiceRecording} /></div>
      <div hidden={activeTab !== 'screenshot'}><ScreenshotTab /></div>
      <div hidden={activeTab !== 'clicker'}><ClickerTab onStatusChange={setIsClicking} /></div>
      <div hidden={activeTab !== 'library'}><LibraryTab active={activeTab === 'library'} onNavigate={setActiveTab} /></div>
    </main>
    {closing && <div className="modal-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-title">
      <h2 id="close-title">A session is still active</h2>
      <p>Stop and save your recording, or stop the auto-clicker, before closing FrameCue.</p>
      <button className="button primary" onClick={() => { setClosing(false); setActiveTab(isRecording ? 'recorder' : isVoiceRecording ? 'voice' : 'clicker'); }}>Return to session</button>
    </section></div>}
  </div>;
}
