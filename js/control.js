// Botonera del presentador (/control/<codigo>), para el celular. Copia la
// idea de la botonera de la presentación del CIMT: botones grandes que no se
// mueven, ACCIÓN en amarillo cuando toca, SIGUIENTE gigante y un borde verde
// o rojo para saber si la pantalla recibió el toque. Escribe el estado en
// vivo (panel_en_vivo); la pantalla y los celulares lo siguen.
import { api, MODO_LOCAL, clave as claveEquipo } from './api.js';
import { TIPOS, aplicarTema, evaluable, esCorrecta, agregar } from './juego.js';
import { icono } from './iconos.js';
import { esc, toast } from './util.js';

const app = document.getElementById('app');
const codigo = (new URLSearchParams(location.search).get('c') || location.pathname.split('/').filter(Boolean)[1] || '').toLowerCase();

let clave = MODO_LOCAL ? 'local' : claveEquipo.leer();
let def = null;
let esQuiz = false;
let filas = [];
let ultimo = 0;
let vivo = {};
let conexion = 'ok';
let pendientes = 0;
let timer = null;
let marca = null;          // { accion, clase } borde de confirmación del último toque

const n = () => def.preguntas.length;
const slideActual = () => Math.max(0, Math.min(n() + 1, Number(vivo.slide) || 0));
const preguntaDe = (k) => (k >= 1 && k <= n() ? def.preguntas[k - 1] : null);
const conAbiertas = (p) => p && (p.tipo === 'texto' || p.tipo === 'nube' || p.otro);

if (MODO_LOCAL) document.body.insertAdjacentHTML('beforeend', '<p class="aviso-local">MODO LOCAL</p>');
if (!codigo) mensaje('Falta el código', 'Abrí la botonera desde la pantalla de presentar (tecla B).');
else if (!clave) pedirClave();
else cargar();

function mensaje(titulo, texto) {
  app.innerHTML = `<div class="mensaje marca"><div class="mensaje-caja"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></div></div>`;
}

function pedirClave(error = '') {
  app.innerHTML = `<div class="mensaje marca"><form class="clave-tarjeta" id="form-clave">
    <img src="/img/isologo.png" width="56" height="56" alt="">
    <h1>Botonera</h1>
    <p>Para manejar <b>${esc(codigo)}</b> desde este celular, ingresá la clave del equipo.</p>
    <label class="etiqueta" for="clave">Clave del equipo</label>
    <input id="clave" class="campo" type="password" autocomplete="current-password" required>
    ${error ? `<p class="clave-error" role="alert">${esc(error)}</p>` : ''}
    <button class="boton boton--primario">Entrar ${icono('flecha-der')}</button>
  </form></div>`;
  document.getElementById('clave').focus();
}

async function cargar() {
  try {
    const r = await api.resultados(clave, codigo, 0);
    recibir(r, true);
    vivo = r.en_vivo || {};
    if (!MODO_LOCAL) claveEquipo.guardar(clave);
    render();
    programar();
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); pedirClave(clave ? 'La clave no es correcta.' : ''); }
    else if (e.codigo === 'no-existe') mensaje('No existe ese quiz', `No hay ningún quiz con el código «${codigo}».`);
    else mensaje('Sin conexión', 'Revisá internet y recargá la página.');
  }
}

function recibir(r, completo) {
  def = r.quiz.def;
  esQuiz = def.modo === 'quiz';
  aplicarTema(def.tema);
  document.title = `Botonera · ${def.titulo}`;
  const llegadas = (r.filas || []).filter((x) => x && Number.isFinite(x.id) && x.d && typeof x.d === 'object');
  if (completo) filas = llegadas;
  else if (llegadas.length) {
    const porId = new Map(filas.map((x) => [x.id, x]));
    llegadas.forEach((x) => porId.set(x.id, x));
    filas = [...porId.values()];
  }
  ultimo = filas.reduce((m, x) => Math.max(m, Number(x.c) || 0), 0);
}

function programar() {
  clearTimeout(timer);
  timer = setTimeout(ciclo, document.hidden ? 10000 : 1500);
}

async function ciclo() {
  try {
    let r = await api.resultados(clave, codigo, ultimo);
    recibir(r, false);
    if (typeof r.total === 'number' && r.total !== filas.length) { r = await api.resultados(clave, codigo, 0); recibir(r, true); }
    if (pendientes === 0 && (r.en_vivo?.rev || 0) > (vivo.rev || 0)) vivo = r.en_vivo;
    conexion = 'ok';
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); clearTimeout(timer); return pedirClave('La clave dejó de ser válida.'); }
    conexion = 'error';
  }
  render();
  programar();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && def) ciclo(); });

/* ── Mandar un cambio a la pantalla ── */
async function mandar(cambios, accion) {
  const ver = new Set(cambios.ver ?? vivo.ver ?? []);
  const correctas = new Set(cambios.correctas ?? vivo.correctas ?? []);
  const slide = cambios.slide ?? slideActual();
  const p = preguntaDe(slide);
  const estado = { slide, activa: p?.id || null, cerrada: !!p && correctas.has(p.id), ver: [...ver], correctas: [...correctas], fin: slide === n() + 1 };
  vivo = { ...estado, rev: vivo.rev };               // se ve al toque; la base confirma
  marca = { accion, clase: 'enviando' };
  navigator.vibrate?.(15);
  render();
  pendientes++;
  try {
    vivo = await api.enVivo(clave, codigo, estado);
    marca = { accion, clase: 'llego' };
  } catch (e) {
    marca = { accion, clase: 'fallo' };
    if (e.codigo === 'clave') { claveEquipo.olvidar(); return pedirClave('La clave dejó de ser válida.'); }
    toast('No llegó a la pantalla. Probá de nuevo.');
  } finally {
    pendientes--;
  }
  render();
  setTimeout(() => { if (marca?.accion === accion) { marca = null; render(); } }, 1200);
}

function alternar(lista, id) {
  const s = new Set(lista || []);
  if (s.has(id)) s.delete(id); else s.add(id);
  return [...s];
}

function accion() {
  const k = slideActual();
  const p = preguntaDe(k);
  if (k === 0) return mandar({ slide: 1 }, 'accion');
  if (!p) return;
  if (esQuiz && evaluable(p)) return mandar({ correctas: alternar(vivo.correctas, p.id) }, 'accion');
  if (conAbiertas(p)) return mandar({ ver: alternar(vivo.ver, p.id) }, 'accion');
}

/* ── Pantalla ── */
function datosAccion(k, p) {
  if (k === 0) return { texto: 'EMPEZAR', sub: 'Activa la pregunta 1 en los celulares', clase: 'toca' };
  if (!p) return { texto: esQuiz ? 'PODIO' : 'FIN', sub: esQuiz ? 'El podio está en pantalla' : 'Pantalla de cierre', clase: 'nada' };
  if (esQuiz && evaluable(p)) {
    const ya = (vivo.correctas || []).includes(p.id);
    return ya ? { texto: 'OCULTAR CORRECTA', sub: 'Ya está a la vista', clase: '' }
      : { texto: 'MOSTRAR CORRECTA', sub: 'Cierra la pregunta y avisa a cada uno si acertó', clase: 'toca' };
  }
  if (conAbiertas(p)) {
    const ya = (vivo.ver || []).includes(p.id);
    return ya ? { texto: 'OCULTAR RESPUESTAS', sub: 'Tapar lo que escribieron', clase: '' }
      : { texto: 'MOSTRAR RESPUESTAS', sub: 'Lo que escribieron, en pantalla (revisalo antes)', clase: 'toca' };
  }
  return { texto: 'EN VIVO', sub: 'Los resultados se ven solos en la pantalla', clase: 'nada' };
}

function estadistica(k, p) {
  const total = filas.length;
  if (k === 0) return `<b>${total}</b> ${total === 1 ? 'persona' : 'personas'} en la sala`;
  if (!p) return `<b>${total}</b> ${total === 1 ? 'participó' : 'participaron'}`;
  const a = agregar(p, filas);
  let extra = '';
  if (esQuiz && evaluable(p) && (vivo.correctas || []).includes(p.id)) {
    const bien = filas.filter((f) => esCorrecta(p, f.d?.[p.id])).length;
    extra = ` · <b class="bot-bien">${bien}</b> ${bien === 1 ? 'acertó' : 'acertaron'}`;
  }
  return `<b>${a.total}</b> de ${total} ${a.total === 1 ? 'respondió' : 'respondieron'}${extra}`;
}

function render() {
  if (!def) return;
  const k = slideActual();
  const p = preguntaDe(k);
  const ac = datosAccion(k, p);
  const sig = preguntaDe(k + 1);
  const sigSub = k >= n() + 1 ? 'Ya es el final' : sig ? `Pregunta ${k + 1}: ${sig.texto}` : (esQuiz ? 'Mostrar el podio' : 'Cerrar con el agradecimiento');
  const cls = (id) => (marca?.accion === id ? ` ${marca.clase}` : '');
  const chips = [`<button class="chip-s${k === 0 ? ' actual' : ''}" data-ir="0" aria-label="QR">${icono('qr')}</button>`]
    .concat(def.preguntas.map((q, i) => `<button class="chip-s${k === i + 1 ? ' actual' : i + 1 < k ? ' hecha' : ''}" data-ir="${i + 1}">${i + 1}</button>`))
    .concat(`<button class="chip-s${k === n() + 1 ? ' actual' : ''}" data-ir="${n() + 1}" aria-label="${esQuiz ? 'Podio' : 'Cierre'}">${icono(esQuiz ? 'trofeo' : 'check')}</button>`);
  const titulo = k === 0 ? 'Inicio · QR en pantalla' : p ? `Pregunta ${k} · ${TIPOS[p.tipo]?.nombre || ''}` : (esQuiz ? 'Podio' : 'Cierre');
  app.innerHTML = `<div class="bot">
    <div class="bot-estado">
      <span class="bot-punto${conexion === 'ok' ? ' ok' : ''}" title="${conexion === 'ok' ? 'Conectado' : 'Sin conexión'}"></span>
      <span class="bot-titulo">${esc(def.titulo)}</span>
      <b class="bot-num">${def.ritmo === 'guiado' ? '<span class="bot-guiado">GUIADO</span>' : ''}${k}/${n()}</b>
    </div>
    <div class="bot-tarjeta">
      <p class="bot-tipo">${esc(titulo)}</p>
      <p class="bot-texto">${p ? esc(p.texto) : k === 0 ? 'Que escaneen el QR de la pantalla.' : '¡Listo!'}</p>
      <p class="bot-stats">${estadistica(k, p)}</p>
    </div>
    <button class="bot-accion ${ac.clase}${cls('accion')}" data-accion="accion"${ac.clase === 'nada' ? ' aria-disabled="true"' : ''}>${ac.texto}<small>${esc(ac.sub)}</small></button>
    <button class="bot-siguiente${cls('siguiente')}" data-accion="siguiente"${k >= n() + 1 ? ' disabled' : ''}>SIGUIENTE ▶<small>${esc(sigSub)}</small></button>
    <div class="bot-fila">
      <button class="bot-gris${cls('anterior')}" data-accion="anterior"${k === 0 ? ' disabled' : ''}>◀ Anterior</button>
      <button class="bot-gris${cls('qr')}" data-accion="qr">${icono('qr')} QR</button>
    </div>
    <div class="bot-chips">${chips.join('')}</div>
  </div>`;
}

/* ── Toques ── */
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'form-clave') return;
  e.preventDefault();
  clave = document.getElementById('clave').value.trim();
  if (clave) cargar();
});

let wakeLock = null;
app.addEventListener('click', async (e) => {
  // Que la pantalla del celular no se apague en medio de la charla.
  if (!wakeLock && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* no disponible */ } }
  const ir = e.target.closest('[data-ir]');
  if (ir) return mandar({ slide: Number(ir.dataset.ir) }, 'chip');
  const b = e.target.closest('[data-accion]');
  if (!b || b.disabled) return;
  const a = b.dataset.accion;
  const k = slideActual();
  if (a === 'accion') accion();
  else if (a === 'siguiente') mandar({ slide: Math.min(n() + 1, k + 1) }, 'siguiente');
  else if (a === 'anterior') mandar({ slide: Math.max(0, k - 1) }, 'anterior');
  else if (a === 'qr') mandar({ slide: 0 }, 'qr');
});
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && wakeLock?.released) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* no disponible */ } }
});

