// Pantalla para proyectar: QR gigante con la sala de espera, resultados en
// vivo pregunta por pregunta y el podio del quiz. Se maneja con flechas,
// con el control de diapositivas (PageUp/PageDown), con los botones o desde
// la botonera del celular (/control/<codigo>). Lo que se ve acá se guarda en
// la base (en_vivo): en modo guiado, los celulares muestran la pregunta activa.
import { api, MODO_LOCAL, clave as claveEquipo } from './api.js';
import { OTRO, TIPOS, ESCALA, aplicarTema, ficha, forma, evaluable, agregar, aCsv, emojiDe, aliasSeguro, esInapropiado } from './juego.js';
import { icono } from './iconos.js';
import { qrHtml } from './qr.js';
import { esc, almacen, toast, descargar, copiar, plural, confeti } from './util.js';

const app = document.getElementById('app');
const codigo = (new URLSearchParams(location.search).get('c') || location.pathname.split('/').filter(Boolean)[1] || '').toLowerCase();
const urlQuiz = `${location.origin}/${codigo}`;
const urlVisible = `${location.host}/${codigo}`;
const urlControl = `${location.origin}/control/${codigo}`;
const K_SLIDE = `pres:${codigo}:slide`;
const K_OCULTAS = `pres:${codigo}:ocultas`;
const MAX_MURO = 80;
const MAX_NUBE = 50;
const MAX_LOBBY = 40;

let clave = MODO_LOCAL ? 'local' : claveEquipo.leer();
let quiz = null;
let def = null;
let esQuiz = false;
let firmaDef = '';
let filas = [];
let ultimo = 0;          // mayor "c" (cambio) recibido: lo siguiente se pide desde acá
let slide = 0;
let guiado = false;
let localRev = 0;        // versión del estado en vivo que ya está en pantalla
let pendientes = 0;      // escrituras en vuelo: mientras tanto no se pisa lo local
let conexion = 'ok';
let timer = null;
const revelado = new Set();      // preguntas con respuestas abiertas visibles
const conCorrecta = new Set();   // preguntas del quiz con la correcta a la vista
const ocultas = new Set(almacen.leer(K_OCULTAS) || []);
const vistos = new Set();
const firmas = {};

const n = () => def.preguntas.length;
const ultimaSlide = () => n() + 1;   // la última: podio (quiz) o cierre (encuesta)

/* ── Arranque ── */
if (MODO_LOCAL) document.body.insertAdjacentHTML('beforeend', '<p class="aviso-local">MODO LOCAL</p>');
if (!codigo) mensaje('Falta el código del quiz', 'Abrí esta pantalla desde el panel.', '<a class="boton boton--amarillo" href="/panel">Ir al panel</a>');
else if (!clave) pedirClave();
else cargar();

async function cargar() {
  try {
    const r = await api.resultados(clave, codigo, 0);
    recibir(r, true);
    if (!MODO_LOCAL) claveEquipo.guardar(clave);
    filas.forEach((f) => vistos.add(f.id));
    esqueleto();
    const ev = r.en_vivo || {};
    if (ev.rev) {
      // Ya había una presentación en curso (se recargó la página): seguirla.
      localRev = ev.rev;
      (ev.ver || []).forEach((x) => revelado.add(x));
      (ev.correctas || []).forEach((x) => conCorrecta.add(x));
      irA(Number(ev.slide) || 0, true, false);
    } else irA(Number(almacen.leer(K_SLIDE, true)) || 0);
    programar();
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); pedirClave(clave ? 'La clave no es correcta.' : ''); }
    else if (e.codigo === 'no-existe') mensaje('No existe ese quiz', `No hay ningún quiz con el código «${codigo}».`, '<a class="boton boton--amarillo" href="/panel">Ir al panel</a>');
    else mensaje('No se pudo conectar', 'Revisá la conexión a internet.', '<button class="boton boton--amarillo" data-accion="recargar">Reintentar</button>');
  }
}

function recibir(r, completo) {
  quiz = r.quiz;
  const f = JSON.stringify(quiz.def);
  const cambioDef = f !== firmaDef;
  firmaDef = f;
  def = quiz.def;
  esQuiz = def.modo === 'quiz';
  if (cambioDef) { aplicarTema(def.tema); document.title = `${def.titulo} · En vivo`; }
  guiado = def.ritmo === 'guiado';
  const llegadas = (r.filas || []).filter((x) => x && Number.isFinite(x.id) && x.d && typeof x.d === 'object');
  if (completo) filas = llegadas;
  else if (llegadas.length) {
    // En modo guiado una misma fila cambia con cada respuesta: se reemplaza.
    const porId = new Map(filas.map((x) => [x.id, x]));
    llegadas.forEach((x) => porId.set(x.id, x));
    filas = [...porId.values()].sort((a, b) => a.id - b.id);
  }
  ultimo = filas.reduce((m, x) => Math.max(m, Number(x.c) || 0), 0);
  return { cambioDef, hay: llegadas.length > 0, completo };
}

function programar() {
  clearTimeout(timer);
  timer = setTimeout(ciclo, document.hidden ? 15000 : 1500);
}

async function ciclo() {
  try {
    let r = await api.resultados(clave, codigo, ultimo);
    let res = recibir(r, false);
    if (typeof r.total === 'number' && r.total !== filas.length) {
      r = await api.resultados(clave, codigo, 0);   // se borraron respuestas: todo de nuevo
      res = recibir(r, true);
    }
    conexion = 'ok';
    const movido = aplicarEnVivo(r.en_vivo);
    if (res.cambioDef) { renderNav(); irA(Math.min(slide, ultimaSlide()), false, false); }
    else if (!movido && (res.hay || res.completo)) actualizar(false);
    else if (!movido) actualizarVivo();
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); clearTimeout(timer); return pedirClave('La clave dejó de ser válida.'); }
    conexion = 'error';
    actualizarVivo();
  }
  programar();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && def) ciclo(); });

/* ── Pantallas sueltas ── */
function mensaje(titulo, texto, extra = '') {
  app.innerHTML = `<div class="mensaje marca"><div class="mensaje-caja">
    <img class="logo-ciudad" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
    <h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${extra}</div></div>`;
}

function pedirClave(error = '') {
  app.innerHTML = `<div class="mensaje marca"><form class="clave-tarjeta" id="form-clave">
    <img src="/img/isologo.png" width="56" height="56" alt="">
    <h1>Resultados en vivo</h1>
    <p>Ingresá la clave del equipo para ver las respuestas de <b>${esc(codigo)}</b>.</p>
    <label class="etiqueta" for="clave">Clave del equipo</label>
    <input id="clave" class="campo" type="password" autocomplete="current-password" required>
    ${error ? `<p class="clave-error" role="alert">${esc(error)}</p>` : ''}
    <button class="boton boton--primario">Entrar ${icono('flecha-der')}</button>
  </form></div>`;
  document.getElementById('clave').focus();
}

/* ── Esqueleto ──
   Todo se maneja desde esta pantalla: a la izquierda, siempre a la vista, el
   QR, cuántos entraron y los dos botones (Siguiente / Anterior); a la
   derecha, la pregunta activa con sus resultados en vivo. */
function esqueleto() {
  app.innerHTML = `
    <div class="pres" id="pres">
      <aside class="lado marca">
        <img class="logo-ciudad lado-logo" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
        <p class="lado-llamado">Escaneá y participá</p>
        <div class="lado-qr">${qrHtml(urlQuiz)}</div>
        <p class="lado-url">${esc(urlVisible)}</p>
        ${vivoHtml('vivo--lado')}
        <div class="lado-control">
          <p class="lado-paso" id="pres-paso"></p>
          <div class="lado-progreso"><span id="progreso"></span></div>
          <div class="lado-nav">
            <button class="lado-ant" data-accion="anterior" aria-label="Volver a la anterior" title="Anterior (←)">${icono('chevron-izq')}</button>
            <button class="lado-sig" data-accion="siguiente" id="btn-sig" title="Siguiente (→ o espacio)"><span>Empezar</span>${icono('chevron-der')}</button>
          </div>
        </div>
      </aside>
      <main class="pres-main" id="slide"></main>
      <div class="herramientas" id="herramientas"></div>
    </div>`;
  renderNav();
}

function vivoHtml(extra = '') {
  return `<p class="vivo ${extra}" data-estado="${conexion}"><span class="vivo-punto"></span><b data-vivo-n>${filas.length}</b>
    <span data-vivo-txt>${textoVivo(filas.length)}</span><span class="vivo-error">· reconectando</span></p>`;
}
const textoVivo = (total) => (esQuiz ? (total === 1 ? 'jugador' : 'jugadores') : (total === 1 ? 'persona participando' : 'personas participando'));

// Herramientas chicas arriba a la derecha (no hacen falta para presentar).
function renderNav() {
  document.getElementById('herramientas').innerHTML = `
    <button class="nav-boton" data-accion="pantalla-completa" aria-label="Pantalla completa" title="Pantalla completa (F)">${icono('maximizar')}</button>
    <details class="menu">
      <summary class="nav-boton" aria-label="Más opciones">${icono('mas')}</summary>
      <div class="menu-lista">
        <p class="menu-titulo">Ir a</p>
        <button data-ir="0">${icono('qr')} Inicio</button>
        ${def.preguntas.map((p, k) => `<button data-ir="${k + 1}"><b>${k + 1}.</b> <span class="menu-corto">${esc(p.texto)}</span></button>`).join('')}
        <button data-ir="${n() + 1}">${icono(esQuiz ? 'trofeo' : 'check')} ${esQuiz ? 'Podio' : 'Cierre'}</button>
        <hr>
        <button data-accion="csv">${icono('descargar')} Descargar respuestas (CSV)</button>
        <button data-accion="copiar">${icono('enlace')} Copiar link para participar</button>
        <button data-accion="botonera">${icono('qr')} Botonera en el celular (opcional)</button>
        <a href="/panel">${icono('lapiz')} Ir al panel</a>
        <button data-accion="borrar" class="menu-peligro">${icono('papelera')} Borrar todas las respuestas</button>
      </div>
    </details>`;
}

function actualizarLado() {
  document.getElementById('pres-paso').textContent = slide === 0 ? 'Esperando que empiece'
    : slide <= n() ? `Pregunta ${slide} de ${n()}` : esQuiz ? 'Podio' : 'Terminó';
  document.getElementById('progreso').style.width = `${(slide / (n() + 1)) * 100}%`;
  const sig = document.getElementById('btn-sig');
  sig.querySelector('span').textContent = slide === 0 ? 'Empezar' : slide < n() ? 'Siguiente'
    : slide === n() ? (esQuiz ? 'Ver el podio' : 'Terminar') : 'Fin';
  sig.disabled = slide === ultimaSlide();
  sig.classList.toggle('lado-sig--empezar', slide === 0);
  document.querySelector('.lado [data-accion="anterior"]').disabled = slide === 0;
}

/* ── Navegación ── */
function irA(k, animar = true, escribir = true) {
  if (!def) return;
  slide = Math.max(0, Math.min(ultimaSlide(), k));
  almacen.guardar(K_SLIDE, slide, true);
  const inicio = slide === 0;
  const main = document.getElementById('slide');
  Object.keys(firmas).forEach((x) => delete firmas[x]);
  if (inicio) main.innerHTML = vistaInicio();
  else if (slide <= n()) main.innerHTML = vistaPregunta(def.preguntas[slide - 1], slide);
  else main.innerHTML = esQuiz ? vistaPodio() : vistaFin();
  if (!animar) main.querySelector('.slide, .inicio, .podio-slide')?.classList.add('sin-animar');
  actualizarLado();
  actualizar(animar);
  if (slide === n() + 1 && filas.length && animar && (esQuiz || def.celebrar)) setTimeout(() => confeti({ cantidad: 200 }), 700);
  if (escribir) publicar();
}

/* ── Estado en vivo (compartido con la botonera y, en modo guiado, con los celulares) ── */
function estadoActual() {
  const p = slide >= 1 && slide <= n() ? def.preguntas[slide - 1] : null;
  return { slide, activa: p?.id || null, cerrada: !!p && conCorrecta.has(p.id), ver: [...revelado], correctas: [...conCorrecta], fin: slide === n() + 1 };
}

async function publicar() {
  pendientes++;
  try {
    const ev = await api.enVivo(clave, codigo, estadoActual());
    localRev = Math.max(localRev, Number(ev?.rev) || 0);
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); pedirClave('La clave dejó de ser válida.'); }
    else toast(guiado ? 'No llegó a los celulares: revisá la conexión' : 'No se pudo sincronizar con la botonera');
  } finally {
    pendientes--;
  }
}

// Lo que mandó la botonera (u otra pantalla): se aplica si es más nuevo.
function aplicarEnVivo(ev) {
  if (!ev || !ev.rev || ev.rev <= localRev || pendientes > 0) return false;
  localRev = ev.rev;
  const p = slide >= 1 && slide <= n() ? def.preguntas[slide - 1] : null;
  const antes = p && conCorrecta.has(p.id);
  revelado.clear(); (ev.ver || []).forEach((x) => revelado.add(x));
  conCorrecta.clear(); (ev.correctas || []).forEach((x) => conCorrecta.add(x));
  const k = Number(ev.slide) || 0;
  if (k !== slide) { irA(k, true, false); return true; }
  Object.keys(firmas).forEach((x) => delete firmas[x]);
  if (p && !antes && conCorrecta.has(p.id)) confeti({ cantidad: 80, duracion: 1800 });
  actualizar(true);
  return true;
}

/* ── Vistas ── */
function vistaInicio() {
  return `<section class="inicio">
    <p class="inicio-etiqueta">${esc(def.etiqueta || (esQuiz ? 'Quiz' : 'Encuesta'))}</p>
    <h1 class="inicio-titulo">${esc(def.titulo)}</h1>
    ${def.subtitulo ? `<p class="inicio-subtitulo">${esc(def.subtitulo)}</p>` : ''}
    <ol class="inicio-pasos">
      <li><b>1</b>Abrí la cámara del celular</li>
      <li><b>2</b>Escaneá el código de la izquierda</li>
      <li><b>3</b>${esQuiz ? '¡Elegí tu apodo y a jugar!' : 'Respondé: es anónimo'}</li>
    </ol>
    <p class="inicio-cuenta"><b data-vivo-n>${filas.length}</b> <span data-vivo-txt>${textoVivo(filas.length)}</span></p>
    ${esQuiz ? '<ul class="lobby" id="lobby" aria-label="Jugadores"></ul>' : ''}
    <p class="inicio-ayuda">Cuando estén adentro, tocá <b>Empezar</b>. El código queda siempre a la vista: los que llegan tarde también entran.</p>
  </section>`;
}

function vistaPregunta(p, k) {
  const multiple = p.tipo === 'multiple';
  const nota = multiple ? ' · cada persona puede marcar varias' : p.tipo === 'nube' ? ' · palabras más repetidas, más grandes' : '';
  return `<section class="slide">
    <header class="slide-cabeza">
      <div class="slide-cabeza-texto">
        <p class="slide-num">Pregunta ${k} <span class="slide-tipo">${icono(TIPOS[p.tipo]?.icono || 'lista')} ${esc(TIPOS[p.tipo]?.nombre || '')}</span>
          ${esQuiz && evaluable(p) ? `<span class="vale">${icono('rayo')} Vale puntos</span>` : ''}</p>
        <h1 class="slide-texto">${esc(p.texto)}</h1>
        <p class="slide-meta"><b id="meta-n">0</b> <span id="meta-txt">respuestas</span>${nota}</p>
      </div>
      <div class="slide-acciones" id="acciones"></div>
    </header>
    <div class="slide-cuerpo" id="cuerpo"></div>
  </section>`;
}

function vistaFin() {
  return `<section class="fin-slide">
    <div class="fin-check">${icono('check')}</div>
    <h1 class="fin-titulo">${esc(def.cierre?.titulo || '¡Gracias por participar!')}</h1>
    ${def.cierre?.texto ? `<p class="fin-texto">${esc(def.cierre.texto)}</p>` : ''}
    <p class="fin-n"><b data-vivo-n>${filas.length}</b> <span data-vivo-txt>respuestas</span></p>
  </section>`;
}

function vistaPodio() {
  return `<section class="podio-slide">
    <h1 class="podio-titulo">${icono('trofeo')} Podio</h1>
    <div class="podio" id="podio"></div>
    <ol class="podio-resto" id="podio-resto"></ol>
  </section>`;
}

/* ── Actualizar con datos nuevos ── */
function actualizar(animar) {
  actualizarVivo();
  if (slide === 0) return actualizarLobby();
  if (slide > n()) return esQuiz ? actualizarPodio(animar) : undefined;
  const p = def.preguntas[slide - 1];
  const a = agregar(p, filas);
  document.getElementById('meta-n').textContent = a.total;
  document.getElementById('meta-txt').textContent = a.total === 1 ? 'respuesta' : 'respuestas';
  if (p.tipo === 'texto') return actualizarMuro(p, a);
  if (p.tipo === 'nube') return actualizarNube(p, a);
  if (p.tipo === 'escala') return actualizarEscala(p, a, animar);
  actualizarBarras(p, a, animar);
}

function actualizarVivo() {
  const total = filas.length;
  document.querySelectorAll('[data-vivo-n]').forEach((el) => {
    if (el.textContent !== String(total)) {
      el.textContent = total;
      el.classList.remove('hud--pop'); void el.offsetWidth; el.classList.add('hud--pop');
    }
  });
  document.querySelectorAll('[data-vivo-txt]').forEach((el) => { el.textContent = textoVivo(total); });
  document.querySelectorAll('.vivo').forEach((el) => { el.dataset.estado = conexion; });
}

function cambio(clave, valor) {
  if (firmas[clave] === valor) return false;
  firmas[clave] = valor;
  return true;
}

function animarAncho(el, valor, animar) {
  if (animar) requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = valor; }));
  else el.style.width = valor;
}

function actualizarBarras(p, a, animar) {
  const cuerpo = document.getElementById('cuerpo');
  const quizEval = esQuiz && evaluable(p);
  const correctas = p.tipo === 'unica' ? [p.correcta] : (p.correctas || []);
  const mostrarCorrecta = quizEval && conCorrecta.has(p.id);
  // Quiz guiado: hasta mostrar la correcta solo se ve cuántos respondieron
  // (como en Kahoot), así nadie se copia de las barras.
  if (guiado && quizEval && !mostrarCorrecta) return esperandoRespuestas(p, a);
  if (cambio('barras', a.opciones.length + '|' + mostrarCorrecta)) {
    cuerpo.innerHTML = `<ol class="barras${esQuiz ? ' barras--quiz' : ''}">${a.opciones.map((o, k) => {
      const f = ficha(k);
      const esC = mostrarCorrecta && correctas.includes(o.o);
      const cls = `barra${o.o === OTRO ? ' barra--otro' : ''}${mostrarCorrecta ? (esC ? ' barra--correcta' : ' barra--atenuada') : ''}`;
      return `<li class="${cls}" data-k="${k}" style="--f-fondo:${f.fondo};--f-texto:${f.texto}">
        <div class="barra-cabeza">
          ${esQuiz ? `<span class="barra-forma">${forma(k)}</span>` : ''}
          <span class="barra-etiqueta">${esc(o.o)}</span>
          ${esC ? `<span class="barra-ok">${icono('check')} Correcta</span>` : ''}
          <span class="barra-valor"><b class="barra-pct">0%</b><span class="barra-n">0</span></span>
        </div>
        <div class="barra-pista"><div class="barra-relleno"></div></div>
      </li>`;
    }).join('')}</ol>${p.otro ? '<div class="otros" id="otros"></div>' : ''}`;
    delete firmas.otros;
    animar = true;
  }
  const max = Math.max(0, ...a.opciones.map((o) => o.n));
  a.opciones.forEach((o, k) => {
    const fila = cuerpo.querySelector(`.barra[data-k="${k}"]`);
    if (!fila) return;
    fila.querySelector('.barra-pct').textContent = `${Math.round(o.pct * 100)}%`;
    fila.querySelector('.barra-n').textContent = o.n;
    fila.classList.toggle('barra--lider', o.n > 0 && o.n === max);
    animarAncho(fila.querySelector('.barra-relleno'), `${(o.pct * 100).toFixed(2)}%`, animar);
  });
  const acciones = document.getElementById('acciones');
  if (cambio('acciones', String(mostrarCorrecta) + quizEval)) {
    acciones.innerHTML = quizEval
      ? `<button class="boton boton--chico${mostrarCorrecta ? '' : ' boton--primario'}" data-accion="correcta">
          ${icono(mostrarCorrecta ? 'ojo-no' : 'ojo')} ${mostrarCorrecta ? 'Ocultar la correcta' : 'Mostrar la correcta'} <kbd>C</kbd></button>` : '';
  }
  if (p.otro) actualizarOtros(p, a.otros);
}

function esperandoRespuestas(p, a) {
  const cuerpo = document.getElementById('cuerpo');
  if (cambio('barras', 'espera')) {
    cuerpo.innerHTML = `<div class="espera-resp">
      <p class="espera-n"><b id="esp-n">0</b> <span id="esp-de"></span></p>
      <div class="espera-pista"><div class="espera-relleno" id="esp-barra"></div></div>
      <ul class="espera-fichas">${(p.opciones || []).map((o, k) => {
        const f = ficha(k);
        return `<li style="--f-fondo:${f.fondo};--f-texto:${f.texto}">${forma(k)}<span>${esc(o)}</span></li>`;
      }).join('')}</ul>
    </div>`;
  }
  document.getElementById('esp-n').textContent = a.total;
  document.getElementById('esp-de').textContent = `de ${filas.length} ${a.total === 1 ? 'respondió' : 'respondieron'}`;
  document.getElementById('esp-barra').style.width = `${filas.length ? (a.total / filas.length) * 100 : 0}%`;
  const acciones = document.getElementById('acciones');
  if (cambio('acciones', 'espera')) {
    acciones.innerHTML = `<button class="boton boton--chico boton--primario" data-accion="correcta">${icono('ojo')} Mostrar la correcta <kbd>C</kbd></button>`;
  }
}

function actualizarOtros(p, otros) {
  const cont = document.getElementById('otros');
  const visibles = otros.filter((x) => !ocultas.has(`${p.id}_otro:${x.id}`));
  const abierto = revelado.has(p.id);
  if (!cambio('otros', `${abierto}|${visibles.map((x) => x.id).join(',')}`)) return;
  if (!otros.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = `<div class="otros-cabeza">
      <span>${icono('mensaje')} ${plural(otros.length, 'persona escribió', 'personas escribieron')} en «Otro»</span>
      <button class="boton boton--chico" data-accion="revelar">${icono(abierto ? 'ojo-no' : 'ojo')} ${abierto ? 'Ocultar' : 'Mostrar'}</button>
    </div>
    ${abierto ? `<ul class="otros-lista">${visibles.slice(-30).reverse().map((x) => `
      <li><span>${esc(x.texto)}</span><button data-ocultar="${esc(`${p.id}_otro:${x.id}`)}" aria-label="Ocultar">${icono('x')}</button></li>`).join('')}</ul>` : ''}`;
}

function actualizarEscala(p, a, animar) {
  const cuerpo = document.getElementById('cuerpo');
  if (cambio('escala', '1')) {
    cuerpo.innerHTML = `<div class="escala-res">
      <div class="escala-prom"><b id="prom">–</b><span>promedio</span><span class="escala-prom-emoji" id="prom-emoji"></span></div>
      <ol class="escala-cols">${ESCALA.map((e, k) => `
        <li class="escala-col" data-k="${k}">
          <span class="escala-col-n">0</span>
          <div class="escala-col-pista"><div class="escala-col-relleno"></div></div>
          <span class="escala-col-emoji">${e}</span><b>${k + 1}</b>
        </li>`).join('')}</ol>
    </div>
    ${p.min || p.max ? `<p class="escala-res-extremos"><span>1 = ${esc(p.min || '')}</span><span>5 = ${esc(p.max || '')}</span></p>` : ''}`;
    animar = true;
  }
  document.getElementById('prom').textContent = a.total ? a.promedio.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–';
  document.getElementById('prom-emoji').textContent = a.total ? ESCALA[Math.min(4, Math.max(0, Math.round(a.promedio) - 1))] : '';
  const max = Math.max(1, ...a.opciones.map((o) => o.n));
  a.opciones.forEach((o, k) => {
    const col = cuerpo.querySelector(`.escala-col[data-k="${k}"]`);
    col.querySelector('.escala-col-n').textContent = o.n;
    const rel = col.querySelector('.escala-col-relleno');
    const h = `${((o.n / max) * 100).toFixed(1)}%`;
    if (animar) requestAnimationFrame(() => requestAnimationFrame(() => { rel.style.height = h; }));
    else rel.style.height = h;
  });
}

function cortina(p, cantidad, que) {
  return `<div class="cortina">
    ${icono('ojo-no', 'cortina-icono')}
    <p class="cortina-titulo">${cantidad ? plural(cantidad, que[0], que[1]) : 'Todavía no hay respuestas'}</p>
    <p class="cortina-texto">${cantidad ? 'Lo que escribieron se muestra cuando tocás el botón (por si hay algo que no conviene proyectar).' : 'Van a ir llegando acá.'}</p>
    ${cantidad ? `<button class="boton boton--primario boton--grande-pres" data-accion="revelar">${icono('ojo')} Mostrar lo que escribieron</button>` : ''}
  </div>`;
}

function accionesRevelar(p, nOcultas) {
  const acciones = document.getElementById('acciones');
  const abierto = revelado.has(p.id);
  if (!cambio('acciones', `${abierto}|${nOcultas}`)) return;
  acciones.innerHTML = abierto ? `
    ${nOcultas ? `<button class="boton boton--chico boton--fantasma" data-accion="restaurar">${plural(nOcultas, 'oculta', 'ocultas')} · restaurar</button>` : ''}
    <button class="boton boton--chico" data-accion="revelar">${icono('ojo-no')} Ocultar todo <kbd>R</kbd></button>` : '';
}

function accionesOcultas(p, nOcultas) {
  const acciones = document.getElementById('acciones');
  if (!cambio('acciones', `ocultas|${nOcultas}`)) return;
  acciones.innerHTML = nOcultas ? `<button class="boton boton--chico boton--fantasma" data-accion="restaurar">${plural(nOcultas, 'oculta', 'ocultas')} · restaurar</button>` : '';
}

function actualizarMuro(p, a) {
  const cuerpo = document.getElementById('cuerpo');
  const limpios = a.textos.filter((x) => !esInapropiado(x.texto));
  const visibles = limpios.filter((x) => !ocultas.has(`${p.id}:${x.id}`));
  accionesRevelar(p, limpios.length - visibles.length);
  const abierto = revelado.has(p.id);
  if (!cambio('cuerpo', `${abierto}|${a.textos.length}|${visibles.map((x) => x.id).join(',')}`)) return;
  if (!abierto) { cuerpo.innerHTML = cortina(p, limpios.length, ['respuesta abierta', 'respuestas abiertas']); return; }
  const muestra = visibles.slice(-MAX_MURO).reverse();
  cuerpo.innerHTML = `<div class="muro">${muestra.map((x) => `
    <article class="nota${vistos.has(x.id) ? '' : ' nota--nueva'}">
      <p>${esc(x.texto)}</p>
      <button class="nota-ocultar" data-ocultar="${esc(`${p.id}:${x.id}`)}" aria-label="Ocultar esta respuesta">${icono('x')}</button>
    </article>`).join('')}</div>
    ${visibles.length > MAX_MURO ? `<p class="muro-mas">Y ${visibles.length - MAX_MURO} más: están todas en el CSV.</p>` : ''}`;
  muestra.forEach((x) => vistos.add(x.id));
}

const COLORES_NUBE = ['#0166FF', '#062B6B', '#047857', '#D92D20', '#6D28D9', '#0E7490', '#0077C2'];
function actualizarNube(p, a) {
  const cuerpo = document.getElementById('cuerpo');
  const limpias = a.palabras.filter((w) => !esInapropiado(w.texto));
  const visibles = limpias.filter((w) => !ocultas.has(`${p.id}#${w.k}`));
  accionesOcultas(p, limpias.length - visibles.length);
  const top = visibles.slice(0, MAX_NUBE);
  if (!cambio('cuerpo', `${top.map((w) => w.k + w.n).join(',')}`)) return;
  if (!top.length) { cuerpo.innerHTML = '<div class="cortina"><p class="cortina-titulo">Todavía no hay palabras</p><p class="cortina-texto">Van a ir apareciendo acá, más grandes las que más se repiten.</p></div>'; return; }
  const max = top[0]?.n || 1;
  // La más repetida al centro y el resto alternando a los costados.
  const orden = [];
  top.forEach((w, k) => (k % 2 ? orden.push(w) : orden.unshift(w)));
  cuerpo.innerHTML = `<div class="nube">${orden.map((w) => {
    const t = (0.95 + 3.4 * Math.pow(w.n / max, 0.75)).toFixed(2);
    const color = COLORES_NUBE[[...w.k].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORES_NUBE.length];
    return `<button class="nube-palabra" style="font-size:${t}rem;color:${color}" data-ocultar="${esc(`${p.id}#${w.k}`)}" title="${plural(w.n, 'vez', 'veces')} · tocá para ocultar">${esc(w.texto)}</button>`;
  }).join('')}</div>`;
}

function ranking() {
  return filas.filter((f) => !ocultas.has(`alias:${f.id}`))
    .slice().sort((x, y) => y.puntaje - x.puntaje || x.id - y.id);
}

function actualizarLobby() {
  const lobby = document.getElementById('lobby');
  if (!lobby) return;
  const jugadores = filas.filter((f) => !ocultas.has(`alias:${f.id}`));
  const ultimos = jugadores.slice(-MAX_LOBBY).reverse();
  if (!cambio('lobby', ultimos.map((f) => f.id).join(','))) return;
  lobby.innerHTML = ultimos.map((f) => `<li><button class="lobby-chip${vistos.has('l' + f.id) ? '' : ' lobby-chip--nuevo'}" data-ocultar="alias:${f.id}" title="Tocá para ocultar este apodo">
      <span aria-hidden="true">${emojiDe(f.alias || '')}</span>${esc(aliasSeguro(f.alias))}</button></li>`).join('')
    + (jugadores.length > MAX_LOBBY ? `<li class="lobby-mas">+${jugadores.length - MAX_LOBBY}</li>` : '');
  ultimos.forEach((f) => vistos.add('l' + f.id));
}

function actualizarPodio(animar) {
  const r = ranking();
  if (!cambio('podio', r.slice(0, 10).map((f) => `${f.id}:${f.puntaje}`).join(','))) return;
  const podio = document.getElementById('podio');
  if (!r.length) {
    podio.innerHTML = '<p class="podio-vacio">Cuando alguien termine el quiz, aparece acá.</p>';
    document.getElementById('podio-resto').innerHTML = '';
    return;
  }
  const max = r[0].puntaje || 1;
  const lugar = (f, k) => f ? `<div class="podio-lugar podio-lugar--${k + 1}">
      <button class="podio-quien" data-ocultar="alias:${f.id}" title="Tocá para ocultar este apodo">
        <span class="podio-avatar">${emojiDe(f.alias || '')}</span>
        <span class="podio-alias">${esc(aliasSeguro(f.alias))}</span>
        <span class="podio-pts">${Number(f.puntaje).toLocaleString('es-AR')} pts</span>
      </button>
      <div class="podio-columna" style="--k:${(Math.max(0, f.puntaje) / max).toFixed(3)}"><b>${['🥇', '🥈', '🥉'][k]}</b></div>
    </div>` : '<div class="podio-lugar podio-lugar--vacio"></div>';
  podio.innerHTML = lugar(r[1], 1) + lugar(r[0], 0) + lugar(r[2], 2);
  if (!animar) podio.classList.add('sin-animar');
  document.getElementById('podio-resto').innerHTML = r.slice(3, 10).map((f, k) => `
    <li><span class="podio-resto-pos">${k + 4}</span><span>${emojiDe(f.alias || '')}</span>
    <span class="podio-resto-alias">${esc(aliasSeguro(f.alias))}</span><b>${Number(f.puntaje).toLocaleString('es-AR')}</b></li>`).join('');
}

/* ── Acciones ── */
function alternarRevelar() {
  if (slide < 1 || slide > n()) return;
  const p = def.preguntas[slide - 1];
  if (revelado.has(p.id)) revelado.delete(p.id); else revelado.add(p.id);
  actualizar(false);
  publicar();
}

function alternarCorrecta() {
  if (slide < 1 || slide > n()) return;
  const p = def.preguntas[slide - 1];
  if (!esQuiz || !evaluable(p)) return;
  if (conCorrecta.has(p.id)) conCorrecta.delete(p.id); else { conCorrecta.add(p.id); confeti({ cantidad: 80, duracion: 1800 }); }
  delete firmas.acciones;
  actualizar(true);
  publicar();
}

function pantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('El navegador no permitió la pantalla completa'));
}

async function borrarTodo() {
  const r = prompt(`Se van a borrar las ${filas.length} respuestas de «${def.titulo}». No se puede deshacer.\n\nEscribí BORRAR para confirmar:`);
  if (r?.trim().toUpperCase() !== 'BORRAR') return;
  try {
    const cuantas = await api.borrarRespuestas(clave, codigo);
    filas = []; ultimo = 0; vistos.clear(); ocultas.clear(); almacen.guardar(K_OCULTAS, []);
    irA(slide, false);
    toast(`Listo: se borraron ${plural(cuantas, 'respuesta', 'respuestas')}`);
  } catch {
    toast('No se pudieron borrar. Probá de nuevo.');
  }
}

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'form-clave') return;
  e.preventDefault();
  clave = document.getElementById('clave').value.trim();
  if (clave) cargar();
});

app.addEventListener('click', async (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) return irA(Number(ir.dataset.ir));
  const oc = e.target.closest('[data-ocultar]');
  if (oc) {
    ocultas.add(oc.dataset.ocultar);
    almacen.guardar(K_OCULTAS, [...ocultas]);
    return actualizar(false);
  }
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  b.closest('details')?.removeAttribute('open');
  const a = b.dataset.accion;
  if (a === 'recargar') location.reload();
  else if (a === 'anterior') irA(slide - 1);
  else if (a === 'siguiente') irA(slide + 1);
  else if (a === 'revelar') alternarRevelar();
  else if (a === 'correcta') alternarCorrecta();
  else if (a === 'restaurar') {
    const p = def.preguntas[slide - 1];
    [...ocultas].filter((x) => x.startsWith(p.id + ':') || x.startsWith(p.id + '#')).forEach((x) => ocultas.delete(x));
    almacen.guardar(K_OCULTAS, [...ocultas]);
    actualizar(false);
  }
  else if (a === 'pantalla-completa') pantallaCompleta();
  else if (a === 'copiar') toast(await copiar(urlQuiz) ? 'Link copiado' : urlQuiz);
  else if (a === 'csv') descargar(`${codigo}-respuestas.csv`, aCsv(def, filas));
  else if (a === 'borrar') borrarTodo();
  else if (a === 'botonera') mostrarBotonera();
  if (a === 'anterior' || a === 'siguiente') b.blur();
});

document.addEventListener('click', (e) => {
  const abierto = document.querySelector('details.menu[open]');
  if (abierto && !abierto.contains(e.target)) abierto.removeAttribute('open');
});

document.addEventListener('keydown', (e) => {
  if (!def || !document.getElementById('pres')) return;
  const t = e.target instanceof Element ? e.target : document.body;
  if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const enBoton = t.closest('button, summary, a');
  const k = e.key;
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !enBoton)) { e.preventDefault(); irA(slide + 1); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); irA(slide - 1); }
  else if (k === 'Home' || k === 'q' || k === 'Q') irA(0);
  else if (k === 'End') irA(ultimaSlide());
  else if (k === 'f' || k === 'F') pantallaCompleta();
  else if (k === 'r' || k === 'R') alternarRevelar();
  else if (k === 'c' || k === 'C') alternarCorrecta();
  else if (k === 'b' || k === 'B') mostrarBotonera();
  else if (k === 'Escape') document.getElementById('modal')?.remove();
  else if (/^[1-9]$/.test(k)) irA(Number(k));
});

// QR para abrir la botonera en el celular del presentador (pide la clave).
function mostrarBotonera() {
  document.getElementById('modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-t">
    <div class="modal-caja">
      <h2 id="modal-t">Botonera en tu celular</h2>
      <p>Escaneá este código con <b>tu</b> celular para pasar las preguntas y mostrar resultados desde ahí. Pide la clave del equipo.</p>
      <div class="modal-qr">${qrHtml(urlControl)}</div>
      <p class="modal-url">${esc(urlControl.replace(/^https?:\/\//, ''))}</p>
      <button class="boton boton--primario" data-accion="cerrar-modal">Listo</button>
    </div>
  </div>`);
  document.querySelector('#modal [data-accion="cerrar-modal"]').focus();
}
document.addEventListener('click', (e) => {
  const m = document.getElementById('modal');
  if (!m) return;
  if (e.target === m || e.target.closest('#modal [data-accion="cerrar-modal"]')) m.remove();
});
