// Herramientas chicas que usan todas las pantallas.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// localStorage/sessionStorage pueden no existir (modo privado, datos
// bloqueados): todo pasa por acá y nada se rompe si fallan.
export const almacen = {
  leer(k, sesion = false) {
    try { const v = (sesion ? sessionStorage : localStorage).getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; }
  },
  guardar(k, v, sesion = false) {
    try { (sesion ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  },
  borrar(k, sesion = false) {
    try { (sesion ? sessionStorage : localStorage).removeItem(k); } catch { /* sin almacenamiento */ }
  },
};

export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--visible'), 2600);
}

export function descargar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

export const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Papel picado con los colores del isologo. Sin librerías: un canvas que
// se borra solo a los 3 segundos.
export function confeti({ cantidad = 140, duracion = 3000 } = {}) {
  if (reducirMovimiento()) return;
  const c = document.createElement('canvas');
  c.className = 'confeti';
  c.setAttribute('aria-hidden', 'true');
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ajustar = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
  ajustar();
  const colores = ['#0166FF', '#2DB0FF', '#F4DC00', '#062B6B', '#10B981', '#FFFFFF'];
  const piezas = Array.from({ length: cantidad }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 6,
    g: 0.32 + Math.random() * 0.12,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    color: colores[Math.floor(Math.random() * colores.length)],
  }));
  const inicio = performance.now();
  function cuadro(t) {
    const pasado = t - inicio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, pasado - duracion * 0.6) / (duracion * 0.4));
    for (const p of piezas) {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (pasado < duracion) requestAnimationFrame(cuadro);
    else c.remove();
  }
  requestAnimationFrame(cuadro);
}

// Cuenta de 0 a n con un poco de suspenso (para el puntaje final).
export function contar(el, hasta, ms = 1200) {
  if (reducirMovimiento()) { el.textContent = hasta.toLocaleString('es-AR'); return; }
  const t0 = performance.now();
  const paso = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(hasta * (1 - Math.pow(1 - k, 3))).toLocaleString('es-AR');
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
