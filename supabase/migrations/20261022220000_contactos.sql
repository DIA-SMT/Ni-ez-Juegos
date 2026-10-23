-- ═══════════════════════════════════════════════════════════════════
-- Contacto de los participantes (nombre y teléfono).
--
-- Se guarda APARTE de las respuestas y sin nada que las una: ni el
-- participante (pid), ni la hora (solo el día), ni un número correlativo
-- (el id es al azar). Así "tus respuestas son anónimas" sigue siendo
-- cierto aunque el quiz pida contacto. Solo el equipo los lee (con clave).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists privado.contactos (
  id       uuid primary key default gen_random_uuid(),
  quiz_id  uuid not null references privado.quizzes (id) on delete cascade,
  nombre   text not null check (char_length(nombre) between 2 and 80),
  telefono text not null check (telefono ~ '^\+?[0-9]{6,15}$'),
  fecha    date not null default (now() at time zone 'America/Argentina/Tucuman')::date
);
create unique index if not exists contactos_quiz_tel_idx on privado.contactos (quiz_id, telefono);
alter table privado.contactos enable row level security;

create or replace function public.dejar_contacto(p_codigo text, p_nombre text, p_telefono text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  q privado.quizzes;
  v_nombre text;
  v_tel text;
begin
  select * into q from privado.quizzes where codigo = lower(trim(p_codigo));
  if not found then
    raise exception 'no existe' using errcode = 'P0002';
  end if;
  if not q.abierto then
    raise exception 'cerrado' using errcode = 'P0001';
  end if;
  v_nombre := left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 80);
  v_tel := regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g');
  if char_length(v_nombre) < 2 or v_tel !~ '^\+?[0-9]{6,15}$' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  insert into privado.contactos (quiz_id, nombre, telefono)
  values (q.id, v_nombre, v_tel)
  on conflict (quiz_id, telefono) do update set nombre = excluded.nombre;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.panel_contactos(p_clave text, p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform privado.exigir_clave(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object('nombre', c.nombre, 'telefono', c.telefono, 'fecha', c.fecha) order by lower(c.nombre))
    from privado.contactos c
    join privado.quizzes q on q.id = c.quiz_id
    where q.codigo = lower(trim(p_codigo))), '[]'::jsonb);
end;
$$;

-- La lista del panel cuenta también los contactos.
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
             'respuestas', (select count(*) from privado.respuestas r where r.quiz_id = q.id),
             'contactos', (select count(*) from privado.contactos c where c.quiz_id = q.id))
           order by q.actualizado desc)
    from privado.quizzes q), '[]'::jsonb);
end;
$$;

-- "Borrar respuestas" deja el quiz como nuevo: también borra los contactos
-- (sirve para limpiar después de un ensayo).
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
  delete from privado.contactos c
   using privado.quizzes q
   where q.id = c.quiz_id and q.codigo = lower(trim(p_codigo));
  return n;
end;
$$;

revoke all on function public.dejar_contacto(text, text, text), public.panel_contactos(text, text) from public;
grant execute on function public.dejar_contacto(text, text, text), public.panel_contactos(text, text) to anon, authenticated;

-- Las dos encuestas de Niñez piden contacto (se cambia desde el panel).
update privado.quizzes set def = def || '{"contacto": "obligatorio"}'::jsonb
 where codigo in ('consumos', 'silencio') and not def ? 'contacto';
