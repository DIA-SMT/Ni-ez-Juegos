// Panel del equipo: lista de quizzes, editor y acciones (presentar, duplicar,
// cerrar, exportar). Todo pide la clave del equipo, que queda guardada en
// este navegador hasta tocar "Salir".
import { api, MODO_LOCAL, clave as claveEquipo } from './api.js';
import { OTRO, TIPOS, TEMAS, aplicarTema, ficha, forma, evaluable, aCsv, contactosCsv, nuevoId } from './juego.js';
import { icono } from './iconos.js';
import { esc, toast, descargar, copiar, plural } from './util.js';

const app = document.getElementById('app');
let clave = MODO_LOCAL ? 'local' : claveEquipo.leer();
let quizzes = [];
let ed = null;            // { id, codigo, def, abierto, respuestas } en edición
let sucio = false;
let guardando = false;
let codigoTocado = false;
let errores = [];

const PLANTILLAS = {
  quiz: {
    emoji: '🎮', nombre: 'Quiz con puntaje', texto: 'Respuestas correctas, apodos, rachas y podio.',
    def: {
      titulo: 'Quiz nuevo', etiqueta: 'Quiz', subtitulo: '', modo: 'quiz', ritmo: 'guiado', tema: 'violeta', celebrar: true,
      intro: '¡Respondé y sumá puntos! Cada acierto seguido vale más.',
      cierre: { titulo: '¡Gracias por jugar!', texto: '' }, ayuda: null,
      preguntas: [
        { tipo: 'unica', texto: '¿En qué año se declaró la Independencia en San Miguel de Tucumán?', opciones: ['1810', '1816', '1853', '1880'], correcta: '1816' },
        { tipo: 'nube', texto: 'En una palabra: ¿qué te llevás de hoy?', max: 3 },
      ],
    },
  },
  encuesta: {
    emoji: '📋', nombre: 'Encuesta', texto: 'Anónima y sin puntaje. Para conocer dudas y opiniones.',
    def: {
      titulo: 'Encuesta nueva', etiqueta: 'Encuesta', subtitulo: '', modo: 'encuesta', ritmo: 'guiado', tema: 'azul', celebrar: true,
      intro: 'Queremos conocer tu opinión. La encuesta es anónima.',
      cierre: { titulo: '¡Gracias por participar!', texto: '' }, ayuda: null,
      preguntas: [{ tipo: 'unica', texto: '', opciones: ['Sí', 'No', 'No sé'] }],
    },
  },
  rompehielo: {
    emoji: '☁️', nombre: 'Rompehielo', texto: 'Escala de emojis y nube de palabras para arrancar.',
    def: {
      titulo: '¿Cómo llegamos hoy?', etiqueta: 'Para arrancar', subtitulo: '', modo: 'encuesta', ritmo: 'guiado', tema: 'coral', celebrar: true,
      intro: 'Dos preguntas cortitas para conocernos.',
      cierre: { titulo: '¡Listo, gracias!', texto: 'Mirá la pantalla: ahí están las respuestas de todos.' }, ayuda: null,
      preguntas: [
        { tipo: 'escala', texto: '¿Con cuánta energía llegás hoy?', min: 'Poquita', max: '¡Toda!' },
        { tipo: 'nube', texto: 'En una palabra: ¿qué esperás de este encuentro?', max: 3 },
      ],
    },
  },
};

/* ── Arranque y rutas ── */
if (MODO_LOCAL) document.body.insertAdjacentHTML('beforeend', '<p class="aviso-local">MODO LOCAL</p>');
window.addEventListener('hashchange', () => { if (sucio && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return; sucio = false; ruta(); });
window.addEventListener('beforeunload', (e) => { if (sucio) { e.preventDefault(); e.returnValue = ''; } });
if (clave) cargarYRuta(); else pedirClave();

async function cargarYRuta() {
  try {
    quizzes = await api.quizzes(clave);
    if (!MODO_LOCAL) claveEquipo.guardar(clave);
    ruta();
  } catch (e) {
    if (e.codigo === 'clave') { claveEquipo.olvidar(); pedirClave(clave ? 'La clave no es correcta.' : ''); }
    else app.innerHTML = `<div class="mensaje marca"><div class="mensaje-caja"><h1>No se pudo conectar</h1><p>Revisá la conexión a internet.</p>
      <button class="boton boton--amarillo" data-accion="recargar">Reintentar</button></div></div>`;
  }
}

function ruta() {
  const [, vista, id] = location.hash.replace(/^#/, '').split('/');
  aplicarTema('azul');
  if (vista === 'editar') {
    const q = quizzes.find((x) => x.id === id);
    if (!q) { location.hash = '#/'; return; }
    abrirEditor(structuredClone(q));
  } else if (vista === 'nuevo') {
    vistaPlantillas();
  } else vistaLista();
}

function pedirClave(error = '') {
  app.innerHTML = `<div class="mensaje marca"><form class="clave-tarjeta" id="form-clave">
    <img src="/img/isologo.png" width="56" height="56" alt="">
    <h1>Panel del equipo</h1>
    <p>Creá y gestioná los quizzes y encuestas en vivo de la Municipalidad.</p>
    <label class="etiqueta" for="clave">Clave del equipo</label>
    <input id="clave" class="campo" type="password" autocomplete="current-password" required>
    ${error ? `<p class="clave-error" role="alert">${esc(error)}</p>` : ''}
    <button class="boton boton--primario">Entrar ${icono('flecha-der')}</button>
  </form></div>`;
  document.getElementById('clave').focus();
}

function cabecera(extra = '') {
  return `<header class="panel-top marca"><div class="panel-ancho panel-top-fila">
    <a href="#/" class="panel-marca" aria-label="Volver a la lista">
      <img class="logo-ciudad" src="/img/logo-smt-blanco.png" width="507" height="206" alt="Ciudad de San Miguel de Tucumán">
    </a>
    <div class="panel-top-titulo"><p class="chip-marca">Panel del equipo</p><h1>Quizzes en vivo</h1></div>
    ${extra}
    ${MODO_LOCAL ? '' : `<button class="boton boton--chico boton--claro" data-accion="salir">${icono('salir')}<span>Salir</span></button>`}
  </div></header>`;
}

/* ── Lista ── */
function vistaLista() {
  document.title = 'Panel · Quizzes en vivo';
  const tarjetas = quizzes.map((q) => {
    const t = TEMAS[q.def.tema] || TEMAS.azul;
    const quiz = q.def.modo === 'quiz';
    return `<li class="tarjeta" style="--t-color:${t.color};--t-suave:${t.suave}">
      <div class="tarjeta-cuerpo">
        <div class="tarjeta-chips">
          <span class="chip chip--modo">${quiz ? '🎮 Quiz' : '📋 Encuesta'}</span>
          ${q.def.ritmo === 'guiado' ? '<span class="chip chip--ritmo">🎤 Guiado</span>' : ''}
          <span class="chip ${q.abierto ? 'chip--abierto' : 'chip--cerrado'}">${q.abierto ? 'Abierto' : 'Cerrado'}</span>
        </div>
        <h3 class="tarjeta-titulo"><a href="#/editar/${esc(q.id)}">${esc(q.def.titulo || 'Sin título')}</a></h3>
        <p class="tarjeta-meta">${plural(q.def.preguntas.length, 'pregunta', 'preguntas')} · <b>${plural(q.respuestas || 0, 'respuesta', 'respuestas')}</b>${q.def.contacto && q.def.contacto !== 'no' ? ` · <b>${plural(q.contactos || 0, 'contacto', 'contactos')}</b>` : ''}</p>
        <p class="tarjeta-link">${icono('enlace')} ${esc(location.host)}/<b>${esc(q.codigo)}</b></p>
      </div>
      <div class="tarjeta-acciones">
        <a class="boton boton--primario boton--chico" href="/presentar/${esc(q.codigo)}" target="_blank" rel="noopener">${icono('play')} Presentar</a>
        <a class="boton boton--chico" href="#/editar/${esc(q.id)}">${icono('lapiz')} Editar</a>
        <details class="menu">
          <summary class="boton boton--chico boton--icono" aria-label="Más acciones">${icono('mas')}</summary>
          <div class="menu-lista">
            <a href="/control/${esc(q.codigo)}" target="_blank" rel="noopener">${icono('qr')} Botonera en el celular</a>
            <button data-accion="copiar" data-codigo="${esc(q.codigo)}">${icono('enlace')} Copiar link para participar</button>
            <a href="/${esc(q.codigo)}?prueba" target="_blank" rel="noopener">${icono('ojo')} Probar como participante</a>
            <button data-accion="abrir-cerrar" data-id="${esc(q.id)}">${icono(q.abierto ? 'candado' : 'candado_abierto')} ${q.abierto ? 'Cerrar respuestas' : 'Abrir respuestas'}</button>
            <button data-accion="duplicar" data-id="${esc(q.id)}">${icono('copiar')} Duplicar</button>
            <button data-accion="csv" data-codigo="${esc(q.codigo)}">${icono('descargar')} Descargar respuestas (CSV)</button>
            <button data-accion="csv-contactos" data-codigo="${esc(q.codigo)}">${icono('telefono')} Descargar contactos (CSV)</button>
            <button data-accion="vaciar" data-codigo="${esc(q.codigo)}">${icono('recargar')} Borrar respuestas</button>
            <button data-accion="eliminar" data-id="${esc(q.id)}" class="menu-peligro">${icono('papelera')} Eliminar quiz</button>
          </div>
        </details>
      </div>
    </li>`;
  }).join('');
  app.innerHTML = `${cabecera()}
    <main class="panel-ancho panel-cuerpo">
      <div class="panel-barra">
        <h2>Tus quizzes <span class="contador">${quizzes.length}</span></h2>
        <a class="boton boton--primario" href="#/nuevo">${icono('sumar')} Nuevo quiz</a>
      </div>
      ${quizzes.length ? `<ul class="tarjetas">${tarjetas}</ul>` : `
        <div class="vacio"><p class="vacio-emoji">🎉</p><h3>Todavía no hay quizzes</h3><p>Creá el primero: en dos minutos está listo para proyectar.</p>
        <a class="boton boton--primario" href="#/nuevo">${icono('sumar')} Nuevo quiz</a></div>`}
    </main>`;
}

function vistaPlantillas() {
  document.title = 'Nuevo quiz · Panel';
  app.innerHTML = `${cabecera()}
    <main class="panel-ancho panel-cuerpo">
      <div class="panel-barra"><h2>¿Qué querés armar?</h2><a class="boton boton--chico boton--fantasma" href="#/">${icono('flecha-izq')} Volver</a></div>
      <ul class="plantillas">${Object.entries(PLANTILLAS).map(([k, p]) => `
        <li><button class="plantilla" data-accion="plantilla" data-k="${k}" style="--t-color:${TEMAS[p.def.tema].color};--t-suave:${TEMAS[p.def.tema].suave}">
          <span class="plantilla-emoji">${p.emoji}</span><b>${esc(p.nombre)}</b><span>${esc(p.texto)}</span>
        </button></li>`).join('')}</ul>
    </main>`;
}

/* ── Editor ── */
function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
}
const codigoLibre = (base) => {
  let c = slug(base) || 'quiz';
  if (c.length < 3) c += '-quiz';
  if (!quizzes.some((q) => q.codigo === c && q.id !== ed?.id)) return c;
  return `${c.slice(0, 34)}-${Math.random().toString(36).slice(2, 5)}`;
};

function nuevoDesdePlantilla(k) {
  const def = structuredClone(PLANTILLAS[k].def);
  def.preguntas.forEach((p) => { p.id = nuevoId(); });
  ed = { id: null, codigo: '', def, abierto: true, respuestas: 0 };
  ed.codigo = codigoLibre(def.titulo);
  codigoTocado = false;
  sucio = true;
  history.replaceState(null, '', '#/editar/nuevo');
  renderEditor();
}

function abrirEditor(q) {
  ed = q;
  ed.def.preguntas.forEach((p) => { p.id ||= nuevoId(); });
  codigoTocado = true;
  sucio = false;
  errores = [];
  renderEditor();
}

function renderEditor() {
  const d = ed.def;
  aplicarTema(d.tema);
  document.title = `${d.titulo || 'Quiz'} · Editor`;
  const esQuiz = d.modo === 'quiz';
  const guiado = d.ritmo === 'guiado';
  const lineas = (d.ayuda?.lineas || []).map((l) => `${l.numero}${l.detalle ? ' — ' + l.detalle : ''}`).join('\n');
  app.innerHTML = `
    <header class="editor-top"><div class="panel-ancho editor-top-fila">
      <a href="#/" class="boton boton--chico boton--fantasma">${icono('flecha-izq')}<span>Volver</span></a>
      <p class="editor-estado" id="estado"></p>
      <span class="espacio"></span>
      <button class="boton boton--chico" data-accion="probar">${icono('ojo')}<span>Probar</span></button>
      ${ed.id ? `<a class="boton boton--chico" href="/presentar/${esc(ed.codigo)}" target="_blank" rel="noopener">${icono('play')}<span>Presentar</span></a>` : ''}
      <button class="boton boton--chico boton--primario" data-accion="guardar">${icono('check')} Guardar</button>
    </div></header>
    <main class="panel-ancho editor">
      ${errores.length ? `<div class="editor-errores" role="alert" id="errores"><b>Antes de guardar, revisá:</b><ul>${errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      ${ed.respuestas ? `<p class="editor-aviso">${icono('usuarios')} Este quiz ya tiene ${plural(ed.respuestas, 'respuesta', 'respuestas')}. Si cambiás opciones, las respuestas viejas pueden dejar de coincidir.</p>` : ''}

      <section class="editor-portada marca">
        <label class="sr-only" for="f-etiqueta">Etiqueta</label>
        <input id="f-etiqueta" class="portada-etiqueta" data-campo="etiqueta" maxlength="60" placeholder="Etiqueta (ej.: Encuesta)" value="${esc(d.etiqueta || '')}">
        <label class="sr-only" for="f-titulo">Título</label>
        <textarea id="f-titulo" class="portada-titulo" data-campo="titulo" rows="2" maxlength="140" placeholder="Título del quiz">${esc(d.titulo || '')}</textarea>
        <label class="sr-only" for="f-subtitulo">Subtítulo</label>
        <input id="f-subtitulo" class="portada-subtitulo" data-campo="subtitulo" maxlength="120" placeholder="Subtítulo (opcional)" value="${esc(d.subtitulo || '')}">
      </section>

      <section class="editor-bloque">
        <h2 class="bloque-titulo">Presentación</h2>
        <div>
          <label class="etiqueta" for="f-intro">Texto de bienvenida <small>· lo leen antes de empezar</small></label>
          <textarea id="f-intro" class="campo" data-campo="intro" rows="3" maxlength="600">${esc(d.intro || '')}</textarea>
        </div>
        <div>
          <span class="etiqueta">Modo</span>
          <div class="modos">
            <label class="modo-op"><input type="radio" name="modo" value="encuesta" data-campo="modo"${esQuiz ? '' : ' checked'}>
              <span class="modo-emoji">📋</span><b>Encuesta</b><small>Anónima, sin puntaje. Ideal para temas sensibles.</small></label>
            <label class="modo-op"><input type="radio" name="modo" value="quiz" data-campo="modo"${esQuiz ? ' checked' : ''}>
              <span class="modo-emoji">🎮</span><b>Quiz con puntaje</b><small>Apodos, respuestas correctas, rachas y podio.</small></label>
          </div>
        </div>
        <div>
          <span class="etiqueta">Ritmo</span>
          <div class="modos">
            <label class="modo-op"><input type="radio" name="ritmo" value="guiado" data-campo="ritmo"${guiado ? ' checked' : ''}>
              <span class="modo-emoji">🎤</span><b>Guiado</b><small>Vos activás cada pregunta desde la pantalla o la botonera del celular.</small></label>
            <label class="modo-op"><input type="radio" name="ritmo" value="libre" data-campo="ritmo"${guiado ? '' : ' checked'}>
              <span class="modo-emoji">🏃</span><b>Libre</b><small>Cada uno responde de corrido, a su ritmo.</small></label>
          </div>
        </div>
        <div class="editor-fila">
          <div>
            <span class="etiqueta">Color</span>
            <div class="temas">${Object.entries(TEMAS).map(([k, t]) => `
              <label class="tema-op" style="--c:${t.color}" title="${t.nombre}">
                <input type="radio" name="tema" value="${k}" data-campo="tema"${d.tema === k ? ' checked' : ''}><span class="sr-only">${t.nombre}</span>
              </label>`).join('')}</div>
          </div>
          <div class="editor-codigo">
            <label class="etiqueta" for="f-codigo">Link para participar</label>
            <div class="codigo-campo"><span>${esc(location.host)}/</span>
              <input id="f-codigo" data-campo="codigo" maxlength="40" spellcheck="false" autocapitalize="off" value="${esc(ed.codigo)}"></div>
            <small class="ayuda-campo">Letras, números y guiones. Corto y fácil de dictar.</small>
          </div>
        </div>
        <div>
          <span class="etiqueta">Datos de contacto <small>· nombre y teléfono, se guardan aparte de las respuestas</small></span>
          <div class="segmento">${[['no', 'No pedir'], ['opcional', 'Opcional'], ['obligatorio', 'Obligatorio']].map(([v, t]) => `
            <label class="segmento-op"><input type="radio" name="contacto" value="${v}" data-campo="contacto"${(d.contacto || 'no') === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
        </div>
        <div class="editor-interruptores">
          <label class="interruptor"><input type="checkbox" data-campo="abierto"${ed.abierto ? ' checked' : ''}><span class="interruptor-pista"></span>Recibe respuestas</label>
          <label class="interruptor"><input type="checkbox" data-campo="celebrar"${d.celebrar ? ' checked' : ''}><span class="interruptor-pista"></span>Papel picado al terminar</label>
        </div>
      </section>

      <section class="editor-bloque">
        <h2 class="bloque-titulo">Preguntas <span class="contador">${d.preguntas.length}</span></h2>
        ${esQuiz ? `<p class="editor-nota">${icono('rayo')} En modo quiz, marcá la respuesta correcta con ${icono('check')}: suma 100 puntos y +25 por cada acierto seguido.</p>` : ''}
        <ol class="pqs">${d.preguntas.map((p, i) => vistaPreguntaEd(p, i, esQuiz)).join('')}</ol>
        <div class="agregar">
          <span class="etiqueta">Agregar pregunta</span>
          <div class="agregar-tipos">${Object.entries(TIPOS).map(([k, t]) => `
            <button class="agregar-tipo" data-accion="agregar" data-tipo="${k}">${icono(t.icono)}<span>${esc(t.nombre)}</span></button>`).join('')}</div>
        </div>
      </section>

      <section class="editor-bloque">
        <h2 class="bloque-titulo">Al terminar</h2>
        <div class="editor-fila">
          <div><label class="etiqueta" for="f-cierre-t">Título del final</label>
            <input id="f-cierre-t" class="campo" data-campo="cierre.titulo" maxlength="100" value="${esc(d.cierre?.titulo || '')}" placeholder="¡Gracias por participar!"></div>
          <div><label class="etiqueta" for="f-cierre-x">Mensaje <small>· opcional</small></label>
            <input id="f-cierre-x" class="campo" data-campo="cierre.texto" maxlength="300" value="${esc(d.cierre?.texto || '')}"></div>
        </div>
        <label class="interruptor"><input type="checkbox" data-accion="ayuda"${d.ayuda ? ' checked' : ''}><span class="interruptor-pista"></span>Mostrar caja «¿Necesitás ayuda ahora?» con teléfonos</label>
        ${d.ayuda ? `<div class="editor-fila">
          <div><label class="etiqueta" for="f-ayuda-t">Texto</label>
            <textarea id="f-ayuda-t" class="campo" data-campo="ayuda.texto" rows="3" maxlength="400">${esc(d.ayuda.texto || '')}</textarea></div>
          <div><label class="etiqueta" for="f-ayuda-l">Teléfonos <small>· uno por línea: número — detalle</small></label>
            <textarea id="f-ayuda-l" class="campo" data-campo="ayuda.lineas" rows="3" placeholder="911 — Emergencias">${esc(lineas)}</textarea></div>
        </div>` : ''}
      </section>

      <div class="editor-pie">
        ${ed.id ? `<button class="boton boton--chico boton--peligro" data-accion="eliminar" data-id="${esc(ed.id)}">${icono('papelera')} Eliminar quiz</button>` : ''}
        <span class="espacio"></span>
        <button class="boton boton--primario" data-accion="guardar">${icono('check')} Guardar</button>
      </div>
    </main>`;
  marcarEstado();
}

function vistaPreguntaEd(p, i, esQuiz) {
  const n = ed.def.preguntas.length;
  let extra = '';
  if (p.tipo === 'unica' || p.tipo === 'multiple') {
    const correctas = p.tipo === 'unica' ? [p.correcta] : (p.correctas || []);
    extra = `<ol class="pq-opciones">${(p.opciones || []).map((o, k) => {
      const f = ficha(k);
      const ok = esQuiz && o && correctas.includes(o);
      return `<li class="pq-opcion${ok ? ' pq-opcion--ok' : ''}">
        <span class="pq-forma" style="--f-fondo:${f.fondo};--f-texto:${f.texto}">${forma(k)}</span>
        <label class="sr-only" for="o-${i}-${k}">Opción ${k + 1}</label>
        <input id="o-${i}-${k}" class="campo" data-pi="${i}" data-o="${k}" maxlength="140" placeholder="Opción ${k + 1}" value="${esc(o)}">
        ${esQuiz ? `<button class="pq-correcta" data-accion="correcta" data-pi="${i}" data-o="${k}" aria-pressed="${ok}" title="Marcar como correcta">${icono('check')}</button>` : ''}
        <button class="pq-quitar" data-accion="quitar-op" data-pi="${i}" data-o="${k}" aria-label="Quitar opción ${k + 1}"${(p.opciones || []).length <= 2 ? ' disabled' : ''}>${icono('x')}</button>
      </li>`;
    }).join('')}</ol>
    <div class="pq-fila">
      ${(p.opciones || []).length < 6 ? `<button class="boton boton--chico" data-accion="agregar-op" data-pi="${i}">${icono('sumar')} Opción</button>` : '<small class="ayuda-campo">Máximo 6 opciones</small>'}
      <label class="interruptor interruptor--chico"><input type="checkbox" data-pi="${i}" data-pcampo="otro"${p.otro ? ' checked' : ''}><span class="interruptor-pista"></span>Permitir «Otro» con texto</label>
    </div>`;
  } else if (p.tipo === 'escala') {
    extra = `<div class="editor-fila">
      <div><label class="etiqueta" for="mn-${i}">1 significa…</label><input id="mn-${i}" class="campo" data-pi="${i}" data-pcampo="min" maxlength="40" placeholder="Nada" value="${esc(p.min || '')}"></div>
      <div><label class="etiqueta" for="mx-${i}">5 significa…</label><input id="mx-${i}" class="campo" data-pi="${i}" data-pcampo="max" maxlength="40" placeholder="Muchísimo" value="${esc(p.max || '')}"></div>
    </div>`;
  } else if (p.tipo === 'nube') {
    extra = `<div class="pq-fila"><label class="etiqueta" for="np-${i}">Palabras por persona</label>
      <select id="np-${i}" class="campo campo--corto" data-pi="${i}" data-pcampo="max">${[1, 2, 3, 4, 5].map((v) => `<option${(p.max || 3) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>`;
  } else if (p.tipo === 'texto') {
    extra = `<div class="editor-fila">
      <div><label class="etiqueta" for="ph-${i}">Texto de ayuda en el campo</label><input id="ph-${i}" class="campo" data-pi="${i}" data-pcampo="placeholder" maxlength="80" placeholder="Escribí acá…" value="${esc(p.placeholder || '')}"></div>
      <div><label class="etiqueta" for="nt-${i}">Aclaración <small>· opcional</small></label><input id="nt-${i}" class="campo" data-pi="${i}" data-pcampo="nota" maxlength="120" value="${esc(p.nota || '')}"></div>
    </div>`;
  }
  const falta = esQuiz && (p.tipo === 'unica' || p.tipo === 'multiple') && !evaluable(p);
  return `<li class="pq" id="pq-${i}">
    <div class="pq-cabeza">
      <span class="pq-num">${i + 1}</span>
      <label class="sr-only" for="tp-${i}">Tipo de pregunta</label>
      <select id="tp-${i}" class="pq-tipo" data-pi="${i}" data-pcampo="tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}"${p.tipo === k ? ' selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>
      ${falta ? '<span class="pq-falta">Sin respuesta correcta: no suma puntos</span>' : ''}
      <span class="espacio"></span>
      <button class="pq-btn" data-accion="subir" data-pi="${i}" aria-label="Subir"${i === 0 ? ' disabled' : ''}>${icono('chevron-arr')}</button>
      <button class="pq-btn" data-accion="bajar" data-pi="${i}" aria-label="Bajar"${i === n - 1 ? ' disabled' : ''}>${icono('chevron-aba')}</button>
      <button class="pq-btn" data-accion="duplicar-p" data-pi="${i}" aria-label="Duplicar pregunta">${icono('copiar')}</button>
      <button class="pq-btn pq-btn--peligro" data-accion="borrar-p" data-pi="${i}" aria-label="Borrar pregunta">${icono('papelera')}</button>
    </div>
    <label class="sr-only" for="pt-${i}">Texto de la pregunta ${i + 1}</label>
    <textarea id="pt-${i}" class="campo pq-texto" data-pi="${i}" data-pcampo="texto" rows="2" maxlength="300" placeholder="Escribí la pregunta…">${esc(p.texto || '')}</textarea>
    ${extra}
  </li>`;
}

function marcarEstado(texto) {
  const el = document.getElementById('estado');
  if (!el) return;
  el.textContent = texto || (guardando ? 'Guardando…' : sucio ? 'Cambios sin guardar' : ed.id ? 'Todo guardado' : 'Nuevo');
  el.dataset.estado = guardando ? 'guardando' : sucio ? 'sucio' : 'ok';
}

function tocar() { sucio = true; marcarEstado(); }

function validar() {
  const e = [];
  const d = ed.def;
  if (!d.titulo?.trim()) e.push('Falta el título.');
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(ed.codigo)) e.push('El link tiene que tener entre 3 y 40 letras, números o guiones (sin empezar ni terminar con guión).');
  if (['panel', 'presentar', 'control', 'api', 'css', 'js', 'img', 'index', 'responder'].includes(ed.codigo)) e.push(`«${ed.codigo}» está reservado: elegí otro link.`);
  if (!d.preguntas.length) e.push('Agregá al menos una pregunta.');
  d.preguntas.forEach((p, i) => {
    if (!p.texto?.trim()) e.push(`La pregunta ${i + 1} no tiene texto.`);
    if (p.tipo === 'unica' || p.tipo === 'multiple') {
      const ops = (p.opciones || []).map((o) => o.trim());
      if (ops.some((o) => !o)) e.push(`La pregunta ${i + 1} tiene opciones vacías.`);
      if (new Set(ops).size !== ops.length) e.push(`La pregunta ${i + 1} tiene opciones repetidas.`);
      if (ops.length < 2) e.push(`La pregunta ${i + 1} necesita al menos 2 opciones.`);
      if (p.otro && ops.includes(OTRO)) e.push(`La pregunta ${i + 1} ya tiene una opción «Otro»: sacala o desactivá «Permitir Otro».`);
    }
  });
  return e;
}

// Deja la definición prolija antes de guardarla: sin espacios de más y sin
// campos que no correspondan al tipo de cada pregunta.
function limpiarDef(d) {
  const limpio = structuredClone(d);
  limpio.titulo = limpio.titulo.trim();
  limpio.preguntas = limpio.preguntas.map((p) => {
    const base = { id: p.id, tipo: p.tipo, texto: p.texto.trim() };
    if (p.tipo === 'unica' || p.tipo === 'multiple') {
      base.opciones = p.opciones.map((o) => o.trim());
      if (p.otro) base.otro = true;
      if (p.exclusiva && base.opciones.includes(p.exclusiva)) base.exclusiva = p.exclusiva;
      if (p.tipo === 'unica' && p.correcta && base.opciones.includes(p.correcta.trim())) base.correcta = p.correcta.trim();
      if (p.tipo === 'multiple') {
        const cs = (p.correctas || []).map((c) => c.trim()).filter((c) => base.opciones.includes(c));
        if (cs.length) base.correctas = [...new Set(cs)];
      }
    } else if (p.tipo === 'escala') { base.min = (p.min || '').trim(); base.max = (p.max || '').trim(); }
    else if (p.tipo === 'nube') base.max = Number(p.max) || 3;
    else if (p.tipo === 'texto') { if (p.placeholder) base.placeholder = p.placeholder.trim(); if (p.nota) base.nota = p.nota.trim(); }
    return base;
  });
  return limpio;
}

async function guardar() {
  if (guardando) return false;
  errores = validar();
  if (errores.length) {
    renderEditor();
    document.getElementById('errores')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  guardando = true;
  marcarEstado();
  try {
    const r = await api.guardar(clave, { id: ed.id, codigo: ed.codigo, def: limpiarDef(ed.def), abierto: ed.abierto });
    const nuevo = !ed.id;
    ed = { ...ed, id: r.id, codigo: r.codigo, def: r.def, abierto: r.abierto };
    const i = quizzes.findIndex((q) => q.id === r.id);
    const fila = { ...r, respuestas: ed.respuestas || 0 };
    if (i >= 0) quizzes[i] = fila; else quizzes.unshift(fila);
    guardando = false;
    sucio = false;
    errores = [];
    if (nuevo) history.replaceState(null, '', `#/editar/${r.id}`);
    renderEditor();
    toast('Guardado ✓');
    return true;
  } catch (e) {
    guardando = false;
    sucio = true;
    marcarEstado();
    if (e.codigo === 'codigo-usado') errores = [`El link «${ed.codigo}» ya lo usa otro quiz: cambialo.`];
    else if (e.codigo === 'invalido') errores = ['El link no es válido: usá letras, números y guiones.'];
    else if (e.codigo === 'clave') { claveEquipo.olvidar(); errores = ['La clave del equipo dejó de ser válida. Recargá la página y volvé a entrar.']; }
    else errores = ['No se pudo guardar. Revisá la conexión e intentá de nuevo.'];
    renderEditor();
    document.getElementById('errores')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
}

/* ── Cambios en el editor ── */
function setRuta(obj, ruta, valor) {
  const partes = ruta.split('.');
  let o = obj;
  partes.slice(0, -1).forEach((k) => { o[k] ??= {}; o = o[k]; });
  o[partes.at(-1)] = valor;
}

function cambiarTipo(p, tipo) {
  const antes = p.tipo;
  p.tipo = tipo;
  if ((tipo === 'unica' || tipo === 'multiple') && !(p.opciones?.length >= 2)) p.opciones = ['', ''];
  if (antes === 'unica' && tipo === 'multiple' && p.correcta) p.correctas = [p.correcta];
  if (antes === 'multiple' && tipo === 'unica' && p.correctas?.length) p.correcta = p.correctas[0];
  if (tipo === 'nube') p.max ||= 3;
}

function renombrarOpcion(p, k, nuevo) {
  const viejo = p.opciones[k];
  p.opciones[k] = nuevo;
  if (p.correcta === viejo) p.correcta = nuevo;
  if (p.correctas) p.correctas = p.correctas.map((c) => (c === viejo ? nuevo : c));
  if (p.exclusiva === viejo) p.exclusiva = nuevo;
}

function alInput(e) {
  const t = e.target;
  if (!ed || !app.querySelector('.editor')) return;
  const d = ed.def;
  if (t.dataset.campo) {
    const c = t.dataset.campo;
    if (c === 'codigo') {
      const limpio = t.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (limpio !== t.value) t.value = limpio;
      ed.codigo = limpio;
      codigoTocado = true;
    } else if (c === 'abierto') ed.abierto = t.checked;
    else if (c === 'celebrar') d.celebrar = t.checked;
    else if (c === 'modo' || c === 'tema' || c === 'ritmo' || c === 'contacto') {
      if (!t.checked) return;
      d[c] = t.value;
      tocar();
      return renderEditor();
    } else if (c === 'ayuda.lineas') {
      d.ayuda.lineas = t.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [numero, ...resto] = l.split(/\s+[—–-]\s+|:\s*/);
        return { numero: numero.trim(), detalle: resto.join(' — ').trim() };
      });
    } else {
      setRuta(d, c, t.value);
      if (c === 'titulo' && !codigoTocado && !ed.id) {
        ed.codigo = codigoLibre(t.value);
        const fc = document.getElementById('f-codigo');
        if (fc) fc.value = ed.codigo;
      }
    }
    return tocar();
  }
  if (t.dataset.pi === undefined) return;
  const p = d.preguntas[Number(t.dataset.pi)];
  if (t.dataset.o !== undefined) { renombrarOpcion(p, Number(t.dataset.o), t.value); return tocar(); }
  const pc = t.dataset.pcampo;
  if (pc === 'tipo') { cambiarTipo(p, t.value); tocar(); return renderEditor(); }
  if (pc === 'otro') p.otro = t.checked;
  else if (pc === 'max' && p.tipo === 'nube') p.max = Number(t.value);
  else p[pc] = t.value;
  tocar();
}
// Texto por 'input' (cada tecla); casillas y listas por 'change' (una vez).
const esSeleccion = (t) => t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT';
app.addEventListener('input', (e) => { if (!esSeleccion(e.target)) alInput(e); });
app.addEventListener('change', (e) => { if (esSeleccion(e.target)) alInput(e); });

/* ── Clics ── */
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'form-clave') return;
  e.preventDefault();
  clave = document.getElementById('clave').value.trim();
  if (clave) cargarYRuta();
});

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b || b.disabled) return;
  const a = b.dataset.accion;
  if (b.tagName !== 'INPUT') b.closest('details')?.removeAttribute('open');
  const d = ed?.def;
  const pi = Number(b.dataset.pi);
  const p = d?.preguntas[pi];

  switch (a) {
    case 'recargar': location.reload(); break;
    case 'salir': claveEquipo.olvidar(); location.hash = ''; location.reload(); break;
    case 'plantilla': nuevoDesdePlantilla(b.dataset.k); break;
    case 'guardar': guardar(); break;
    case 'probar': {
      const w = window.open('about:blank', '_blank');
      const ok = !sucio || await guardar();
      if (ok && w) w.location = `/${ed.codigo}?prueba`;
      else w?.close();
      break;
    }
    case 'ayuda':
      d.ayuda = b.checked ? { texto: 'Si vos o alguien cercano necesita ayuda ahora, recurrí a una persona adulta de confianza o a un servicio de salud.', lineas: [{ numero: '911', detalle: 'Emergencias' }] } : null;
      tocar(); renderEditor(); break;
    case 'agregar': {
      const tipo = b.dataset.tipo;
      const nueva = { id: nuevoId(), tipo, texto: '' };
      cambiarTipo(nueva, tipo);
      if (tipo === 'escala') Object.assign(nueva, { min: '', max: '' });
      d.preguntas.push(nueva);
      tocar(); renderEditor();
      const i = d.preguntas.length - 1;
      document.getElementById(`pq-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(`pt-${i}`)?.focus({ preventScroll: true });
      break;
    }
    case 'subir': case 'bajar': {
      const j = a === 'subir' ? pi - 1 : pi + 1;
      [d.preguntas[pi], d.preguntas[j]] = [d.preguntas[j], d.preguntas[pi]];
      tocar(); renderEditor();
      document.querySelector(`#pq-${j} [data-accion="${a}"]`)?.focus();
      break;
    }
    case 'duplicar-p':
      d.preguntas.splice(pi + 1, 0, { ...structuredClone(p), id: nuevoId() });
      tocar(); renderEditor(); break;
    case 'borrar-p':
      if (p.texto?.trim() && !confirm(`¿Borrar la pregunta ${pi + 1}?`)) break;
      d.preguntas.splice(pi, 1);
      tocar(); renderEditor(); break;
    case 'agregar-op':
      p.opciones.push('');
      tocar(); renderEditor();
      document.getElementById(`o-${pi}-${p.opciones.length - 1}`)?.focus();
      break;
    case 'quitar-op': {
      const o = p.opciones[Number(b.dataset.o)];
      p.opciones.splice(Number(b.dataset.o), 1);
      if (p.correcta === o) delete p.correcta;
      if (p.correctas) p.correctas = p.correctas.filter((c) => c !== o);
      if (p.exclusiva === o) delete p.exclusiva;
      tocar(); renderEditor(); break;
    }
    case 'correcta': {
      const o = p.opciones[Number(b.dataset.o)];
      if (!o.trim()) { toast('Escribí la opción antes de marcarla'); break; }
      if (p.tipo === 'unica') p.correcta = p.correcta === o ? undefined : o;
      else p.correctas = (p.correctas || []).includes(o) ? p.correctas.filter((c) => c !== o) : [...(p.correctas || []), o];
      tocar(); renderEditor(); break;
    }
    case 'copiar': toast(await copiar(`${location.origin}/${b.dataset.codigo}`) ? 'Link copiado' : `${location.origin}/${b.dataset.codigo}`); break;
    case 'abrir-cerrar': {
      const q = quizzes.find((x) => x.id === b.dataset.id);
      try {
        await api.guardar(clave, { ...q, abierto: !q.abierto });
        q.abierto = !q.abierto;
        toast(q.abierto ? 'Abierto: ya recibe respuestas' : 'Cerrado: no recibe más respuestas');
        vistaLista();
      } catch { toast('No se pudo cambiar. Probá de nuevo.'); }
      break;
    }
    case 'duplicar': {
      const q = quizzes.find((x) => x.id === b.dataset.id);
      const def = structuredClone(q.def);
      def.titulo = `${def.titulo} (copia)`;
      ed = null;
      try {
        const r = await api.guardar(clave, { id: null, codigo: codigoLibre(`${q.codigo}-copia`), def, abierto: true });
        quizzes.unshift({ ...r, respuestas: 0 });
        toast('Duplicado ✓');
        vistaLista();
      } catch { toast('No se pudo duplicar. Probá de nuevo.'); }
      break;
    }
    case 'csv': {
      try {
        const r = await api.resultados(clave, b.dataset.codigo, 0);
        if (!r.filas.length) { toast('Todavía no hay respuestas'); break; }
        descargar(`${b.dataset.codigo}-respuestas.csv`, aCsv(r.quiz.def, r.filas));
      } catch { toast('No se pudo descargar. Probá de nuevo.'); }
      break;
    }
    case 'csv-contactos': {
      try {
        const lista = await api.contactos(clave, b.dataset.codigo);
        if (!lista.length) { toast('Todavía no hay contactos'); break; }
        descargar(`${b.dataset.codigo}-contactos.csv`, contactosCsv(lista));
      } catch { toast('No se pudo descargar. Probá de nuevo.'); }
      break;
    }
    case 'vaciar': {
      const q = quizzes.find((x) => x.codigo === b.dataset.codigo);
      const r = prompt(`Se van a borrar ${plural(q.respuestas || 0, 'respuesta', 'respuestas')} y ${plural(q.contactos || 0, 'contacto', 'contactos')} de «${q.def.titulo}». El quiz queda igual.\n\nEscribí BORRAR para confirmar:`);
      if (r?.trim().toUpperCase() !== 'BORRAR') break;
      try {
        await api.borrarRespuestas(clave, q.codigo);
        q.respuestas = 0;
        q.contactos = 0;
        toast('Respuestas borradas');
        vistaLista();
      } catch { toast('No se pudieron borrar. Probá de nuevo.'); }
      break;
    }
    case 'eliminar': {
      const q = quizzes.find((x) => x.id === b.dataset.id);
      const r = prompt(`Se va a eliminar «${q.def.titulo}» con todas sus respuestas. No se puede deshacer.\n\nEscribí ELIMINAR para confirmar:`);
      if (r?.trim().toUpperCase() !== 'ELIMINAR') break;
      try {
        await api.borrar(clave, q.id);
        quizzes = quizzes.filter((x) => x.id !== q.id);
        sucio = false;
        toast('Quiz eliminado');
        if (location.hash === '#/' || !location.hash) vistaLista(); else location.hash = '#/';
      } catch { toast('No se pudo eliminar. Probá de nuevo.'); }
      break;
    }
  }
});

document.addEventListener('click', (e) => {
  document.querySelectorAll('details.menu[open]').forEach((m) => { if (!m.contains(e.target)) m.removeAttribute('open'); });
});
