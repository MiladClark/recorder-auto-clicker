import { useEffect, useRef } from 'react';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** A visual rhythm only: no input is sent and no per-click JavaScript timer runs. */
export function ClickSpeedPreview({ intervalMs }: { intervalMs: number }) {
  const dot = useRef<HTMLSpanElement>(null);
  const wave = useRef<HTMLSpanElement>(null);
  const valid = Number.isFinite(intervalMs) && intervalMs >= 0.1 && intervalMs <= 3600000;
  const merged = valid && intervalMs < 80;
  const rate = valid ? 1000 / intervalMs : 0;
  const label = !valid ? '— / sec' : rate >= 1 ? number.format(rate) + ' / sec' : '1 / ' + number.format(intervalMs / 1000) + ' sec';

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const update = () => {
      animations.forEach(animation => animation.cancel());
      animations = [];
      if (!valid || preference.matches || document.hidden || !dot.current || !wave.current) return;
      if (merged) {
        // Beyond a readable pulse rate, show merged activity and the exact numeric rate.
        animations.push(wave.current.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
          { duration: 800, iterations: Infinity },
        ));
      } else {
        const peak = Math.min(55 / intervalMs, 0.45);
        const rest = Math.min(170 / intervalMs, 0.95);
        animations.push(dot.current.animate([
          { transform: 'scale(.72)', offset: 0 },
          { transform: 'scale(1.12)', offset: peak, easing: 'ease-out' },
          { transform: 'scale(.72)', offset: rest },
          { transform: 'scale(.72)', offset: 1 },
        ], { duration: intervalMs, iterations: Infinity }));
        animations.push(wave.current.animate([
          { transform: 'scale(.65)', opacity: 0.7, offset: 0, easing: 'ease-out' },
          { transform: 'scale(1)', opacity: 0, offset: rest },
          { transform: 'scale(1)', opacity: 0, offset: 1 },
        ], { duration: intervalMs, iterations: Infinity }));
      }
    };
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      animations.forEach(animation => animation.cancel());
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [intervalMs, merged, valid]);

  return <div className="click-speed-preview" data-mode={!valid ? 'idle' : merged ? 'merged' : 'pulse'} role="img"
    aria-label={'Click speed preview: ' + label + (merged ? '. Pulses merge at this speed.' : '')}
    title={merged ? 'Pulses merge at this speed; the number shows the actual rate.' : 'Click rhythm preview'}>
    <span className="click-speed-disc" aria-hidden="true"><span className="click-speed-wave" ref={wave} /><span className="click-speed-dot" ref={dot} /></span>
    <span className="click-speed-label" aria-hidden="true"><strong>{label}</strong><small>{merged ? 'Merged pulses' : 'Preview'}</small></span>
  </div>;
}
