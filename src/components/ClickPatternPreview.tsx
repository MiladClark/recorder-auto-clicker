import { useEffect, useRef } from 'react';

const format = (ms: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(ms >= 1000 ? ms / 1000 : ms) + (ms >= 1000 ? ' s' : ' ms');

export function ClickPatternPreview({ mode, activeMs, pauseMs }: {
  mode: 'cycle' | 'burst'; activeMs: number; pauseMs: number;
}) {
  const cursor = useRef<HTMLSpanElement>(null);
  const valid = [activeMs, pauseMs].every(value => Number.isFinite(value) && value >= 0.1 && value <= 3600000);
  const action = mode === 'cycle' ? 'Hold' : 'Click';
  const description = valid ? `${action} ${format(activeMs)} → Pause ${format(pauseMs)} → Repeat` : 'Set both times to preview';
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    const update = () => {
      animation?.cancel();
      if (valid && !preference.matches && !document.hidden) {
        animation = cursor.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], {
          duration: activeMs + pauseMs, iterations: Infinity, easing: 'linear',
        });
      }
    };
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      animation?.cancel();
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [activeMs, pauseMs, valid]);
  return <div className="click-pattern-preview" role="img" aria-label={description} data-valid={valid}>
    <div className="click-pattern-labels" aria-hidden="true"><span>{action} {valid ? format(activeMs) : '—'}</span><span>Pause {valid ? format(pauseMs) : '—'}</span><small>↻</small></div>
    <div className="click-pattern-track" aria-hidden="true">
      <span className="click-pattern-active" style={{ width: valid ? `${activeMs / (activeMs + pauseMs) * 100}%` : '50%' }} />
      <span className="click-pattern-cursor" ref={cursor}><i /></span>
    </div>
  </div>;
}
