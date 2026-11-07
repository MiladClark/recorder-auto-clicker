import { useEffect, useLayoutEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type Theme = 'light' | 'dark' | 'colorful';
const key = 'framecue.theme.v1';
const valid = (value: string | null): value is Theme => value === 'light' || value === 'dark' || value === 'colorful';
function storedTheme(): Theme | null {
  try { const value = localStorage.getItem(key); return valid(value) ? value : null; } catch { return null; }
}
function initialTheme(): Theme {
  return storedTheme() ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const scheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', scheme === 'dark');
    document.documentElement.style.colorScheme = scheme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
    if (isTauri()) void getCurrentWindow().setTheme(scheme).catch(error => console.warn('Window theme:', error));
  }, [theme]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const systemChanged = () => { if (!storedTheme()) setTheme(media.matches ? 'light' : 'dark'); };
    const storageChanged = (event: StorageEvent) => { if (event.key === key || event.key === null) setTheme(initialTheme()); };
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    return () => {
      media.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);
  const changeTheme = (next: Theme) => {
    try { localStorage.setItem(key, next); } catch { /* The current window still switches if storage is unavailable. */ }
    setTheme(next);
  };
  return [theme, changeTheme] as const;
}
