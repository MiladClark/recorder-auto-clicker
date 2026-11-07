export type ActiveTab = 'recorder' | 'voice' | 'screenshot' | 'clicker' | 'library';
export interface Binding { vk: number; ctrl: boolean; shift: boolean; alt: boolean; win: boolean; label: string }
export interface ClickerItem {
  id: string;
  action: Binding | null;
  mode: 'repeat' | 'hold' | 'cycle' | 'burst';
  interval_ms: number;
  hold_ms: number;
  burst_ms: number;
  pause_ms: number;
  trigger: Binding | null;
}
export interface AutoClickerStatus { id: string; running: boolean; clicks: number; phase: 'clicking' | 'holding' | 'resting' | 'stopped' }
export interface Display { id: number; name: string; x: number; y: number; width: number; height: number; scale: number }
export interface ScreenCaptureResult { data_url: string; width: number; height: number }
export interface RecordingMeta { name: string; path: string; size_bytes: number; created_at: number; kind: 'video' | 'image' | 'audio' }
