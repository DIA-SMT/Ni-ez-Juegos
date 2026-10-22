-- ═══════════════════════════════════════════════════════════════════
-- Modo guiado: el presentador activa cada pregunta (estilo Mentimeter /
-- Kahoot) y una botonera en el celular maneja la pantalla.
--
-- · quizzes.en_vivo: el estado de la presentación (placa, pregunta activa,
--   qué se reveló). Lo escriben la pantalla y la botonera (con clave); los
--   celulares lo leen con estado_publico cada pocos segundos.
-- · respuestas.pid: cada celular guarda pregunta por pregunta en su fila.
-- · respuestas.cambio: número que sube con cada alta o cambio, para que la
--   pantalla traiga solo lo nuevo (con 300 chicos no se baja todo).
-- ═══════════════════════════════════════════════════════════════════

alter table privado.quizzes add column if not exists en_vivo jsonb not null default '{}'::jsonb;

create sequence if not exists privado.respuestas_cambio_seq;
alter table privado.respuestas add column if not exists pid uuid;
alter table privado.respuestas add column if not exists cambio bigint not null default nextval('privado.respuestas_cambio_seq');
create unique index if not exists respuestas_pid_idx on privado.respuestas (quiz_id, pid) where pid is not null;
create index if not exists respuestas_cambio_idx on privado.respuestas (quiz_id, cambio);

-- Lo que miran los celulares en modo guiado. No tiene nada secreto.
create or replace function public.estado_publico(p_codigo text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('en_vivo', q.en_vivo, 'v', q.actualizado, 'abierto', q.abierto)
  from privado.quizzes q
  where q.codigo = lower(trim(p_codigo));
$$;

-- Una respuesta por vez (modo guiado). Solo se acepta la pregunta activa y
-- abierta, y cada pregunta se contesta una sola vez.
create or replace function public.responder_pregunta(p_codigo text, p_pid uuid, p_alias text, p_pregunta text, p_valor jsonb, p_otro text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  q privado.quizzes;
  f privado.respuestas;
  v_alias text;
  v_datos jsonb;
  r record;
begin
  select * into q from privado.quizzes where codigo = lower(trim(p_codigo));
  if not found then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  if not q.abierto then
    raise exception 'cerrado' using errcode = 'P0001';
  end if;
  if p_pid is null or p_pregunta is null or p_valor is null
     or not exists (select 1 from jsonb_array_elements(q.def->'preguntas') p where p->>'id' = p_pregunta) then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  if q.def->>'ritmo' = 'guiado'
     and (q.en_vivo->>'activa' is distinct from p_pregunta or coalesce((q.en_vivo->>'cerrada')::boolean, false)) then
    raise exception 'pregunta cerrada' using errcode = 'P0001';
  end if;

  v_alias := case when q.def->>'modo' = 'quiz' then nullif(left(trim(coalesce(p_alias, '')), 40), '') end;
  insert into privado.respuestas (quiz_id, pid, alias, datos)
  values (q.id, p_pid, v_alias, '{}'::jsonb)
  on conflict (quiz_id, pid) where pid is not null do nothing;

  select * into f from privado.respuestas where quiz_id = q.id and pid = p_pid for update;
  if f.datos ? p_pregunta then
    raise exception 'ya respondida' using errcode = 'P0001';
  end if;

  v_datos := f.datos || jsonb_build_object(p_pregunta, p_valor);
  if nullif(trim(coalesce(p_otro, '')), '') is not null then
    v_datos := v_datos || jsonb_build_object(p_pregunta || '_otro', left(trim(p_otro), 200));
  end if;
  select * into r from privado.puntuar(q.def, v_datos);

  update privado.respuestas
     set datos = v_datos, alias = coalesce(v_alias, alias), puntaje = r.puntaje, aciertos = r.aciertos,
         cambio = nextval('privado.respuestas_cambio_seq')
   where id = f.id;
  return jsonb_build_object('id', f.id);
end;
$$;

-- El resultado de un celular al final del quiz (modo guiado).
create or replace function public.mi_resultado(p_codigo text, p_pid uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'puntaje', r.puntaje, 'aciertos', r.aciertos,
    'puesto', (select count(*) + 1 from privado.respuestas x where x.quiz_id = r.quiz_id and x.puntaje > r.puntaje),
    'total', (select count(*) from privado.respuestas x where x.quiz_id = r.quiz_id))
  from privado.respuestas r
  join privado.quizzes q on q.id = r.quiz_id
  where q.codigo = lower(trim(p_codigo)) and r.pid = p_pid;
$$;

-- La pantalla y la botonera escriben el estado de la presentación.
create or replace function public.panel_en_vivo(p_clave text, p_codigo text, p_estado jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform privado.exigir_clave(p_clave);
  if jsonb_typeof(p_estado) is distinct from 'object' or pg_column_size(p_estado) > 8192 then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  update privado.quizzes
     set en_vivo = (p_estado - 'rev' - 't') || jsonb_build_object('rev', coalesce((en_vivo->>'rev')::bigint, 0) + 1, 't', now())
   where codigo = lower(trim(p_codigo))
  returning en_vivo into v;
  if v is null then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Ahora trae el estado en vivo y las filas nuevas O cambiadas (por "cambio").
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
    'en_vivo', q.en_vivo,
    'total', (select count(*) from privado.respuestas r where r.quiz_id = q.id),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'c', r.cambio, 't', r.creada, 'alias', r.alias, 'puntaje', r.puntaje, 'd', r.datos) order by r.cambio)
      from privado.respuestas r
      where r.quiz_id = q.id and r.cambio > coalesce(p_desde, 0)), '[]'::jsonb));
end;
$$;

revoke all on function public.estado_publico(text), public.responder_pregunta(text, uuid, text, text, jsonb, text),
  public.mi_resultado(text, uuid), public.panel_en_vivo(text, text, jsonb) from public;
grant execute on function public.estado_publico(text), public.responder_pregunta(text, uuid, text, text, jsonb, text),
  public.mi_resultado(text, uuid), public.panel_en_vivo(text, text, jsonb), public.panel_resultados(text, text, bigint)
  to anon, authenticated;

-- Las dos encuestas de Niñez pasan a modo guiado (se cambia desde el panel).
update privado.quizzes set def = def || '{"ritmo": "guiado"}'::jsonb
 where codigo in ('consumos', 'silencio') and not def ? 'ritmo';

-- Entrar a la sala (modo guiado): la pantalla cuenta a los que esperan
-- aunque todavía no hayan respondido nada.
create or replace function public.unirse(p_codigo text, p_pid uuid, p_alias text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  q privado.quizzes;
  v_alias text;
begin
  select * into q from privado.quizzes where codigo = lower(trim(p_codigo));
  if not found then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  if not q.abierto then
    raise exception 'cerrado' using errcode = 'P0001';
  end if;
  if p_pid is null then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  v_alias := case when q.def->>'modo' = 'quiz' then nullif(left(trim(coalesce(p_alias, '')), 40), '') end;
  insert into privado.respuestas as r (quiz_id, pid, alias, datos)
  values (q.id, p_pid, v_alias, '{}'::jsonb)
  on conflict (quiz_id, pid) where pid is not null
  do update set alias = coalesce(excluded.alias, r.alias), cambio = nextval('privado.respuestas_cambio_seq')
  where r.alias is distinct from coalesce(excluded.alias, r.alias);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unirse(text, uuid, text) from public;
grant execute on function public.unirse(text, uuid, text) to anon, authenticated;
