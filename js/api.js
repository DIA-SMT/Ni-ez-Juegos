// Única puerta a los datos. Con Supabase configurado (config.js) todo va por
// funciones de la base (las tablas no se tocan directo); sin configurar, un
// "modo local" imita esas mismas funciones en este navegador.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { SEMILLAS } from './semillas.js';
import { puntuar } from './juego.js';
import { almacen } from './util.js';

export const MODO_LOCAL = !SUPABASE_URL || !SUPABASE_KEY;

// codigo: 'clave' | 'cerrado' | 'cerrada' | 'ya' | 'no-existe' | 'codigo-usado' | 'invalido' | 'red' | 'otro'
export class ErrorApi extends Error {
  constructor(mensaje, codigo = 'otro') { super(mensaje); this.codigo = codigo; }
}

/* ── Clave del equipo ── (la guarda el panel; la usan también "presentar" y la botonera) */
const K_CLAVE = 'equipo:clave';
export const clave = {
  leer: () => almacen.leer(K_CLAVE) || '',
  guardar: (c) => almacen.guardar(K_CLAVE, c),
  olvidar: () => almacen.borrar(K_CLAVE),
};

/* ── Supabase (PostgREST) ── */
async function rpc(nombre, args) {
  const cabeceras = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (SUPABASE_KEY.startsWith('eyJ')) cabeceras.Authorization = 'Bearer ' + SUPABASE_KEY; // clave "anon" (JWT)
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
  throw new ErrorApi(msg || `Error ${r.status}`, clasificar(msg, r.status));
}

function clasificar(msg, status = 0) {
  if (/clave incorrecta/i.test(msg)) return 'clave';
  if (/pregunta cerrada/i.test(msg)) return 'cerrada';
  if (/ya respondida/i.test(msg)) return 'ya';
  if (/cerrad/i.test(msg)) return 'cerrado';
  if (/no existe/i.test(msg)) return 'no-existe';
  if (status === 409 || /duplicate key/i.test(msg)) return 'codigo-usado';
  if (/check constraint|inválid/i.test(msg)) return 'invalido';
  return 'otro';
}

const remoto = {
  quiz: (codigo) => rpc('quiz_publico', { p_codigo: codigo }),
  responder: (codigo, alias, datos) => rpc('responder', { p_codigo: codigo, p_alias: alias || null, p_datos: datos }),
  ranking: (codigo) => rpc('ranking', { p_codigo: codigo }),
  // Modo guiado (el presentador activa cada pregunta)
  estado: (codigo) => rpc('estado_publico', { p_codigo: codigo }),
  unirse: (codigo, pid, alias) => rpc('unirse', { p_codigo: codigo, p_pid: pid, p_alias: alias || null }),
  responderPregunta: (codigo, pid, alias, pregunta, valor, otro) =>
    rpc('responder_pregunta', { p_codigo: codigo, p_pid: pid, p_alias: alias || null, p_pregunta: pregunta, p_valor: valor, p_otro: otro || null }),
  miResultado: (codigo, pid) => rpc('mi_resultado', { p_codigo: codigo, p_pid: pid }),
  // Contacto: se guarda aparte de las respuestas (no hay nada que los una)
  dejarContacto: (codigo, nombre, telefono) => rpc('dejar_contacto', { p_codigo: codigo, p_nombre: nombre, p_telefono: telefono }),
  // Equipo
  quizzes: (c) => rpc('panel_quizzes', { p_clave: c }),
  guardar: (c, q) => rpc('panel_guardar', { p_clave: c, p_id: q.id || null, p_codigo: q.codigo, p_def: q.def, p_abierto: q.abierto }),
  borrar: (c, id) => rpc('panel_borrar', { p_clave: c, p_id: id }),
  // Solo trae las filas nuevas o cambiadas desde "desde" (campo c): con 300
  // chicos respondiendo, la pantalla no vuelve a bajar todo cada vez.
  resultados: (c, codigo, desde = 0) => rpc('panel_resultados', { p_clave: c, p_codigo: codigo, p_desde: desde }),
  enVivo: (c, codigo, estado) => rpc('panel_en_vivo', { p_clave: c, p_codigo: codigo, p_estado: estado }),
  borrarRespuestas: (c, codigo) => rpc('panel_borrar_respuestas', { p_clave: c, p_codigo: codigo }),
  contactos: (c, codigo) => rpc('panel_contactos', { p_clave: c, p_codigo: codigo }),
};

/* ── Modo local ── misma forma de datos que las funciones de la base */
const K_DB = 'local:db';
const ahora = () => new Date().toISOString();
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
function db() {
  let d = almacen.leer(K_DB);
  if (!d) {
    d = { seq: 0, cambio: 0, respuestas: [], quizzes: SEMILLAS.map((s) => ({ id: uuid(), codigo: s.codigo, def: s.def, abierto: true, en_vivo: {}, creado: ahora(), actualizado: ahora() })) };
  }
  d.cambio ??= d.seq;
  d.respuestas.forEach((r) => { r.cambio ??= r.id; });
  d.quizzes.forEach((q) => { q.en_vivo ??= {}; });
  d.contactos ??= [];
  almacen.guardar(K_DB, d);
  return d;
}
const guardarDb = (d) => almacen.guardar(K_DB, d);
const espera = (v) => new Promise((ok) => setTimeout(() => ok(v == null ? v : structuredClone(v)), 120));
const buscar = (d, codigo) => d.quizzes.find((q) => q.codigo === String(codigo).trim().toLowerCase());
const CODIGO_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const RESERVADOS = ['panel', 'presentar', 'control', 'api', 'css', 'js', 'img', 'index', 'responder'];
const exigir = (c) => { if (!c) throw new ErrorApi('clave incorrecta', 'clave'); };
const aliasDe = (q, alias) => (q.def.modo === 'quiz' ? String(alias || '').trim().slice(0, 40) || null : null);

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
    const fila = { id: ++d.seq, cambio: ++d.cambio, quiz_id: q.id, alias: aliasDe(q, alias), datos, puntaje, aciertos, creada: ahora() };
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
  async estado(codigo) {
    const q = buscar(db(), codigo);
    return espera(q ? { en_vivo: q.en_vivo, v: q.actualizado, abierto: q.abierto } : null);
  },
  async unirse(codigo, pid, alias) {
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    if (!q.abierto) throw new ErrorApi('cerrado', 'cerrado');
    let f = d.respuestas.find((r) => r.quiz_id === q.id && r.pid === pid);
    if (!f) d.respuestas.push(f = { id: ++d.seq, cambio: ++d.cambio, quiz_id: q.id, pid, alias: aliasDe(q, alias), datos: {}, puntaje: 0, aciertos: 0, creada: ahora() });
    else if (aliasDe(q, alias) && f.alias !== aliasDe(q, alias)) { f.alias = aliasDe(q, alias); f.cambio = ++d.cambio; }
    guardarDb(d);
    return espera({ ok: true });
  },
  async responderPregunta(codigo, pid, alias, pregunta, valor, otro) {
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    if (!q.abierto) throw new ErrorApi('cerrado', 'cerrado');
    if (!q.def.preguntas.some((p) => p.id === pregunta)) throw new ErrorApi('datos inválidos', 'invalido');
    if (q.def.ritmo === 'guiado' && (q.en_vivo.activa !== pregunta || q.en_vivo.cerrada)) throw new ErrorApi('pregunta cerrada', 'cerrada');
    let f = d.respuestas.find((r) => r.quiz_id === q.id && r.pid === pid);
    if (!f) d.respuestas.push(f = { id: ++d.seq, quiz_id: q.id, pid, alias: aliasDe(q, alias), datos: {}, puntaje: 0, aciertos: 0, creada: ahora() });
    if (pregunta in f.datos) throw new ErrorApi('ya respondida', 'ya');
    f.datos[pregunta] = valor;
    if (otro && String(otro).trim()) f.datos[pregunta + '_otro'] = String(otro).trim().slice(0, 200);
    Object.assign(f, puntuar(q.def, f.datos), { alias: aliasDe(q, alias) || f.alias, cambio: ++d.cambio });
    delete f.evaluables;
    guardarDb(d);
    return espera({ id: f.id });
  },
  async dejarContacto(codigo, nombre, telefono) {
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    if (!q.abierto) throw new ErrorApi('cerrado', 'cerrado');
    const n = String(nombre || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const t = String(telefono || '').replace(/[^0-9+]/g, '');
    if (n.length < 2 || !/^\+?[0-9]{6,15}$/.test(t)) throw new ErrorApi('datos inválidos', 'invalido');
    const ya = d.contactos.find((c) => c.quiz_id === q.id && c.telefono === t);
    if (ya) ya.nombre = n; else d.contactos.push({ quiz_id: q.id, nombre: n, telefono: t, fecha: new Date().toLocaleDateString('sv') });
    guardarDb(d);
    return espera({ ok: true });
  },
  async contactos(c, codigo) {
    exigir(c);
    const d = db();
    const q = buscar(d, codigo);
    return espera(d.contactos.filter((x) => x.quiz_id === q?.id).map(({ nombre, telefono, fecha }) => ({ nombre, telefono, fecha }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
  },
  async miResultado(codigo, pid) {
    const d = db();
    const q = buscar(d, codigo);
    const f = q && d.respuestas.find((r) => r.quiz_id === q.id && r.pid === pid);
    if (!f) return espera(null);
    const delQuiz = d.respuestas.filter((r) => r.quiz_id === q.id);
    return espera({ id: f.id, puntaje: f.puntaje, aciertos: f.aciertos, puesto: delQuiz.filter((r) => r.puntaje > f.puntaje).length + 1, total: delQuiz.length });
  },
  async quizzes(c) {
    exigir(c);
    const d = db();
    return espera(d.quizzes.map((q) => ({ ...q, respuestas: d.respuestas.filter((r) => r.quiz_id === q.id).length, contactos: d.contactos.filter((x) => x.quiz_id === q.id).length }))
      .sort((a, b) => b.actualizado.localeCompare(a.actualizado)));
  },
  async guardar(c, q) {
    exigir(c);
    const d = db();
    const codigo = String(q.codigo).trim().toLowerCase();
    if (!CODIGO_OK.test(codigo) || RESERVADOS.includes(codigo)) throw new ErrorApi('código inválido', 'invalido');
    if (d.quizzes.some((x) => x.codigo === codigo && x.id !== q.id)) throw new ErrorApi('duplicate key', 'codigo-usado');
    let fila = d.quizzes.find((x) => x.id === q.id);
    if (fila) Object.assign(fila, { codigo, def: q.def, abierto: q.abierto ?? fila.abierto, actualizado: ahora() });
    else d.quizzes.push(fila = { id: uuid(), codigo, def: q.def, abierto: q.abierto ?? true, en_vivo: {}, creado: ahora(), actualizado: ahora() });
    guardarDb(d);
    return espera(fila);
  },
  async borrar(c, id) {
    exigir(c);
    const d = db();
    d.quizzes = d.quizzes.filter((q) => q.id !== id);
    d.respuestas = d.respuestas.filter((r) => r.quiz_id !== id);
    guardarDb(d);
    return espera(null);
  },
  async resultados(c, codigo, desde = 0) {
    exigir(c);
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    const todas = d.respuestas.filter((r) => r.quiz_id === q.id);
    return espera({
      quiz: { id: q.id, codigo: q.codigo, def: q.def, abierto: q.abierto },
      en_vivo: q.en_vivo,
      total: todas.length,
      filas: todas.filter((r) => r.cambio > desde).sort((a, b) => a.cambio - b.cambio)
        .map((r) => ({ id: r.id, c: r.cambio, t: r.creada, alias: r.alias, puntaje: r.puntaje, d: r.datos })),
    });
  },
  async enVivo(c, codigo, estado) {
    exigir(c);
    const d = db();
    const q = buscar(d, codigo);
    if (!q) throw new ErrorApi('no existe', 'no-existe');
    const { rev, t, ...resto } = estado;
    q.en_vivo = { ...resto, rev: (q.en_vivo.rev || 0) + 1, t: ahora() };
    guardarDb(d);
    return espera(q.en_vivo);
  },
  async borrarRespuestas(c, codigo) {
    exigir(c);
    const d = db();
    const q = buscar(d, codigo);
    const antes = d.respuestas.length;
    d.respuestas = d.respuestas.filter((r) => r.quiz_id !== q?.id);
    d.contactos = d.contactos.filter((x) => x.quiz_id !== q?.id);
    guardarDb(d);
    return espera(antes - d.respuestas.length);
  },
};

export const api = MODO_LOCAL ? local : remoto;
