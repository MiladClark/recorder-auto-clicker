// React adaptation of ebnsina's Sina UI Visualizer, selected via 21st.dev.
// Copyright (c) 2026 ebnsina. MIT license: licenses/sinaui-MIT.txt.
import { useEffect, useRef } from 'react';

export function AudioVisualizer({ analyser, active, variant }: { analyser: AnalyserNode | null; active: boolean; variant: 'wave' | 'bars' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const bars = 48;
    const freq = new Uint8Array(analyser?.frequencyBinCount || 0);
    const wave = new Uint8Array(analyser?.fftSize || 0);
    const levels = new Float32Array(bars);
    let frame = 0, last = 0, visible = true;
    let color = getComputedStyle(canvas).color;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      g.clearRect(0, 0, w, h); g.fillStyle = g.strokeStyle = color;
      if (variant === 'wave') {
        g.lineWidth = 1.5 * devicePixelRatio; g.lineJoin = g.lineCap = 'round'; g.beginPath();
        const n = active && analyser ? wave.length : 2;
        for (let i = 0; i < n; i++) {
          const value = active && analyser ? (wave[i] - 128) / 128 : 0;
          const x = i / (n - 1) * w, y = h / 2 - value * (h / 2 - g.lineWidth);
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke(); return;
      }
      const gap = Math.max(2 * devicePixelRatio, w / bars * .3), bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        const height = Math.max(bw, levels[i] * h * .96);
        g.globalAlpha = .3 + .7 * Math.min(1, levels[i] * 3);
        g.beginPath(); g.roundRect(i * (bw + gap), (h - height) / 2, bw, height, bw / 2); g.fill();
      }
      g.globalAlpha = 1;
    };
    const measure = () => {
      if (!analyser || !active) { levels.fill(0); return; }
      if (variant === 'wave') analyser.getByteTimeDomainData(wave);
      else {
        analyser.getByteFrequencyData(freq);
        const usable = Math.floor(freq.length * .7);
        for (let i = 0; i < bars; i++) {
          const from = Math.floor(usable * (i / bars) ** 1.6);
          const to = Math.max(from + 1, Math.floor(usable * ((i + 1) / bars) ** 1.6));
          let sum = 0; for (let j = from; j < to; j++) sum += freq[j];
          levels[i] = sum / (to - from) / 255;
        }
      }
    };
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      if (now - last >= (reduced.matches ? 125 : 1000 / 30)) { measure(); draw(); last = now; }
      if (active) frame = requestAnimationFrame(tick);
    };
    const kick = () => { if (!frame && visible && !document.hidden) { measure(); draw(); if (active) frame = requestAnimationFrame(tick); } };
    const resize = () => { canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio); draw(); };
    const resized = new ResizeObserver(resize); resized.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) { cancelAnimationFrame(frame); frame = 0; } else kick(); }); seen.observe(canvas);
    const themes = new MutationObserver(() => { color = getComputedStyle(canvas).color; kick(); });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tool', 'class'] });
    document.addEventListener('visibilitychange', kick);
    resize(); kick();
    return () => { cancelAnimationFrame(frame); resized.disconnect(); seen.disconnect(); themes.disconnect(); document.removeEventListener('visibilitychange', kick); };
  }, [analyser, active, variant]);
  return <canvas ref={ref} className="audio-visualizer" role="img" aria-label={active ? `Live microphone ${variant === 'wave' ? 'waveform' : 'frequency bars'}` : 'Microphone visualizer at rest'} data-variant={variant} data-active={active} />;
}
