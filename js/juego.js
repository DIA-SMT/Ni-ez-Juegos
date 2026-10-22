// Reglas compartidas por las tres pantallas (responder, presentar, panel):
// tipos de pregunta, colores, puntaje y cómo se agrupan los resultados.

export const OTRO = 'Otro';
export const MAX_TEXTO = 500;
export const MAX_OTRO = 200;
export const MAX_PALABRA = 30;

export const TIPOS = {
  unica:    { nombre: 'Opción única',     icono: 'radio',   ayuda: 'Elegí una opción' },
  multiple: { nombre: 'Opción múltiple',  icono: 'check',   ayuda: 'Podés marcar varias opciones' },
  escala:   { nombre: 'Escala del 1 al 5', icono: 'escala', ayuda: 'Tocá un número' },
  nube:     { nombre: 'Nube de palabras', icono: 'nube',    ayuda: 'Escribí palabras cortas' },
  texto:    { nombre: 'Texto libre',      icono: 'mensaje', ayuda: '' },
};

// Acentos por quiz. Todos pasan 4.5:1 con texto blanco encima.
export const TEMAS = {
  azul:    { nombre: 'Azul',     color: '#0166FF', hover: '#0050CC', rgb: '1, 102, 255',  suave: '#EAF3FF' },
  celeste: { nombre: 'Celeste',  color: '#0077C2', hover: '#005F9C', rgb: '0, 119, 194',  suave: '#E6F4FB' },
  violeta: { nombre: 'Violeta',  color: '#6D28D9', hover: '#5B21B6', rgb: '109, 40, 217', suave: '#F1EAFE' },
  verde:   { nombre: 'Verde',    color: '#047857', hover: '#065F46', rgb: '4, 120, 87',   suave: '#E7F6F0' },
  coral:   { nombre: 'Coral',    color: '#D92D20', hover: '#B42318', rgb: '217, 45, 32',  suave: '#FDECEA' },
  tinta:   { nombre: 'Tinta',    color: '#062B6B', hover: '#041E4D', rgb: '6, 43, 107',   suave: '#E8EDF6' },
};

export function aplicarTema(nombre, el = document.documentElement) {
  const t = TEMAS[nombre] || TEMAS.azul;
  el.style.setProperty('--acento', t.color);
  el.style.setProperty('--acento-hover', t.hover);
  el.style.setProperty('--acento-rgb', t.rgb);
  el.style.setProperty('--acento-suave', t.suave);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#062B6B');
}

// Fichas del modo quiz: color + forma, para distinguirlas también sin color.
export const FICHAS = [
  { fondo: '#0166FF', sombra: '#0047B3', texto: '#FFFFFF', forma: 'triangulo' },
  { fondo: '#F4DC00', sombra: '#C2AE00', texto: '#062B6B', forma: 'rombo' },
  { fondo: '#047857', sombra: '#03553E', texto: '#FFFFFF', forma: 'circulo' },
  { fondo: '#D92D20', sombra: '#A31F15', texto: '#FFFFFF', forma: 'cuadrado' },
  { fondo: '#6D28D9', sombra: '#4C1D95', texto: '#FFFFFF', forma: 'estrella' },
  { fondo: '#0E7490', sombra: '#0A5468', texto: '#FFFFFF', forma: 'hexagono' },
];
const FORMAS = {
  triangulo: '<path d="M12 3 22.5 20.5h-21z"/>',
  rombo: '<path d="M12 1.5 22.5 12 12 22.5 1.5 12z"/>',
  circulo: '<circle cx="12" cy="12" r="10"/>',
  cuadrado: '<rect x="2.5" y="2.5" width="19" height="19" rx="2.5"/>',
  estrella: '<path d="m12 1.8 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z"/>',
  hexagono: '<path d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z"/>',
};
export const ficha = (i) => FICHAS[i % FICHAS.length];
export const forma = (i) => `<svg class="forma" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FORMAS[ficha(i).forma]}</svg>`;

export const ESCALA = ['😟', '🙁', '😐', '🙂', '😄'];

/* ── Puntaje ──
   100 por acierto y +25 por cada acierto seguido (racha). La base de datos
   recalcula lo mismo al guardar (privado.puntuar): el ranking no se puede
   inflar desde el navegador. */
export function evaluable(p) {
  return (p.tipo === 'unica' && !!p.correcta) || (p.tipo === 'multiple' && Array.isArray(p.correctas) && p.correctas.length > 0);
}
export function esCorrecta(p, v) {
  if (p.tipo === 'unica') return typeof v === 'string' && v === p.correcta;
  if (p.tipo === 'multiple') {
    if (!Array.isArray(v)) return false;
    const a = new Set(v), b = new Set(p.correctas);
    return a.size === b.size && [...b].every((x) => a.has(x));
  }
  return false;
}
export const puntosPorAcierto = (racha) => 100 + 25 * (racha - 1);
export function puntuar(def, datos) {
  let puntaje = 0, aciertos = 0, evaluables = 0, racha = 0;
  if (def.modo !== 'quiz') return { puntaje, aciertos, evaluables };
  for (const p of def.preguntas) {
    if (!evaluable(p)) continue;
    evaluables++;
    if (esCorrecta(p, datos[p.id])) { racha++; aciertos++; puntaje += puntosPorAcierto(racha); }
    else racha = 0;
  }
  return { puntaje, aciertos, evaluables };
}

// Modo guiado: el puntaje que ya se puede mostrar (solo de las preguntas
// cuya correcta reveló el presentador) y cuánto sumó cada una.
export function puntosRevelados(def, datos, reveladas = []) {
  let puntaje = 0, racha = 0;
  const ganancia = {};
  for (const p of def.preguntas) {
    if (!evaluable(p) || !reveladas.includes(p.id)) continue;
    if (esCorrecta(p, datos[p.id])) { racha++; ganancia[p.id] = { pts: puntosPorAcierto(racha), racha }; puntaje += ganancia[p.id].pts; }
    else { racha = 0; ganancia[p.id] = { pts: 0, racha: 0 }; }
  }
  return { puntaje, racha, ganancia };
}

export function respondida(p, v) {
  if (p.tipo === 'texto') return typeof v === 'string' && v.trim() !== '';
  if (p.tipo === 'multiple' || p.tipo === 'nube') return Array.isArray(v) && v.length > 0;
  if (p.tipo === 'escala') return Number.isInteger(v) && v >= 1 && v <= 5;
  return typeof v === 'string' && v !== '';
}

/* ── Apodos ── fauna argentina + un adjetivo que no cambia con el género */
const ANIMALES = [
  ['Yaguareté', '🐆'], ['Cóndor', '🦅'], ['Tucán', '🦜'], ['Hornero', '🐦'], ['Guanaco', '🦙'],
  ['Puma', '🐈'], ['Carpincho', '🦫'], ['Zorro', '🦊'], ['Lechuza', '🦉'], ['Tortuga', '🐢'],
  ['Mariposa', '🦋'], ['Pingüino', '🐧'], ['Ballena', '🐋'], ['Rana', '🐸'], ['Abeja', '🐝'], ['Tonina', '🐬'],
];
const ADJETIVOS = ['Veloz', 'Feliz', 'Audaz', 'Genial', 'Brillante', 'Valiente', 'Inteligente', 'Alegre',
  'Imparable', 'Increíble', 'Sonriente', 'Paciente', 'Amable', 'Elegante', 'Gigante', 'Constante'];
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
export function apodoAlAzar() {
  return `${azar(ANIMALES)[0]} ${azar(ADJETIVOS)}`;
}
export function emojiDe(alias = '') {
  const a = ANIMALES.find(([n]) => alias.startsWith(n));
  if (a) return a[1];
  let h = 0;
  for (const c of alias) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return ANIMALES[h % ANIMALES.length][1];
}

// 300 chicos eligiendo apodo para una pantalla gigante: lo que tenga una
// mala palabra se muestra como un animal al azar (siempre el mismo).
// En cualquier parte del texto (no aparecen dentro de palabras inocentes):
const PROHIBIDAS = ['pija', 'verga', 'mierda', 'pelotud', 'sorete', 'garch', 'trolo', 'mogolic', 'hdp', 'concha', 'nazi', 'vagina'];
// Solo al comienzo de una palabra ("puta" sí, "computadora" no):
const PROHIBIDAS_INICIO = ['puto', 'puta', 'choto', 'chota', 'culo', 'forro', 'coger', 'cogi', 'teta', 'orto', 'cagar', 'mamad'];
export function aliasSeguro(alias) {
  const a = String(alias || '').trim();
  if (!a) return 'Anónimo';
  const limpio = normalizarPalabra(a).replace(/[^a-z ]/g, '');
  const malo = PROHIBIDAS.some((w) => limpio.replace(/ /g, '').includes(w))
    || limpio.split(' ').some((p) => PROHIBIDAS_INICIO.some((w) => p.startsWith(w)));
  if (!malo) return a;
  let h = 0;
  for (const c of a) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `${ANIMALES[h % ANIMALES.length][0]} ${ADJETIVOS[(h >>> 8) % ADJETIVOS.length]}`;
}

export const nuevoId = () => 'p' + Math.random().toString(36).slice(2, 8);

export function normalizarPalabra(s) {
  return String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

/* ── Resultados ──
   filas: [{ id, t, alias, puntaje, d }] (d = respuestas de una persona).
   Lo que viene de la base lo escribió cualquiera: se valida el tipo de
   cada valor y nunca se inserta sin escapar. */
export function agregar(p, filas) {
  const valores = [];
  for (const f of filas) {
    const v = f.d?.[p.id];
    if (respondida(p, v)) valores.push({ f, v });
  }
  const total = valores.length;

  if (p.tipo === 'texto') {
    return { total, textos: valores.filter(({ v }) => typeof v === 'string').map(({ f, v }) => ({ id: f.id, texto: v.trim() })) };
  }
  if (p.tipo === 'escala') {
    const cuentas = [0, 0, 0, 0, 0];
    let suma = 0;
    for (const { v } of valores) { cuentas[v - 1]++; suma += v; }
    return { total, promedio: total ? suma / total : 0, opciones: cuentas.map((n, i) => ({ o: String(i + 1), n, pct: total ? n / total : 0 })) };
  }
  if (p.tipo === 'nube') {
    const grupos = new Map();
    for (const { f, v } of valores) {
      for (const w of v) {
        if (typeof w !== 'string' || !w.trim()) continue;
        const k = normalizarPalabra(w);
        const g = grupos.get(k) || { k, texto: w.trim(), n: 0, ids: [] };
        g.n++; g.ids.push(f.id);
        grupos.set(k, g);
      }
    }
    return { total, palabras: [...grupos.values()].sort((a, b) => b.n - a.n || a.k.localeCompare(b.k)) };
  }
  // unica / multiple
  const opciones = [...(p.opciones || []), ...(p.otro ? [OTRO] : [])];
  const cuentas = new Map(opciones.map((o) => [o, 0]));
  for (const { v } of valores) {
    for (const o of Array.isArray(v) ? v : [v]) if (cuentas.has(o)) cuentas.set(o, cuentas.get(o) + 1);
  }
  const eligioOtro = (v) => (Array.isArray(v) ? v.includes(OTRO) : v === OTRO);
  const otros = p.otro
    ? valores.filter(({ v }) => eligioOtro(v)).map(({ f }) => ({ id: f.id, texto: f.d[p.id + '_otro'] }))
      .filter((x) => typeof x.texto === 'string' && x.texto.trim())
    : [];
  return { total, opciones: opciones.map((o) => ({ o, n: cuentas.get(o), pct: total ? cuentas.get(o) / total : 0 })), otros };
}

/* ── Exportar ── CSV con ; y BOM: Excel en castellano lo abre directo. */
export function aCsv(def, filas) {
  const cols = [['id', 'N°'], ['t', 'Fecha']];
  if (def.modo === 'quiz') cols.push(['alias', 'Apodo'], ['puntaje', 'Puntaje']);
  def.preguntas.forEach((p, i) => {
    cols.push([p.id, `${i + 1}. ${p.texto}`]);
    if (p.otro) cols.push([p.id + '_otro', `${i + 1}. Otro (cuál)`]);
  });
  const celda = (v) => {
    let s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;               // que Excel no lo tome como fórmula
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const filasCsv = filas.map((f) => cols.map(([k]) => {
    if (k === 'id') return celda(f.id);
    if (k === 't') return celda(f.t ? new Date(f.t).toLocaleString('es-AR') : '');
    if (k === 'alias') return celda(f.alias);
    if (k === 'puntaje') return celda(f.puntaje);
    return celda(f.d?.[k]);
  }).join(';'));
  return '﻿' + [cols.map(([, t]) => celda(t)).join(';'), ...filasCsv].join('\r\n');
}
