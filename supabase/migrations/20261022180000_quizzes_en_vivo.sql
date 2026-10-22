-- ═══════════════════════════════════════════════════════════════════
-- Quizzes y encuestas en vivo · Municipalidad de San Miguel de Tucumán
--
-- Las tablas viven en el esquema "privado", que la API no expone: nadie
-- las lee ni las escribe directo. Todo pasa por funciones de "public":
--   · Públicas (cualquiera con el link): quiz_publico, responder, ranking.
--   · Del equipo (piden la clave): panel_quizzes, panel_guardar,
--     panel_borrar, panel_resultados, panel_borrar_respuestas.
-- Las respuestas son anónimas: no se guarda IP, nombre ni dispositivo.
--
-- Se corre una vez: Supabase → SQL Editor → pegar todo → Run.
-- ═══════════════════════════════════════════════════════════════════

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- Clave del equipo: se guarda solo su huella (sha256), nunca la clave.
create table if not exists privado.claves (
  hash   bytea primary key,
  nombre text not null default 'equipo',
  creada timestamptz not null default now()
);

create table if not exists privado.quizzes (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique
              check (codigo ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
                     and codigo not in ('panel', 'presentar', 'css', 'js', 'img', 'index', 'responder')),
  def         jsonb not null
              check (jsonb_typeof(def) = 'object'
                     and jsonb_typeof(def->'preguntas') = 'array'
                     and pg_column_size(def) <= 65536),
  abierto     boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create table if not exists privado.respuestas (
  id       bigint generated always as identity primary key,
  quiz_id  uuid not null references privado.quizzes (id) on delete cascade,
  alias    text check (alias is null or char_length(alias) between 1 and 40),
  datos    jsonb not null check (jsonb_typeof(datos) = 'object' and pg_column_size(datos) <= 16384),
  puntaje  integer not null default 0,
  aciertos integer not null default 0,
  creada   timestamptz not null default now()
);
create index if not exists respuestas_quiz_id_idx on privado.respuestas (quiz_id, id);
create index if not exists respuestas_quiz_puntaje_idx on privado.respuestas (quiz_id, puntaje desc, id);

alter table privado.claves enable row level security;
alter table privado.quizzes enable row level security;
alter table privado.respuestas enable row level security;

-- ── Ayudantes privados ──────────────────────────────────────────────

create or replace function privado.exigir_clave(p_clave text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if p_clave is null
     or not exists (select 1 from privado.claves where hash = sha256(convert_to(p_clave, 'UTF8'))) then
    raise exception 'clave incorrecta' using errcode = '28P01';
  end if;
end;
$$;

-- Mismo puntaje que js/juego.js: 100 por acierto y +25 por cada acierto
-- seguido. Se calcula acá para que el ranking no se pueda inflar.
create or replace function privado.puntuar(p_def jsonb, p_datos jsonb, out puntaje integer, out aciertos integer)
language plpgsql immutable
set search_path = ''
as $$
declare
  p jsonb;
  v jsonb;
  ok boolean;
  racha integer := 0;
begin
  puntaje := 0;
  aciertos := 0;
  if coalesce(p_def->>'modo', 'encuesta') <> 'quiz' then
    return;
  end if;
  for p in select value from jsonb_array_elements(p_def->'preguntas') loop
    v := p_datos -> (p->>'id');
    if p->>'tipo' = 'unica' and coalesce(p->>'correcta', '') <> '' then
      ok := jsonb_typeof(v) = 'string' and (v #>> '{}') = (p->>'correcta');
    elsif p->>'tipo' = 'multiple' and jsonb_typeof(p->'correctas') = 'array' and jsonb_array_length(p->'correctas') > 0 then
      ok := jsonb_typeof(v) = 'array' and v @> (p->'correctas') and (p->'correctas') @> v;
    else
      continue;
    end if;
    if ok then
      racha := racha + 1;
      aciertos := aciertos + 1;
      puntaje := puntaje + 100 + 25 * (racha - 1);
    else
      racha := 0;
    end if;
  end loop;
end;
$$;

-- ── Funciones públicas ──────────────────────────────────────────────

create or replace function public.quiz_publico(p_codigo text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('id', q.id, 'codigo', q.codigo, 'def', q.def, 'abierto', q.abierto)
  from privado.quizzes q
  where q.codigo = lower(trim(p_codigo));
$$;

create or replace function public.responder(p_codigo text, p_alias text, p_datos jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  q privado.quizzes;
  r record;
  v_id bigint;
  v_puesto integer;
  v_total integer;
begin
  select * into q from privado.quizzes where codigo = lower(trim(p_codigo));
  if not found then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  if not q.abierto then
    raise exception 'cerrado' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;

  select * into r from privado.puntuar(q.def, p_datos);
  insert into privado.respuestas (quiz_id, alias, datos, puntaje, aciertos)
  values (
    q.id,
    case when q.def->>'modo' = 'quiz' then nullif(left(trim(coalesce(p_alias, '')), 40), '') end,
    p_datos, r.puntaje, r.aciertos
  )
  returning id into v_id;

  select count(*) filter (where x.puntaje > r.puntaje) + 1, count(*)
    into v_puesto, v_total
    from privado.respuestas x
   where x.quiz_id = q.id;

  return jsonb_build_object('id', v_id, 'puntaje', r.puntaje, 'aciertos', r.aciertos, 'puesto', v_puesto, 'total', v_total);
end;
$$;

create or replace function public.ranking(p_codigo text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'alias', t.alias, 'puntaje', t.puntaje, 'aciertos', t.aciertos)
                            order by t.puntaje desc, t.id), '[]'::jsonb)
  from (
    select r.id, r.alias, r.puntaje, r.aciertos
    from privado.respuestas r
    join privado.quizzes q on q.id = r.quiz_id
    where q.codigo = lower(trim(p_codigo)) and q.def->>'modo' = 'quiz'
    order by r.puntaje desc, r.id
    limit 10
  ) t;
$$;

-- ── Funciones del equipo (con clave) ────────────────────────────────

create or replace function public.panel_quizzes(p_clave text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform privado.exigir_clave(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'codigo', q.codigo, 'def', q.def, 'abierto', q.abierto,
             'creado', q.creado, 'actualizado', q.actualizado,
             'respuestas', (select count(*) from privado.respuestas r where r.quiz_id = q.id))
           order by q.actualizado desc)
    from privado.quizzes q), '[]'::jsonb);
end;
$$;

create or replace function public.panel_guardar(p_clave text, p_id uuid, p_codigo text, p_def jsonb, p_abierto boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v privado.quizzes;
begin
  perform privado.exigir_clave(p_clave);
  if p_id is null then
    insert into privado.quizzes (codigo, def, abierto)
    values (lower(trim(p_codigo)), p_def, coalesce(p_abierto, true))
    returning * into v;
  else
    update privado.quizzes
       set codigo = lower(trim(p_codigo)), def = p_def, abierto = coalesce(p_abierto, abierto), actualizado = now()
     where id = p_id
    returning * into v;
    if not found then
      raise exception 'no existe' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('id', v.id, 'codigo', v.codigo, 'def', v.def, 'abierto', v.abierto,
                            'creado', v.creado, 'actualizado', v.actualizado);
end;
$$;

create or replace function public.panel_borrar(p_clave text, p_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform privado.exigir_clave(p_clave);
  delete from privado.quizzes where id = p_id;
end;
$$;

-- p_desde: solo las respuestas nuevas (id mayor). La pantalla en vivo
-- pregunta cada 3 segundos y con 300 chicos no baja todo cada vez.
create or replace function public.panel_resultados(p_clave text, p_codigo text, p_desde bigint default 0)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  q privado.quizzes;
begin
  perform privado.exigir_clave(p_clave);
  select * into q from privado.quizzes where codigo = lower(trim(p_codigo));
  if not found then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'quiz', jsonb_build_object('id', q.id, 'codigo', q.codigo, 'def', q.def, 'abierto', q.abierto),
    'total', (select count(*) from privado.respuestas r where r.quiz_id = q.id),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 't', r.creada, 'alias', r.alias, 'puntaje', r.puntaje, 'd', r.datos) order by r.id)
      from privado.respuestas r
      where r.quiz_id = q.id and r.id > coalesce(p_desde, 0)), '[]'::jsonb));
end;
$$;

create or replace function public.panel_borrar_respuestas(p_clave text, p_codigo text)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform privado.exigir_clave(p_clave);
  delete from privado.respuestas r
   using privado.quizzes q
   where q.id = r.quiz_id and q.codigo = lower(trim(p_codigo));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Permisos ────────────────────────────────────────────────────────
revoke all on all functions in schema privado from public, anon, authenticated;
revoke all on function public.quiz_publico(text), public.responder(text, text, jsonb), public.ranking(text),
  public.panel_quizzes(text), public.panel_guardar(text, uuid, text, jsonb, boolean), public.panel_borrar(text, uuid),
  public.panel_resultados(text, text, bigint), public.panel_borrar_respuestas(text, text)
  from public;
grant execute on function public.quiz_publico(text), public.responder(text, text, jsonb), public.ranking(text),
  public.panel_quizzes(text), public.panel_guardar(text, uuid, text, jsonb, boolean), public.panel_borrar(text, uuid),
  public.panel_resultados(text, text, bigint), public.panel_borrar_respuestas(text, text)
  to anon, authenticated;

-- ── Datos iniciales ─────────────────────────────────────────────────
-- Huella de la clave del equipo (la clave en sí no está en el repo).
-- Para cambiarla: insert into privado.claves (hash) values (sha256(convert_to('NUEVA-CLAVE', 'UTF8')));
--                 y borrar la fila vieja.
insert into privado.claves (hash, nombre)
values (decode('f6addb8adab8867a11c72c2a26f2811b7cdec4b438224814bd3466e198d2b990', 'hex'), 'equipo')
on conflict do nothing;

-- Las dos encuestas de Niñez (se editan después desde /panel).
insert into privado.quizzes (codigo, def) values
  ('consumos', $json${"titulo":"Abordaje de situaciones de riesgo y consumos problemáticos","etiqueta":"Encuesta","subtitulo":"","intro":"Queremos conocer tus dudas para orientar la capacitación. Te invitamos a responder estas breves preguntas.","modo":"encuesta","tema":"azul","celebrar":true,"cierre":{"titulo":"¡Gracias por participar!","texto":"Tus respuestas nos ayudan a armar una capacitación a la medida de tus dudas."},"ayuda":null,"preguntas":[{"id":"p1","tipo":"unica","texto":"¿Sabés reconocer cuándo una persona está atravesando una situación de riesgo relacionada con el consumo de alcohol u otras sustancias?","opciones":["Sí","Más o menos","No"]},{"id":"p2","tipo":"unica","texto":"¿Sabrías qué hacer si alguien cercano necesita ayuda por su consumo?","opciones":["Sí","No","Tengo dudas"]},{"id":"p3","tipo":"unica","texto":"¿Conocés algún lugar donde pedir orientación o ayuda?","opciones":["Sí","No"]},{"id":"p4","tipo":"unica","texto":"¿Qué te dificultaría ayudar a una persona en esa situación?","opciones":["No saber cómo acercarme","Miedo a su reacción","No saber a quién recurrir"],"otro":true},{"id":"p5","tipo":"multiple","texto":"¿Qué te gustaría aprender en la capacitación?","opciones":["Reconocer señales de alerta","Cómo hablar con alguien que necesita ayuda","Qué hacer ante una emergencia","Dónde buscar ayuda","Cómo acompañar a familiares y amigos"]},{"id":"p6","tipo":"unica","texto":"¿Sabés diferenciar entre consumo problemático e intoxicación por drogas?","opciones":["Sí, puedo distinguir ambas situaciones","Tengo algunas dudas sobre sus diferencias","No, no sé diferenciarlas","Me gustaría recibir más información sobre el tema"]},{"id":"p7","tipo":"texto","texto":"¿Qué duda puntual sobre cómo actuar ante una situación de riesgo o consumo te gustaría resolver en esta capacitación?","placeholder":"Escribí tu duda…"}]}$json$::jsonb),
  ('silencio', $json${"titulo":"Romper el Silencio","etiqueta":"Encuesta para adolescentes y jóvenes","subtitulo":"Salud mental y suicidio","intro":"Queremos conocer tus dudas sobre la prevención del suicidio. La encuesta es anónima: no incluyas nombres ni experiencias personales. Podés dejar sin responder cualquier pregunta.","modo":"encuesta","tema":"celeste","celebrar":false,"cierre":{"titulo":"Gracias por participar","texto":"Tu pregunta puede ayudar a otras personas a animarse a hablar."},"ayuda":{"texto":"Si vos o alguien cercano necesita ayuda ahora, no esperes al encuentro ni a una respuesta de esta encuesta: recurrí a una persona adulta de confianza o a un servicio de salud.","lineas":[{"numero":"911","detalle":"Emergencias"},{"numero":"0800 345 1435","detalle":"Centro de Asistencia al Suicida · gratis, todo el país"}]},"preguntas":[{"id":"p1","tipo":"unica","texto":"¿Creés que hablar sobre el suicidio puede ayudar a prevenirlo?","opciones":["Sí","No","No sé"]},{"id":"p2","tipo":"unica","texto":"¿Sabés cuáles pueden ser las señales de alerta de que una persona está pensando en suicidarse?","opciones":["Sí","Conozco algunas","No"]},{"id":"p3","tipo":"unica","texto":"Si un amigo o una amiga te dice que no quiere seguir viviendo, ¿sabrías qué hacer?","opciones":["Sí","Tengo dudas","No"]},{"id":"p4","tipo":"unica","texto":"Si alguien te cuenta que está pensando en suicidarse y te pide que guardes el secreto, ¿qué harías?","opciones":["Guardaría el secreto","Buscaría ayuda de una persona adulta de confianza o un profesional","No sabría qué hacer"]},{"id":"p5","tipo":"multiple","texto":"¿Qué podría dificultar que pidas ayuda si vos o alguien cercano está pensando en suicidarse?","opciones":["Miedo a que me juzguen","No saber con quién hablar","Vergüenza de contar lo que pasa","Pensar que no me van a tomar en serio","No tendría dificultad para pedir ayuda"],"otro":true,"exclusiva":"No tendría dificultad para pedir ayuda"},{"id":"p6","tipo":"unica","texto":"¿Sabés dónde acudir para recibir ayuda profesional ante una situación de riesgo de suicidio en San Miguel de Tucumán?","opciones":["Sí","No","Tengo dudas"]},{"id":"p7","tipo":"multiple","texto":"¿Qué te gustaría aprender sobre la prevención del suicidio?","opciones":["Cómo reconocer señales de alerta","Qué decir y cómo escuchar a alguien que piensa en suicidarse","Qué hacer y a quién recurrir ante un riesgo inmediato","Cómo pedir ayuda si tengo pensamientos de suicidio","Qué mitos existen sobre el suicidio"]},{"id":"p8","tipo":"texto","texto":"¿Qué duda puntual sobre el suicidio o cómo prevenirlo te gustaría que responda el especialista?","placeholder":"Escribí tu pregunta…","nota":"Sin nombres ni experiencias personales."}]}$json$::jsonb)
on conflict (codigo) do nothing;
