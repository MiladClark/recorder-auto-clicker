import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check } from '@phosphor-icons/react';

type Option = { value: string | number; label: string; disabled?: boolean };
type Props = {
  'aria-label': string;
  value: string | number;
  options: Option[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  onOpen?: () => void;
};

/** Select-only combobox: focus stays on the trigger while its list is open. */
export function Select({ value, options, onValueChange, disabled, onOpen, 'aria-label': label }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ top: 0, left: 0, minWidth: 0, maxHeight: 280 });
  const selected = options.findIndex(option => String(option.value) === String(value));
  const optionId = (index: number) => `${id}-option-${index}`;
  const activeOptionId = optionId(active);

  const show = (last = false) => {
    if (disabled || !options.some(option => !option.disabled)) return;
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
    setActive(selected >= 0 && !options[selected].disabled ? selected : enabled[last ? enabled.length - 1 : 0]);
    search.current = { text: '', time: 0 };
    // Keep the menu below its control, including settings near the window's bottom.
    if (trigger.current && innerHeight - trigger.current.getBoundingClientRect().bottom < 120) {
      trigger.current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    setOpen(true);
    onOpen?.();
  };
  const choose = (index: number) => {
    if (!options[index] || options[index].disabled) return;
    onValueChange(String(options[index].value));
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current;
    const list = menu.current;
    if (!anchor || !list) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const workspace = anchor.closest('.workspace')?.getBoundingClientRect();
      if (!rect.width || rect.bottom <= (workspace?.top ?? 0) || rect.top >= (workspace?.bottom ?? innerHeight)) {
        setOpen(false);
        return;
      }
      list.style.minWidth = `${Math.min(rect.width, innerWidth - 16)}px`;
      const width = list.getBoundingClientRect().width;
      const next = {
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
        minWidth: Math.min(rect.width, innerWidth - 16),
        maxHeight: Math.max(0, Math.min(280, innerHeight - rect.bottom - 14)),
      };
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    observer.observe(list);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeOptionId]);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const key = event.key;
    if (key === 'Tab') { setOpen(false); return; }
    if (key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (key === 'Enter' || key === ' ' && (performance.now() - search.current.time >= 650 || !search.current.text)) {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      if (!open) {
        show(key === 'ArrowUp' || key === 'End');
        if (key === 'Home') setActive(options.findIndex(option => !option.disabled));
        if (key === 'End') setActive(options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0).at(-1) ?? -1);
        return;
      }
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      const current = enabled.indexOf(active);
      const next = key === 'Home' ? 0 : key === 'End' ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, current + (key === 'ArrowDown' ? 1 : -1)));
      setActive(enabled[next] ?? -1);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!open) show();
      const now = performance.now();
      const previous = now - search.current.time < 650 ? search.current.text : '';
      const text = previous + key.toLowerCase();
      search.current = { text, time: now };
      const repeated = [...text].every(character => character === text[0]);
      const query = repeated ? text[0] : text;
      const start = repeated ? (open ? active : selected) + 1 : 0;
      for (let offset = 0; offset < options.length; offset++) {
        const index = (Math.max(0, start) + offset) % options.length;
        if (!options[index].disabled && options[index].label.toLowerCase().startsWith(query)) { setActive(index); break; }
      }
    }
  };

  return <>
    <button ref={trigger} type="button" role="combobox" className="select-trigger" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open && active >= 0 ? optionId(active) : undefined} disabled={disabled}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={keyDown} onBlur={() => setOpen(false)}>
      <span>{options[selected]?.label || 'Select'}</span><CaretDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="select-menu"
      style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={optionId(index)} role="option"
        aria-selected={selected === index} aria-disabled={option.disabled || undefined}
        data-value={String(option.value)} data-active={active === index || undefined} className="select-option"
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span>{option.label}</span>{selected === index && <Check size={15} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </>;
}
