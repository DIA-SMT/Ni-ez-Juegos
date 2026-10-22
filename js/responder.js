// Pantalla del participante: se abre desde el QR (/<codigo>), una pregunta
// por pantalla, pensada para el celular. En modo quiz suma puntos, rachas y
// muestra si acertó; en modo encuesta es tranquila y anónima.
// Ritmo libre: cada uno avanza solo. Ritmo guiado: el celular muestra la
// pregunta que activa el presentador (ver "Modo guiado", al final).
import { api, MODO_LOCAL, ErrorApi, uuid } from './api.js';
import {
  OTRO, MAX_TEXTO, MAX_OTRO, MAX_PALABRA, TIPOS, ESCALA, aplicarTema, ficha, forma,
  evaluable, esCorrecta, puntosPorAcierto, respondida, apodoAlAzar, emojiDe, normalizarPalabra, aliasSeguro, puntosRevelados,
} from './juego.js';
import { icono } from './iconos.js';
import { esc, almacen, confeti, contar, plural, toast } from './util.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const codigo = (params.get('c') || location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
const PRUEBA = params.has('prueba');
const K_BORRADOR = `resp:${codigo}:borrador`;
const K_HECHO = `resp:${codigo}:hecho`;

let quiz = null;
let def = null;
let esQuiz = false;
let est = estadoInicial();
let resultado = null;   // lo que devuelve la base al guardar
let ranking = null;
let enviando = false;
let errorPie = '';
let avance = null;

function estadoInicial() {
  return { pantalla: 'intro', i: 0, r: {}, alias: '', puntos: 0, racha: 0, bloqueadas: {} };
}

/* ── Arranque ── */
if (MODO_LOCAL) document.body.insertAdjacentHTML('beforeend', '<p class="aviso-local">MODO LOCAL</p>');
arrancar();

async function arrancar() {
  try {
    quiz = await conReintento(() => api.quiz(codigo));
  } catch {
    return mensaje('No pudimos cargar el quiz', 'Revisá tu conexión e intentá de nuevo.', '<button class="boton boton--amarillo" data-accion="recargar">Reintentar</button>');
  }
  if (!quiz) return mensaje('No encontramos ese código', `Revisá que esté bien escrito: «${codigo}».`, '<a class="boton boton--amarillo" href="/">Ingresar otro código</a>');
  def = quiz.def;
  esQuiz = def.modo === 'quiz';
  aplicarTema(def.tema);
  document.title = `${def.titulo} · San Miguel de Tucumán`;
  if (!quiz.abierto && !PRUEBA) return mensaje('Este quiz está cerrado', 'Ya no recibe respuestas. ¡Gracias por tu interés!');
  if (def.ritmo === 'guiado' && !PRUEBA) return arrancarGuiado();

  const hecho = almacen.leer(K_HECHO);
  if (hecho?.quizId === quiz.id && !PRUEBA && !params.has('otra')) {
    est = { ...estadoInicial(), pantalla: 'final', alias: hecho.alias || '' };
    resultado = hecho.resultado;
    render();
    if (esQuiz) cargarRanking();
    return;
  }
  const borrador = almacen.leer(K_BORRADOR, true);
  if (borrador?.quizId === quiz.id && !PRUEBA) est = { ...estadoInicial(), ...borrador.est };
  if (esQuiz && !est.alias) est.alias = apodoAlAzar();
  render();
}

function guardarBorrador() {
  if (est.pantalla === 'final' || PRUEBA) return;
  almacen.guardar(K_BORRADOR, { quizId: quiz.id, est }, true);
}

/* ── Vistas ── */
function mensaje(titulo, texto, extra = '') {
  app.innerHTML = `<div class="mensaje marca"><div class="mensaje-caja">
    <img class="logo-ciudad" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
    <h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${extra}</div></div>`;
}

const LOGO = '<img class="logo-ciudad" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">';
const preguntas = () => def.preguntas;
const actual = () => (est.pantalla === 'sala' ? preguntaActiva() : preguntas()[est.i]);

function render() {
  clearTimeout(avance);
  errorPie = '';
  if (est.pantalla === 'intro') app.innerHTML = vistaIntro();
  else if (est.pantalla === 'pregunta') app.innerHTML = vistaPregunta();
  else if (est.pantalla === 'sala') return renderSala(true);
  else app.innerHTML = vistaFinal();
  if (PRUEBA) app.insertAdjacentHTML('afterbegin', '<p class="aviso-prueba">Vista previa · las respuestas no se guardan</p>');
  window.scrollTo(0, 0);
  if (est.pantalla === 'pregunta') {
    actualizarPie();
    document.getElementById('pt')?.focus({ preventScroll: true });
  }
  guardarBorrador();
}

function datosIntro() {
  const n = preguntas().length;
  return [
    esQuiz ? [icono('trofeo'), 'Sumá puntos'] : [icono('candado'), 'Anónima'],
    [icono('lista'), plural(n, 'pregunta', 'preguntas')],
    def.ritmo === 'guiado' ? [icono('rayo'), 'En vivo'] : [icono('reloj'), `${Math.max(1, Math.round(n * 0.3))} min`],
  ].map(([i, t]) => `<li>${i}${esc(t)}</li>`).join('');
}

function cajaAyuda() {
  const a = def.ayuda;
  if (!a?.texto && !a?.lineas?.length) return '';
  const lineas = (a.lineas || []).filter((l) => l.numero).map((l) =>
    `<li><a href="tel:${esc(l.numero.replace(/[^\d+]/g, ''))}">${icono('telefono')}<b>${esc(l.numero)}</b><span>${esc(l.detalle || '')}</span></a></li>`).join('');
  return `<aside class="ayuda" aria-label="Ayuda inmediata">
    <p class="ayuda-titulo">${icono('telefono')} ¿Necesitás ayuda ahora?</p>
    ${a.texto ? `<p>${esc(a.texto)}</p>` : ''}
    ${lineas ? `<ul class="ayuda-lineas">${lineas}</ul>` : ''}
  </aside>`;
}

function lineaAyuda() {
  const ls = (def.ayuda?.lineas || []).filter((l) => l.numero);
  if (!ls.length) return '';
  return `<p class="ayuda-linea">${icono('telefono')} ¿Necesitás ayuda ahora? ${ls.map((l) =>
    `<a href="tel:${esc(l.numero.replace(/[^\d+]/g, ''))}">${esc(l.numero)}</a>`).join(' · ')}</p>`;
}

function vistaIntro() {
  const n = preguntas().length;
  const apodo = esQuiz ? `
    <div class="apodo">
      <span class="apodo-avatar" id="apodo-avatar" aria-hidden="true">${emojiDe(est.alias)}</span>
      <div class="apodo-campo">
        <label class="etiqueta" for="apodo">Tu apodo para el ranking</label>
        <input id="apodo" class="campo" maxlength="24" autocomplete="off" autocapitalize="words" value="${esc(est.alias)}">
      </div>
      <button type="button" class="boton boton--icono" data-accion="dado" aria-label="Otro apodo al azar">${icono('dado')}</button>
    </div>
    <p class="apodo-nota">Mejor un apodo que tu nombre real: el ranking se ve en pantalla.</p>` : '';
  return `
    <header class="resp-hero marca">
      <div class="resp-ancho">
        ${LOGO}
        <p class="chip-marca">${esc(def.etiqueta || (esQuiz ? 'Quiz' : 'Encuesta'))}</p>
        <h1 class="resp-titulo">${esc(def.titulo)}</h1>
        ${def.subtitulo ? `<p class="resp-subtitulo">${esc(def.subtitulo)}</p>` : ''}
        <ul class="resp-datos">${datosIntro()}</ul>
      </div>
    </header>
    <section class="resp-cuerpo resp-ancho">
      ${def.intro ? `<p class="resp-intro">${esc(def.intro)}</p>` : ''}
      ${apodo}
      ${cajaAyuda()}
    </section>
    <footer class="resp-pie"><div class="resp-ancho resp-pie-fila">
      <button type="button" class="boton boton--primario boton--ancho boton--grande" data-accion="empezar"${n ? '' : ' disabled'}>
        ${n ? (def.ritmo === 'guiado' && !PRUEBA ? '¡Entrar!' : esQuiz ? '¡A jugar!' : 'Empezar') : 'Todavía no tiene preguntas'} ${n ? icono('flecha-der') : ''}
      </button>
    </div></footer>`;
}

function vistaPregunta() {
  const p = actual();
  const n = preguntas().length;
  const seg = preguntas().map((_, k) => `<span class="seg${k < est.i ? ' seg--hecho' : k === est.i ? ' seg--actual' : ''}"></span>`).join('');
  const hud = esQuiz ? `<span class="hud">
      <span class="hud-racha${est.racha >= 2 ? '' : ' hud-racha--oculta'}" id="hud-racha">🔥 ${est.racha}</span>
      <span class="hud-puntos" id="hud-puntos">⭐ ${est.puntos.toLocaleString('es-AR')}</span>
    </span>` : '';
  const vale = esQuiz && evaluable(p) ? `<span class="vale">${icono('rayo')} Vale puntos</span>` : '';
  return `
    <header class="resp-top marca">
      <div class="resp-ancho resp-top-fila">
        <img class="logo-ciudad logo-ciudad--chico" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
        <span class="resp-paso">${est.i + 1} / ${n}</span>
        ${hud}
      </div>
      <div class="resp-ancho"><div class="segmentos" role="progressbar" aria-label="Progreso" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${est.i + 1}">${seg}</div></div>
    </header>
    <section class="resp-cuerpo resp-ancho">
      <div class="pregunta" role="group" aria-labelledby="pt">
        <p class="pregunta-num">Pregunta ${est.i + 1} ${vale}</p>
        <h2 id="pt" class="pregunta-texto" tabindex="-1">${esc(p.texto)}</h2>
        ${ayudaDeTipo(p)}
        ${campo(p)}
      </div>
      ${lineaAyuda()}
    </section>
    <footer class="resp-pie"><div class="resp-ancho" id="pie"></div></footer>`;
}

function ayudaDeTipo(p) {
  let t = TIPOS[p.tipo]?.ayuda || '';
  if (p.tipo === 'nube') t = `Escribí hasta ${p.max || 3} palabras cortas`;
  if (p.tipo === 'texto') t = p.nota || '';
  return t ? `<p class="pregunta-ayuda">${esc(t)}</p>` : '';
}

function campo(p) {
  const v = est.r[p.id];
  const bloq = est.bloqueadas[p.id];
  if (p.tipo === 'texto') {
    return `<label class="sr-only" for="campo-texto">Tu respuesta</label>
      <textarea id="campo-texto" class="campo" maxlength="${MAX_TEXTO}" rows="5" placeholder="${esc(p.placeholder || 'Escribí acá…')}">${esc(v || '')}</textarea>
      <p class="campo-pie"><span id="contador">${(v || '').length}/${MAX_TEXTO}</span></p>`;
  }
  if (p.tipo === 'escala') {
    return `<div class="escala">${ESCALA.map((e, k) => `
      <label class="escala-op${v === k + 1 ? ' elegida' : ''}">
        <input type="radio" name="op" value="${k + 1}"${v === k + 1 ? ' checked' : ''}>
        <span class="escala-emoji" aria-hidden="true">${e}</span>
        <span class="escala-num">${k + 1}</span>
      </label>`).join('')}</div>
      ${p.min || p.max ? `<p class="escala-extremos"><span>1 · ${esc(p.min || '')}</span><span>${esc(p.max || '')} · 5</span></p>` : ''}`;
  }
  if (p.tipo === 'nube') {
    const palabras = Array.isArray(v) ? v : [];
    const max = p.max || 3;
    return `<div class="nube-entrada">
        <label class="sr-only" for="nube-campo">Palabra</label>
        <input id="nube-campo" class="campo" maxlength="${MAX_PALABRA}" autocomplete="off" placeholder="${palabras.length >= max ? 'Listo: ya cargaste todas' : 'Una palabra…'}"${palabras.length >= max ? ' disabled' : ''}>
        <button type="button" class="boton boton--primario" data-accion="agregar-palabra"${palabras.length >= max ? ' disabled' : ''}>${icono('sumar')}<span class="sr-only">Agregar</span></button>
      </div>
      <ul class="nube-chips" aria-label="Tus palabras">${palabras.map((w, k) => `
        <li class="nube-chip">${esc(w)}<button type="button" data-accion="quitar-palabra" data-k="${k}" aria-label="Quitar ${esc(w)}">${icono('x')}</button></li>`).join('')}</ul>`;
  }
  // unica / multiple
  const multiple = p.tipo === 'multiple';
  const opciones = [...(p.opciones || []), ...(p.otro ? [OTRO] : [])];
  const sel = multiple ? (Array.isArray(v) ? v : []) : v;
  const correctas = p.tipo === 'unica' ? [p.correcta] : (p.correctas || []);
  const items = opciones.map((o, k) => {
    const marcada = multiple ? sel.includes(o) : sel === o;
    let cls = esQuiz ? 'ficha' : 'opcion';
    if (multiple) cls += ` ${esQuiz ? 'ficha' : 'opcion'}--multiple`;
    if (marcada) cls += ' elegida';
    if (bloq) cls += correctas.includes(o) ? ' es-correcta' : marcada ? ' es-incorrecta' : ' atenuada';
    const f = ficha(k);
    const estilo = esQuiz ? ` style="--f-fondo:${f.fondo};--f-sombra:${f.sombra};--f-texto:${f.texto}"` : '';
    const marca = esQuiz ? forma(k) : `<span class="opcion-marca" aria-hidden="true">${icono('check')}</span>`;
    return `<label class="${cls}"${estilo}>
      <input type="${multiple ? 'checkbox' : 'radio'}" name="op" value="${esc(o)}"${marcada ? ' checked' : ''}${bloq ? ' disabled' : ''}>
      ${marca}<span class="opcion-texto">${esc(o)}</span>
      ${bloq && correctas.includes(o) ? `<span class="sello sello--ok">${icono('check')}</span>` : ''}
      ${bloq && marcada && !correctas.includes(o) ? `<span class="sello sello--mal">${icono('x')}</span>` : ''}
    </label>`;
  }).join('');
  const otroSel = p.otro && (multiple ? sel.includes(OTRO) : sel === OTRO);
  return `<div class="${esQuiz ? 'fichas' : 'opciones'}">${items}</div>
    ${p.otro ? `<div class="otro"${otroSel ? '' : ' hidden'}>
      <label class="sr-only" for="campo-otro">¿Cuál?</label>
      <input id="campo-otro" class="campo" maxlength="${MAX_OTRO}" placeholder="Contanos cuál…" value="${esc(est.r[p.id + '_otro'] || '')}"${bloq ? ' disabled' : ''}>
    </div>` : ''}`;
}

/* El pie: devolución del quiz + botones. Se redibuja solo, sin tocar las
   opciones, para no perder el foco mientras alguien escribe. */
function actualizarPie() {
  if (est.pantalla === 'sala') return pieGuiado();
  const pie = document.getElementById('pie');
  if (!pie) return;
  const p = actual();
  const b = botonPrincipal(p);
  const bloq = est.bloqueadas[p.id];
  let devolucion = '';
  if (bloq && !bloq.salteada) {
    const correcta = p.tipo === 'unica' ? `«${esc(p.correcta)}»` : (p.correctas || []).map((c) => `«${esc(c)}»`).join(', ');
    devolucion = bloq.ok
      ? `<div class="devolucion devolucion--ok" role="status"><span class="devolucion-icono">${icono('check')}</span>
          <div><p class="devolucion-titulo">${['¡Correcto!', '¡Bien ahí!', '¡Excelente!', '¡Crack!'][bloq.racha % 4]}</p>
          <p>+${bloq.puntos} puntos${bloq.racha >= 2 ? ` · 🔥 racha de ${bloq.racha}` : ''}</p></div></div>`
      : `<div class="devolucion devolucion--mal" role="status"><span class="devolucion-icono">${icono('x')}</span>
          <div><p class="devolucion-titulo">¡Uy! No era esa</p><p>${p.tipo === 'unica' ? 'La correcta' : 'Las correctas'}: ${correcta}</p></div></div>`;
  }
  const atras = !esQuiz && est.i > 0
    ? `<button type="button" class="boton boton--icono" data-accion="atras" aria-label="Pregunta anterior">${icono('flecha-izq')}</button>` : '';
  pie.innerHTML = `${devolucion}
    ${errorPie ? `<p class="resp-error" role="alert">${esc(errorPie)}</p>` : ''}
    <div class="resp-pie-fila">${atras}
      <button type="button" class="boton boton--ancho boton--grande${b.primario ? ' boton--primario' : ''}" data-accion="${b.accion}"${enviando || b.deshabilitado ? ' disabled' : ''}>
        ${esc(b.texto)}${b.flecha ? icono('flecha-der') : ''}
      </button>
    </div>`;
}

function botonPrincipal(p) {
  const ultima = est.i === preguntas().length - 1;
  const bloq = est.bloqueadas[p.id];
  const ok = respondida(p, est.r[p.id]);
  if (esQuiz && evaluable(p) && !bloq) {
    if (p.tipo === 'multiple' && ok) return { texto: 'Confirmar', accion: 'confirmar', primario: true };
    return { texto: 'Saltear', accion: 'saltear' };
  }
  if (ultima) return { texto: enviando ? 'Enviando…' : esQuiz ? 'Ver mi resultado' : 'Enviar respuestas', accion: 'enviar', primario: true, flecha: !enviando };
  if (bloq || ok) return { texto: 'Siguiente', accion: 'siguiente', primario: true, flecha: true };
  return { texto: 'Saltear', accion: 'siguiente' };
}

function vistaFinal() {
  const ayuda = cajaAyuda();
  if (!esQuiz) {
    const ya = !!almacen.leer(K_HECHO) && !resultado?.recien;
    return `
      <header class="resp-hero resp-hero--centro marca">
        <div class="resp-ancho">
          ${LOGO}
          <div class="final-check">${icono('check')}</div>
          <h1 class="resp-titulo">${esc(ya ? 'Ya recibimos tus respuestas' : def.cierre?.titulo || '¡Gracias por participar!')}</h1>
          ${def.cierre?.texto ? `<p class="resp-subtitulo">${esc(def.cierre.texto)}</p>` : ''}
        </div>
      </header>
      <section class="resp-cuerpo resp-ancho">
        ${ayuda}
        ${PRUEBA ? '<button class="boton" data-accion="otra-vez">Probar de nuevo</button>' : '<p class="nota-suave">Ya podés cerrar esta página.</p>'}
      </section>`;
  }
  const r = resultado || { puntaje: est.puntos, aciertos: 0, puesto: null, total: null };
  const medalla = r.puesto === 1 ? '🥇' : r.puesto === 2 ? '🥈' : r.puesto === 3 ? '🥉' : '🏆';
  const evaluables = preguntas().filter(evaluable).length;
  return `
    <header class="resp-hero resp-hero--centro marca">
      <div class="resp-ancho">
        <div class="medalla" aria-hidden="true">${medalla}</div>
        <p class="chip-marca">${resultado?.recien ? '¡Terminaste!' : 'Tu resultado'}</p>
        <h1 class="resp-titulo">${emojiDe(est.alias)} ${esc(est.alias || 'Participante')}</h1>
        <p class="puntaje"><span id="puntaje-n">${r.puntaje.toLocaleString('es-AR')}</span> <small>puntos</small></p>
        <ul class="final-datos">
          <li><b>${r.aciertos}/${evaluables}</b><span>aciertos</span></li>
          ${r.puesto ? `<li><b>#${r.puesto}</b><span>de ${r.total}</span></li>` : ''}
        </ul>
      </div>
    </header>
    <section class="resp-cuerpo resp-ancho">
      ${PRUEBA ? '<p class="nota-suave">Vista previa: este resultado no entra en el ranking.</p>' : `
      <div class="seccion-cabeza"><h2 class="seccion-titulo">${icono('trofeo')} Ranking</h2>
        <button type="button" class="boton boton--chico" data-accion="ranking">${icono('recargar')} Actualizar</button></div>
      <ol class="ranking" id="ranking">${filasRanking()}</ol>`}
      ${def.cierre?.texto ? `<p class="resp-intro">${esc(def.cierre.texto)}</p>` : ''}
      ${ayuda}
      ${PRUEBA ? '<button class="boton" data-accion="otra-vez">Probar de nuevo</button>' : ''}
    </section>`;
}

function filasRanking() {
  if (!ranking) return '<li class="ranking-vacio"><div class="girador"></div></li>';
  if (!ranking.length) return '<li class="ranking-vacio">Todavía no hay nadie en el ranking.</li>';
  return ranking.map((x, k) => `
    <li class="ranking-fila${x.id === resultado?.id ? ' ranking-fila--yo' : ''}">
      <span class="ranking-pos">${k < 3 ? ['🥇', '🥈', '🥉'][k] : k + 1}</span>
      <span class="ranking-avatar" aria-hidden="true">${emojiDe(x.alias || '')}</span>
      <span class="ranking-alias">${esc(aliasSeguro(x.alias))}${x.id === resultado?.id ? ' <small>(vos)</small>' : ''}</span>
      <span class="ranking-pts">${Number(x.puntaje).toLocaleString('es-AR')}</span>
    </li>`).join('');
}

async function cargarRanking() {
  if (PRUEBA) return;
  try { ranking = await api.ranking(codigo); } catch { ranking = ranking || []; }
  const el = document.getElementById('ranking');
  if (el) el.innerHTML = filasRanking();
}

/* ── Acciones ── */
function empezar() {
  if (g) return entrarSala();
  if (esQuiz) {
    const a = document.getElementById('apodo')?.value.trim();
    est.alias = a || apodoAlAzar();
  }
  est.pantalla = 'pregunta';
  est.i = 0;
  render();
}

function siguiente() {
  clearTimeout(avance);
  if (est.i < preguntas().length - 1) { est.i++; render(); } else enviar();
}

function atras() {
  if (est.i > 0) est.i--;
  else est.pantalla = 'intro';
  render();
}

function bloquear(p, salteada = false) {
  const ok = !salteada && esCorrecta(p, est.r[p.id]);
  if (ok) { est.racha++; est.puntos += puntosPorAcierto(est.racha); } else est.racha = 0;
  est.bloqueadas[p.id] = { ok, salteada, racha: est.racha, puntos: ok ? puntosPorAcierto(est.racha) : 0 };
  guardarBorrador();
}

function saltear() {
  const p = actual();
  if (esQuiz && evaluable(p)) bloquear(p, true);
  if (est.i === preguntas().length - 1) enviar(); else siguiente();
}

function confirmar() {
  const p = actual();
  bloquear(p);
  revelar(p);
}

// Pinta la pregunta ya respondida (correctas, incorrectas) y el HUD.
function revelar(p) {
  const cuerpo = app.querySelector('.pregunta');
  const viejo = cuerpo.querySelector('.fichas, .opciones');
  viejo.outerHTML = campo(p).replace(/<div class="otro"[\s\S]*$/, '');
  app.querySelectorAll('#campo-otro').forEach((x) => { x.disabled = true; });
  const b = est.bloqueadas[p.id];
  const hp = document.getElementById('hud-puntos');
  if (hp) { hp.textContent = `⭐ ${est.puntos.toLocaleString('es-AR')}`; if (b.ok) hp.classList.add('hud--pop'); }
  const hr = document.getElementById('hud-racha');
  if (hr) { hr.textContent = `🔥 ${est.racha}`; hr.classList.toggle('hud-racha--oculta', est.racha < 2); if (b.ok) hr.classList.add('hud--pop'); }
  if (b.ok && est.racha >= 3) confeti({ cantidad: 60, duracion: 1600 });
  actualizarPie();
  app.querySelector('#pie [data-accion="siguiente"], #pie [data-accion="enviar"]')?.focus({ preventScroll: true });
}

function limpiarDatos() {
  const datos = {};
  for (const p of preguntas()) {
    const v = est.r[p.id];
    if (!respondida(p, v)) continue;
    datos[p.id] = typeof v === 'string' ? v.trim() : v;
    const otro = est.r[p.id + '_otro'];
    const otroSel = Array.isArray(v) ? v.includes(OTRO) : v === OTRO;
    if (p.otro && otroSel && typeof otro === 'string' && otro.trim()) datos[p.id + '_otro'] = otro.trim();
  }
  return datos;
}

// El wifi de una escuela con 300 celulares se corta: dos reintentos
// solos antes de pedirle a la persona que toque de nuevo.
async function conReintento(fn) {
  for (let intento = 0; ; intento++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ErrorApi) || e.codigo !== 'red' || intento >= 2) throw e;
      await new Promise((ok) => setTimeout(ok, 1200 * (intento + 1) + Math.random() * 800));
    }
  }
}

async function enviar() {
  if (enviando) return;
  const datos = limpiarDatos();
  if (!Object.keys(datos).length) {
    errorPie = 'Respondé al menos una pregunta para poder enviar.';
    return actualizarPie();
  }
  enviando = true;
  errorPie = '';
  actualizarPie();
  try {
    if (PRUEBA) {
      const aciertos = Object.values(est.bloqueadas).filter((b) => b.ok).length;
      resultado = { id: null, puntaje: est.puntos, aciertos, puesto: null, total: null, recien: true };
    } else {
      resultado = { ...(await conReintento(() => api.responder(codigo, esQuiz ? est.alias : null, datos))), recien: true };
      almacen.guardar(K_HECHO, { quizId: quiz.id, alias: est.alias, resultado: { ...resultado, recien: false } });
      almacen.borrar(K_BORRADOR, true);
    }
    enviando = false;
    est.pantalla = 'final';
    render();
    if (esQuiz) {
      contar(document.getElementById('puntaje-n'), resultado.puntaje);
      cargarRanking();
    }
    if (esQuiz || def.celebrar) confeti();
  } catch (e) {
    enviando = false;
    errorPie = e instanceof ErrorApi && e.codigo === 'cerrado'
      ? 'El quiz se cerró y ya no recibe respuestas.'
      : 'No se pudo enviar. Revisá tu conexión y volvé a tocar el botón.';
    actualizarPie();
  }
}

function agregarPalabra() {
  const p = actual();
  const input = document.getElementById('nube-campo');
  const w = input.value.trim().replace(/\s+/g, ' ').slice(0, MAX_PALABRA);
  if (!w) return input.focus();
  const lista = Array.isArray(est.r[p.id]) ? est.r[p.id] : [];
  if (!lista.some((x) => normalizarPalabra(x) === normalizarPalabra(w)) && lista.length < (p.max || 3)) lista.push(w);
  est.r[p.id] = lista;
  redibujarCampo(p);
  document.getElementById('nube-campo')?.focus();
}

function redibujarCampo(p) {
  const cuerpo = app.querySelector('.pregunta');
  cuerpo.querySelectorAll('.nube-entrada, .nube-chips').forEach((x) => x.remove());
  cuerpo.insertAdjacentHTML('beforeend', campo(p));
  guardarBorrador();
  actualizarPie();
}

/* ── Eventos ── */
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b || b.disabled) return;
  const a = b.dataset.accion;
  if (a === 'recargar') location.reload();
  else if (a === 'empezar') empezar();
  else if (a === 'dado') {
    est.alias = apodoAlAzar();
    document.getElementById('apodo').value = est.alias;
    const av = document.getElementById('apodo-avatar');
    av.textContent = emojiDe(est.alias);
    av.classList.remove('hud--pop'); void av.offsetWidth; av.classList.add('hud--pop');
  }
  else if (a === 'siguiente') siguiente();
  else if (a === 'atras') atras();
  else if (a === 'saltear') saltear();
  else if (a === 'confirmar') confirmar();
  else if (a === 'enviar-guiado') enviarGuiado(actual());
  else if (a === 'enviar') enviar();
  else if (a === 'agregar-palabra') agregarPalabra();
  else if (a === 'quitar-palabra') {
    const p = actual();
    est.r[p.id] = (est.r[p.id] || []).filter((_, k) => k !== Number(b.dataset.k));
    redibujarCampo(p);
  }
  else if (a === 'ranking') { ranking = null; document.getElementById('ranking').innerHTML = filasRanking(); cargarRanking(); }
  else if (a === 'otra-vez') { est = estadoInicial(); if (esQuiz) est.alias = apodoAlAzar(); resultado = null; render(); }
});

app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name !== 'op') return;
  clearTimeout(avance);
  const p = actual();
  if (p.tipo === 'escala') est.r[p.id] = Number(t.value);
  else if (p.tipo === 'multiple') {
    let sel = [...app.querySelectorAll('input[name="op"]:checked')].map((x) => x.value);
    if (p.exclusiva && t.checked) {
      sel = t.value === p.exclusiva ? [p.exclusiva] : sel.filter((x) => x !== p.exclusiva);
      app.querySelectorAll('input[name="op"]').forEach((x) => { x.checked = sel.includes(x.value); });
    }
    est.r[p.id] = sel;
  } else est.r[p.id] = t.value;

  app.querySelectorAll('input[name="op"]').forEach((x) => x.closest('label').classList.toggle('elegida', x.checked));
  const v = est.r[p.id];
  const otroSel = p.otro && (Array.isArray(v) ? v.includes(OTRO) : v === OTRO);
  const caja = app.querySelector('.otro');
  if (caja) {
    caja.hidden = !otroSel;
    if (otroSel && t.value === OTRO && t.checked !== false) document.getElementById('campo-otro')?.focus();
  }
  if (!otroSel) delete est.r[p.id + '_otro'];
  guardarBorrador();

  if (est.pantalla === 'sala') return trasCambioGuiado(p, t);
  if (esQuiz && evaluable(p) && p.tipo === 'unica') { bloquear(p); return revelar(p); }
  actualizarPie();
  const ultima = est.i === preguntas().length - 1;
  if ((p.tipo === 'unica' || p.tipo === 'escala') && t.value !== OTRO && !ultima) avance = setTimeout(siguiente, 380);
});

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'apodo') {
    est.alias = t.value.trim();
    document.getElementById('apodo-avatar').textContent = emojiDe(est.alias);
    return guardarBorrador();
  }
  const p = est.pantalla === 'pregunta' || est.pantalla === 'sala' ? actual() : null;
  if (!p) return;
  if (t.id === 'campo-texto') {
    est.r[p.id] = t.value;
    document.getElementById('contador').textContent = `${t.value.length}/${MAX_TEXTO}`;
  } else if (t.id === 'campo-otro') est.r[p.id + '_otro'] = t.value;
  else return;
  guardarBorrador();
  actualizarPie();
});

app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'nube-campo') { e.preventDefault(); agregarPalabra(); }
  else if (e.target.id === 'apodo') { e.preventDefault(); empezar(); }
  else if (e.target.id === 'campo-otro') { e.preventDefault(); app.querySelector('#pie .boton--primario')?.click(); }
});

/* ══ Modo guiado ══
   El presentador activa cada pregunta desde la pantalla o la botonera. El
   celular entra a la sala (unirse) y pregunta el estado cada ~3 s: muestra
   la pregunta activa, "respuesta enviada", la devolución cuando se revela
   la correcta y, al final, el resultado. Cada respuesta se guarda al toque. */
const K_GUIADO = `resp:${codigo}:guiado`;
let g = null;          // { quizId, pid, alias, r, enviadas, unido } (queda en este celular)
let vivo = {};         // el estado que publicó el presentador
let vistaSala = '';
let sondeo = null;

const guardarG = () => almacen.guardar(K_GUIADO, g);
function preguntaActiva() { return vivo.activa ? preguntas().find((p) => p.id === vivo.activa) || null : null; }

async function arrancarGuiado() {
  g = almacen.leer(K_GUIADO);
  if (!g || g.quizId !== quiz.id) g = { quizId: quiz.id, pid: uuid(), alias: esQuiz ? apodoAlAzar() : '', r: {}, enviadas: {}, unido: false };
  est.alias = g.alias;
  if (!g.unido) return render();
  est.pantalla = 'sala';
  await sondear(true);
}

async function entrarSala() {
  if (esQuiz) g.alias = est.alias = document.getElementById('apodo')?.value.trim() || est.alias || apodoAlAzar();
  const b = app.querySelector('[data-accion="empezar"]');
  if (b) { b.disabled = true; b.textContent = 'Entrando…'; }
  try {
    await conReintento(() => api.unirse(codigo, g.pid, g.alias));
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === 'cerrado') return mensaje('Este quiz está cerrado', 'Ya no recibe respuestas. ¡Gracias por tu interés!');
    if (b) { b.disabled = false; b.textContent = 'Reintentar'; }
    return toast('No pudimos conectarte. Probá de nuevo.');
  }
  g.unido = true;
  guardarG();
  est.pantalla = 'sala';
  await sondear(true);
}

async function sondear(forzar = false) {
  clearTimeout(sondeo);
  try {
    const r = await api.estado(codigo);
    if (!r) return mensaje('Este quiz ya no existe', 'Pedile el código nuevo a quien presenta.');
    if (!r.abierto) return mensaje('Este quiz está cerrado', 'Ya no recibe respuestas. ¡Gracias por participar!');
    const nuevo = r.en_vivo || {};
    if (forzar || (nuevo.rev || 0) !== (vivo.rev || 0)) {
      vivo = nuevo;
      await alCambiarVivo();
    }
  } catch { /* sin señal: se vuelve a intentar solo */ }
  // ~3 s con un poco de azar: 300 celulares no preguntan todos a la vez.
  sondeo = setTimeout(sondear, document.hidden ? 10000 : 2500 + Math.random() * 1500);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && g?.unido) sondear(); });

async function alCambiarVivo() {
  if (vivo.fin) {
    if (est.pantalla === 'final') return;
    est.pantalla = 'final';
    let r = null;
    if (esQuiz) { try { r = await api.miResultado(codigo, g.pid); } catch { /* se muestra lo que hay */ } }
    resultado = { puntaje: 0, aciertos: 0, ...(r || {}), recien: true };
    render();
    if (esQuiz) { contar(document.getElementById('puntaje-n'), resultado.puntaje); cargarRanking(); }
    if (esQuiz || def.celebrar) confeti();
    return;
  }
  if (est.pantalla === 'final') est.pantalla = 'sala';
  renderSala();
}

function renderSala(forzar = false) {
  const p = preguntaActiva();
  let tipo = 'pregunta';
  if (!p) tipo = 'espera';
  else if (g.enviadas[p.id]) tipo = esQuiz && evaluable(p) ? ((vivo.correctas || []).includes(p.id) ? 'devolucion' : 'enviada-quiz') : 'enviada';
  else if (vivo.cerrada) tipo = 'cerrada';
  const claveVista = `${tipo}:${p?.id || ''}:${(vivo.correctas || []).length}`;
  if (!forzar && claveVista === vistaSala) return;
  vistaSala = claveVista;
  clearTimeout(avance);
  app.innerHTML = vistaSalaHtml(tipo, p);
  window.scrollTo(0, 0);
  if (tipo === 'pregunta') { pieGuiado(); document.getElementById('pt')?.focus({ preventScroll: true }); }
  if (tipo === 'devolucion' && esCorrecta(p, g.r[p.id])) confeti({ cantidad: 70, duracion: 1600 });
}

function hudGuiado() {
  const { puntaje, racha } = puntosRevelados(def, g.r, vivo.correctas || []);
  return `<span class="hud">
    <span class="hud-racha${racha >= 2 ? '' : ' hud-racha--oculta'}">🔥 ${racha}</span>
    <span class="hud-puntos">⭐ ${puntaje.toLocaleString('es-AR')}</span>
  </span>`;
}

function vistaSalaHtml(tipo, p) {
  const n = preguntas().length;
  const k = p ? preguntas().indexOf(p) + 1 : 0;
  const top = `<header class="resp-top marca"><div class="resp-ancho resp-top-fila">
      <img class="logo-ciudad logo-ciudad--chico" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
      <span class="resp-paso">${p ? `Pregunta ${k} de ${n}` : '<span class="en-vivo">En vivo</span>'}</span>
      ${esQuiz ? hudGuiado() : ''}
    </div></header>`;
  if (tipo === 'pregunta') {
    const vale = esQuiz && evaluable(p) ? `<span class="vale">${icono('rayo')} Vale puntos</span>` : '';
    return `${top}
      <section class="resp-cuerpo resp-ancho">
        <div class="pregunta" role="group" aria-labelledby="pt">
          <p class="pregunta-num">Pregunta ${k} ${vale}</p>
          <h2 id="pt" class="pregunta-texto" tabindex="-1">${esc(p.texto)}</h2>
          ${ayudaDeTipo(p)}
          ${campo(p)}
        </div>
        ${lineaAyuda()}
      </section>
      <footer class="resp-pie"><div class="resp-ancho" id="pie"></div></footer>`;
  }
  const correcta = p && esQuiz && evaluable(p)
    ? (p.tipo === 'unica' ? `«${esc(p.correcta)}»` : (p.correctas || []).map((c) => `«${esc(c)}»`).join(', ')) : '';
  let emoji = '👀', titulo = '¡Ya estás adentro!', texto = 'Mirá la pantalla: cuando arranque la próxima pregunta, aparece acá.', extra = '', clase = '';
  if (tipo === 'enviada') { emoji = '✅'; titulo = '¡Respuesta enviada!'; texto = 'Gracias. Esperá la próxima pregunta.'; }
  else if (tipo === 'enviada-quiz') { emoji = '⏳'; titulo = '¡Respuesta enviada!'; texto = 'Esperá a que se muestre la correcta en la pantalla…'; }
  else if (tipo === 'cerrada') {
    emoji = '🔒'; titulo = 'Se cerró esta pregunta'; texto = 'Esperá la próxima: va a aparecer acá.';
    if (correcta && (vivo.correctas || []).includes(p.id)) extra = `<p class="sala-correcta">La correcta era ${correcta}</p>`;
  } else if (tipo === 'devolucion') {
    const ok = esCorrecta(p, g.r[p.id]);
    const gano = puntosRevelados(def, g.r, vivo.correctas || []).ganancia[p.id] || { pts: 0, racha: 0 };
    clase = ok ? ' sala--ok' : ' sala--mal';
    emoji = ok ? '🎉' : '😅';
    titulo = ok ? ['¡Correcto!', '¡Bien ahí!', '¡Excelente!', '¡Crack!'][gano.racha % 4] : '¡Uy! No era esa';
    texto = ok ? `+${gano.pts} puntos${gano.racha >= 2 ? ` · 🔥 racha de ${gano.racha}` : ''}` : `La correcta: ${correcta}`;
  } else if (esQuiz) {
    emoji = emojiDe(g.alias);
    extra = `<p class="sala-apodo">Jugás como <b>${esc(g.alias)}</b></p>`;
  }
  const esperando = tipo === 'espera' || tipo.startsWith('enviada') || tipo === 'cerrada';
  return `${top}
    <section class="resp-cuerpo resp-ancho">
      <div class="sala${clase}" role="status">
        <div class="sala-emoji" aria-hidden="true">${emoji}</div>
        <h1 class="sala-titulo">${titulo}</h1>
        <p class="sala-texto">${texto}</p>
        ${extra}
        ${esperando ? '<div class="puntitos" aria-hidden="true"><span></span><span></span><span></span></div>' : ''}
      </div>
      ${lineaAyuda()}
    </section>`;
}

function pieGuiado() {
  const pie = document.getElementById('pie');
  const p = preguntaActiva();
  if (!pie || !p) return;
  const v = est.r[p.id];
  const alToque = (p.tipo === 'unica' && v !== OTRO) || p.tipo === 'escala';
  const listo = respondida(p, v);
  pie.innerHTML = `${errorPie ? `<p class="resp-error" role="alert">${esc(errorPie)}</p>` : ''}
    <div class="resp-pie-fila">${alToque && !errorPie
      ? `<p class="pie-ayuda">${enviando || listo ? 'Enviando…' : 'Tocá una opción para responder'}</p>`
      : `<button type="button" class="boton boton--ancho boton--grande boton--primario" data-accion="enviar-guiado"${!listo || enviando ? ' disabled' : ''}>
          ${enviando ? 'Enviando…' : 'Enviar'} ${enviando ? '' : icono('flecha-der')}</button>`}
    </div>`;
}

function trasCambioGuiado(p, t) {
  errorPie = '';
  pieGuiado();
  // Opción única y escala se mandan al tocar (como en Kahoot); el resto, con "Enviar".
  if ((p.tipo === 'unica' && t.value !== OTRO) || p.tipo === 'escala') avance = setTimeout(() => enviarGuiado(p), 250);
}

async function enviarGuiado(p) {
  if (enviando || !p || g.enviadas[p.id]) return;
  const v = est.r[p.id];
  if (!respondida(p, v)) return;
  const valor = typeof v === 'string' ? v.trim() : v;
  const otroSel = p.otro && (Array.isArray(v) ? v.includes(OTRO) : v === OTRO);
  enviando = true;
  errorPie = '';
  app.querySelectorAll('.pregunta input, .pregunta textarea, .pregunta button').forEach((x) => { x.disabled = true; });
  pieGuiado();
  try {
    await conReintento(() => api.responderPregunta(codigo, g.pid, g.alias, p.id, valor, otroSel ? est.r[p.id + '_otro'] : null));
    g.r[p.id] = valor;
    g.enviadas[p.id] = true;
    guardarG();
  } catch (e) {
    const c = e instanceof ErrorApi ? e.codigo : '';
    if (c === 'ya') { g.r[p.id] ??= valor; g.enviadas[p.id] = true; guardarG(); }
    else if (c === 'cerrada') vivo = { ...vivo, cerrada: true };
    else if (c === 'cerrado') { enviando = false; return mensaje('Este quiz se cerró', 'Ya no recibe respuestas. ¡Gracias por participar!'); }
    else errorPie = 'No se pudo enviar. Revisá tu conexión y probá de nuevo.';
  }
  enviando = false;
  if (errorPie) {
    app.querySelectorAll('.pregunta input, .pregunta textarea, .pregunta button').forEach((x) => { x.disabled = false; });
    pieGuiado();
  } else {
    renderSala(true);
  }
}
