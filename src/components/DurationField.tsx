import { useEffect, useState } from 'react';
import { Select } from './Select';

/** Keeps the edited text (including an empty field) separate from the saved duration. */
export function DurationField({ id, label, value, disabled, onChange }: {
  id: string; label: string; value: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const [unit, setUnit] = useState<'ms' | 's'>(value >= 1000 ? 's' : 'ms');
  const [text, setText] = useState(String(value >= 1000 ? value / 1000 : value));
  useEffect(() => {
    if (Number.isFinite(value)) setText(previous => {
      const current = Number(previous) * (unit === 's' ? 1000 : 1);
      return previous.trim() && current === value ? previous : String(Number((value / (unit === 's' ? 1000 : 1)).toPrecision(12)));
    });
  }, [value, unit]);
  return <div className="clicker-setting timing-setting">
    <label htmlFor={id}>{label}</label>
    <div className="delay-control">
      <input id={id} aria-label={label} type="number" min={unit === 's' ? 0.0001 : 0.1}
        max={unit === 's' ? 3600 : 3600000} step="any" value={text} disabled={disabled}
        onChange={event => {
          setText(event.target.value);
          onChange(event.target.value.trim() ? Number(event.target.value) * (unit === 's' ? 1000 : 1) : NaN);
        }} />
      <Select aria-label={label + ' unit'} value={unit} disabled={disabled}
        options={[{ value: 'ms', label: 'ms' }, { value: 's', label: 'sec' }]}
        onValueChange={value => {
          const next = value as 'ms' | 's';
          if (text.trim() && Number.isFinite(Number(text))) setText(String(Number((next === 's' ? Number(text) / 1000 : Number(text) * 1000).toPrecision(12))));
          setUnit(next);
        }} />
    </div>
  </div>;
}
