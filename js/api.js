// Única puerta a los datos. Con Supabase configurado (config.js) todo va por
// funciones de la base (las tablas no se tocan directo); sin configurar, un
// "modo local" imita esas mismas funciones en este navegador.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { SEMILLAS } from './semillas.js';
import { puntuar } from './juego.js';
import { almacen } from './util.js';

export const MODO_LOCAL = !SUPABASE_URL || !SUPABASE_KEY;

// codigo: 'clave' | 'cerrado' | 'no-existe' | 'codigo-usado' | 'invalido' | 'red' | 'otro'
export class ErrorApi extends Error {
  constructor(mensaje, codigo = 'otro') { super(mensaje); this.codigo = codigo; }
}

/* ── Clave del equipo ── (la guarda el panel; la usa también "presentar") */
const K_CLAVE = 'equipo:clave';
export const clave = {
  leer: () => almacen.leer(K_CLAVE) || '',
  guardar: (c) => almacen.guardar(K_CLAVE, c),
  olvidar: () => almacen.borrar(K_CLAVE),
};

/* ── Supabase (PostgREST) ── */
async function rpc(nombre, args) {
  const cabeceras = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (SUPABASE_KEY.startsWith('eyJ')) cabeceras.Authorization = 'Bearer ' + SUPABASE_KEY; // clave "anon" vieja (JWT)
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 12000);
  let r;
  try {
    r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${nombre}`, {
      method: 'POST', headers: cabeceras, body: JSON.stringify(args), signal: ctrl.signal,
    });
  } catch {
    throw new ErrorApi('Sin conexión', 'red');
  } finally {
    clearTimeout(corte);
  }
  if (r.ok) return r.status === 204 ? null : r.json();
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch { /* cuerpo vacío */ }
  let codigo = 'otro';
  if (/clave incorrecta/i.test(msg)) codigo = 'clave';
  else if (/cerrad/i.test(msg)) codigo = 'cerrado';
  else if (/no existe/i.test(msg)) codigo = 'no-existe';
  else if (r.status === 409 || /duplicate key/i.test(msg)) codigo = 'codigo-usado';
  else if (/check constraint|inválid/i.test(msg)) codigo = 'invalido';
  throw new ErrorApi(msg || `Error ${r.status}`, codigo);
}

const remoto = {
  quiz: (codigo) => rpc('quiz_publico', { p_codigo: codigo }),
  responder: (codigo, alias, datos) => rpc('responder', { p_codigo: codigo, p_alias: alias || null, p_datos: datos }),
  ranking: (codigo) => rpc('ranking', { p_codigo: codigo }),
  quizzes: (c) => rpc('panel_quizzes', { p_clave: c }),
  guardar: (c, q) => rpc('panel_guardar', { p_clave: c, p_id: q.id || null, p_codigo: q.codigo, p_def: q.def, p_abierto: q.abierto }),
  borrar: (c, id) => rpc('panel_borrar', { p_clave: c, p_id: id }),
  // Solo trae las respuestas con id > desde: con 300 chicos respondiendo,
  // la pantalla en vivo no vuelve a bajar todo cada 3 segundos.
  resultados: (c, codigo, desde = 0) => rpc('panel_resultados', { p_clave: c, p_codigo: codigo, p_desde: desde }),
  borrarRespuestas: (c, codigo) => rpc('panel_borrar_respuestas', { p_clave: c, p_codigo: codigo }),
};

/* ── Modo local ── misma forma de datos que las funciones de la base */
const K_DB = 'local:db';
const ahora = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
function db() {
  let d = almacen.leer(K_DB);
  if (!d) {
    d = { seq: 0, respuestas: [], quizzes: SEMILLAS.map((s) => ({ id: uuid(), codigo: s.codigo, def: s.def, abierto: true, creado: ahora(), actualizado: ahora() })) };
    almacen.guardar(K_DB, d);
  }
  return d;
}
const guardarDb = (d) => almacen.guardar(K_DB, d);
const espera = (v) => new Promise((ok) => setTimeout(() => ok(structuredClone(v)), 120));
const buscar = (d, codigo) => d.quizzes.find((q) => q.codigo === String(codigo).trim().toLowerCase());
const CODIGO_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVADOS = ['panel', 'presentar', 'css', 'js', 'img', 'index', 'responder'];

const local = {
  async quiz(codigo) {
    const q = buscar(db(), codigo);
    return espera(q ? { id: q.id, codigo: q.codigo, def: q.def, abierto: q.abierto } : null);
  },
  async responder(codigo, alias, datos) {
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    if (!q.abierto) throw new ErrorApi('cerrado', 'cerrado');
    const { puntaje, aciertos } = puntuar(q.def, datos);
    const fila = { id: ++d.seq, quiz_id: q.id, alias: q.def.modo === 'quiz' ? (alias || '').trim().slice(0, 40) || null : null, datos, puntaje, aciertos, creada: ahora() };
    d.respuestas.push(fila);
    guardarDb(d);
    const delQuiz = d.respuestas.filter((r) => r.quiz_id === q.id);
    return espera({ id: fila.id, puntaje, aciertos, puesto: delQuiz.filter((r) => r.puntaje > puntaje).length + 1, total: delQuiz.length });
  },
  async ranking(codigo) {
    const d = db();
    const q = buscar(d, codigo);
    if (!q || q.def.modo !== 'quiz') return espera([]);
    return espera(d.respuestas.filter((r) => r.quiz_id === q.id)
      .sort((a, b) => b.puntaje - a.puntaje || a.id - b.id).slice(0, 10)
      .map(({ id, alias, puntaje, aciertos }) => ({ id, alias, puntaje, aciertos })));
  },
  async quizzes(c) {
    if (!c) throw new ErrorApi('clave incorrecta', 'clave');
    const d = db();
    return espera(d.quizzes.map((q) => ({ ...q, respuestas: d.respuestas.filter((r) => r.quiz_id === q.id).length }))
      .sort((a, b) => b.actualizado.localeCompare(a.actualizado)));
  },
  async guardar(c, q) {
    if (!c) throw new ErrorApi('clave incorrecta', 'clave');
    const d = db();
    const codigo = String(q.codigo).trim().toLowerCase();
    if (!CODIGO_OK.test(codigo) || RESERVADOS.includes(codigo)) throw new ErrorApi('código inválido', 'invalido');
    if (d.quizzes.some((x) => x.codigo === codigo && x.id !== q.id)) throw new ErrorApi('duplicate key', 'codigo-usado');
    let fila = d.quizzes.find((x) => x.id === q.id);
    if (fila) Object.assign(fila, { codigo, def: q.def, abierto: q.abierto ?? fila.abierto, actualizado: ahora() });
    else d.quizzes.push(fila = { id: uuid(), codigo, def: q.def, abierto: q.abierto ?? true, creado: ahora(), actualizado: ahora() });
    guardarDb(d);
    return espera(fila);
  },
  async borrar(c, id) {
    if (!c) throw new ErrorApi('clave incorrecta', 'clave');
    const d = db();
    d.quizzes = d.quizzes.filter((q) => q.id !== id);
    d.respuestas = d.respuestas.filter((r) => r.quiz_id !== id);
    guardarDb(d);
    return espera(null);
  },
  async resultados(c, codigo, desde = 0) {
    if (!c) throw new ErrorApi('clave incorrecta', 'clave');
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    const todas = d.respuestas.filter((r) => r.quiz_id === q.id);
    return espera({
      quiz: { id: q.id, codigo: q.codigo, def: q.def, abierto: q.abierto },
      total: todas.length,
      filas: todas.filter((r) => r.id > desde).map((r) => ({ id: r.id, t: r.creada, alias: r.alias, puntaje: r.puntaje, d: r.datos })),
    });
  },
  async borrarRespuestas(c, codigo) {
    if (!c) throw new ErrorApi('clave incorrecta', 'clave');
    const d = db();
    const q = buscar(d, codigo);
    const antes = d.respuestas.length;
    d.respuestas = d.respuestas.filter((r) => r.quiz_id !== q?.id);
    guardarDb(d);
    return espera(antes - d.respuestas.length);
  },
};

export const api = MODO_LOCAL ? local : remoto;
