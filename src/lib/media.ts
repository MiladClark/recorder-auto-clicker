import { isTauri } from '@tauri-apps/api/core';
export const desktop = isTauri();
export function errorMessage(error: unknown, fallback = 'Could not complete this action. Please try again.') {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[FrameCue]', error);
  if (/NotAllowed|Permission denied|permission.*dismissed/i.test(message)) return 'Access was not allowed. Check Windows privacy settings and try again.';
  if (/NotFound|no.*microphone|device.*not found/i.test(message)) return 'No microphone found. Connect one and try again.';
  if (/NotReadable|device.*(busy|in use)/i.test(message)) return 'This device is busy. Close the other app and try again.';
  if (/AbortError|cancelled|canceled/i.test(message)) return 'Cancelled. You can try again.';
  if (/Windows app/.test(message) && message.length < 160) return 'This action is available in the Windows app.';
  if (/display disconnected/i.test(message)) return 'Display disconnected. Choose another display.';
  if (/disk.*full|not enough.*space/i.test(message)) return 'Not enough free space. Choose another save folder.';
  if (/access.*denied|permission.*denied/i.test(message)) return 'Cannot access this folder. Choose another save location.';
  if (/^(Choose |Set |Select a larger|Finish the current|Stop |This (button|shortcut)|A (button|shortcut)|Another recording)/.test(message) && message.length < 180 && !/[{}]|Cargo|plugin|from_bytes/i.test(message)) return message;
  if (/^((Delay|Click interval|Hold time|Click time|Pause time) must be between|You can save up to|Use a different start\/stop|Ctrl \+ Shift \+ F12 is reserved)/.test(message) || /^[\w +]+ is already assigned to another item\.$/.test(message)) return message;
  return fallback;
}
export function filename(prefix: string, extension: string) {
  return prefix + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording chunk.'));
    reader.readAsDataURL(blob);
  });
}
export function duration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(v => String(v).padStart(2, '0')).join(':');
}
export function bytes(value: number) {
  if (!value) return '0 B';
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return (value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + ['B', 'KB', 'MB', 'GB'][index];
}
