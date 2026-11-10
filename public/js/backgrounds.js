// Backgrounds pré-definidos (desenhados no canvas, sem arquivos externos)
const PRESETS = [
  { id: 'aurora', name: 'Aurora', stops: ['#7c3aed', '#db2777', '#f59e0b'], angle: 160, glow: true },
  { id: 'oceano', name: 'Oceano', stops: ['#0ea5e9', '#2563eb', '#1e1b4b'], angle: 170, glow: true },
  { id: 'por-do-sol', name: 'Pôr do sol', stops: ['#fde68a', '#fb7185', '#7c2d12'], angle: 180, glow: true },
  { id: 'menta', name: 'Menta', stops: ['#d1fae5', '#5eead4', '#0f766e'], angle: 165, glow: true },
  { id: 'grafite', name: 'Grafite', stops: ['#3f3f46', '#18181b', '#09090b'], angle: 170, glow: true },
  { id: 'clean', name: 'Clean', stops: ['#ffffff', '#f4f4f5', '#e4e4e7'], angle: 180, glow: false },
  { id: 'black-friday', name: 'Oferta', stops: ['#111827', '#7f1d1d', '#dc2626'], angle: 200, glow: true },
];
const DEFAULT_PRESET = 'aurora';

function drawPreset(ctx, preset, W, H) {
  const a = (preset.angle * Math.PI) / 180;
  const cx = W / 2, cy = H / 2, r = Math.hypot(W, H) / 2;
  const g = ctx.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
  preset.stops.forEach((c, i) => g.addColorStop(i / (preset.stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (preset.glow) {
    // Manchas de luz suaves para dar profundidade (efeito glass)
    const spots = [[0.15, 0.12, 0.55], [0.9, 0.45, 0.45], [0.25, 0.88, 0.5]];
    for (const [x, y, s] of spots) {
      const rg = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, W * s);
      rg.addColorStop(0, 'rgba(255,255,255,0.28)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

function presetThumb(preset) {
  const c = document.createElement('canvas');
  c.width = 90; c.height = 160;
  drawPreset(c.getContext('2d'), preset, 90, 160);
  return c.toDataURL();
}
