import { useEffect, useState } from 'react';
type Value<T> = T extends string ? string : T extends number ? number : boolean;
export function usePreference<T extends string | number | boolean>(key: string, fallback: T) {
  const [value, setValue] = useState<Value<T>>(() => {
    let result: unknown = fallback;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem('omnipulse.' + key + '.v1') ?? 'null');
      if (typeof parsed === typeof fallback && (typeof parsed !== 'number' || Number.isFinite(parsed))) result = parsed;
    } catch { /* Use the default for unavailable or corrupted preferences. */ }
    return result as Value<T>;
  });
  useEffect(() => { try { localStorage.setItem('omnipulse.' + key + '.v1', JSON.stringify(value)); } catch { /* Preferences remain optional if storage is unavailable. */ } }, [key, value]);
  return [value, setValue] as const;
}
