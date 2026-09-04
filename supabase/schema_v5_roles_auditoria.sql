-- ============================================================
-- MIGRACIÓN V5 — Roles de administración + Auditoría inmutable
-- Ejecutar DESPUÉS de schema_v4_rag_multitenant.sql
--
-- Roles por organización:
--   dueno  : control total (borrar, gestionar equipo y agentes)
--   admin  : gestiona todo pero NO borra ni administra el equipo
--   miembro: opera (responder, mover Kanban, notas) sin borrar
--            ni tocar configuración (agentes, canales, docs)
--
-- Garantías:
--   1. Los permisos se aplican en Postgres (RLS): aunque el
--      empleado use la API directa, la base rechaza la acción.
--   2. Cada mensaje humano queda firmado con auth.uid() real
--      (un trigger lo fuerza: no se puede suplantar autoría).
--   3. Tabla `auditoria` inmutable: registra quién hizo qué;
--      nadie puede editarla ni borrarla desde el panel.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helpers de rol
-- ------------------------------------------------------------
create or replace function mi_rol()
returns text language sql stable security definer as $$
  select rol from perfiles where user_id = auth.uid();
$$;

create or replace function soy_dueno()
returns boolean language sql stable security definer as $$
  select coalesce(mi_rol() = 'dueno', false);
$$;

create or replace function soy_gestor()  -- dueno o admin
returns boolean language sql stable security definer as $$
  select coalesce(mi_rol() in ('dueno','admin'), false);
$$;

-- ------------------------------------------------------------
-- 2. Reemplazar políticas "FOR ALL" por permisos granulares
-- ------------------------------------------------------------

-- LEADS: todos ven y operan; solo dueño borra
drop policy if exists leads_org on leads;
create policy leads_select on leads for select
  using (organizacion_id = mi_organizacion());
create policy leads_insert on leads for insert
  with check (organizacion_id = mi_organizacion());
create policy leads_update on leads for update
  using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
create policy leads_delete on leads for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

-- CONVERSACIONES: operar sí; borrar solo dueño
drop policy if exists conversaciones_org on conversaciones;
create policy conv_select on conversaciones for select
  using (organizacion_id = mi_organizacion());
create policy conv_insert on conversaciones for insert
  with check (organizacion_id = mi_organizacion());
create policy conv_update on conversaciones for update
  using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
create policy conv_delete on conversaciones for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

-- MENSAJES: el equipo puede leer y ENVIAR; nadie edita ni borra
-- (el historial de conversación es evidencia: inmutable para todos)
drop policy if exists mensajes_org on mensajes;
create policy msj_select on mensajes for select
  using (organizacion_id = mi_organizacion());
create policy msj_insert on mensajes for insert
  with check (
    organizacion_id = mi_organizacion()
    and autor = 'humano'          -- desde el panel solo se envían mensajes humanos
  );
-- (sin políticas de update/delete: prohibido para todo el panel)

-- NOTAS INTERNAS: crear sí; editar/borrar solo la propia y solo dueño borra ajenas
drop policy if exists notas_org on notas_internas;
create policy notas_select on notas_internas for select
  using (organizacion_id = mi_organizacion());
create policy notas_insert on notas_internas for insert
  with check (organizacion_id = mi_organizacion() and user_id = auth.uid());
create policy notas_delete on notas_internas for delete
  using (organizacion_id = mi_organizacion() and (user_id = auth.uid() or soy_dueno()));

-- CONFIGURACIÓN (agentes, documentos, publicaciones, citas):
-- gestores administran; miembros solo leen/operan lo mínimo
drop policy if exists agentes_org on agentes;
create policy agentes_select on agentes for select
  using (organizacion_id = mi_organizacion());
create policy agentes_write on agentes for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy agentes_update on agentes for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy agentes_delete on agentes for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

drop policy if exists documentos_org on documentos;
create policy docs_select on documentos for select
  using (organizacion_id = mi_organizacion());
create policy docs_insert on documentos for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy docs_update on documentos for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy docs_delete on documentos for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

drop policy if exists publicaciones_org on publicaciones;
create policy pub_select on publicaciones for select
  using (organizacion_id = mi_organizacion());
create policy pub_insert on publicaciones for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy pub_update on publicaciones for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy pub_delete on publicaciones for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

drop policy if exists citas_org on citas;
create policy citas_select on citas for select
  using (organizacion_id = mi_organizacion());
create policy citas_insert on citas for insert
  with check (organizacion_id = mi_organizacion());
create policy citas_update on citas for update
  using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
create policy citas_delete on citas for delete
  using (organizacion_id = mi_organizacion() and soy_gestor());

-- PERFILES (gestión del equipo): solo el dueño invita/cambia roles
create policy perfiles_equipo_select on perfiles for select
  using (organizacion_id = mi_organizacion());
create policy perfiles_equipo_update on perfiles for update
  using (organizacion_id = mi_organizacion() and soy_dueno());
create policy perfiles_equipo_delete on perfiles for delete
  using (organizacion_id = mi_organizacion() and soy_dueno()
         and user_id <> auth.uid());   -- el dueño no se elimina a sí mismo

-- ------------------------------------------------------------
-- 3. Firma de autoría: no se puede suplantar quién envió
-- ------------------------------------------------------------
create or replace function firmar_autor_mensaje()
returns trigger language plpgsql security definer as $$
begin
  -- Si la fila entra por el panel (usuario logueado), la firma es SU sesión,
  -- ignore lo que haya mandado el cliente HTTP. El backend (service_role,
  -- auth.uid() = null) conserva user_id null para mensajes del bot.
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.autor   := 'humano';
  end if;
  return new;
end; $$;

create trigger trg_firmar_mensaje
  before insert on mensajes
  for each row execute function firmar_autor_mensaje();

-- ------------------------------------------------------------
-- 4. AUDITORÍA INMUTABLE: quién hizo qué, cuándo y sobre qué
-- ------------------------------------------------------------
create table auditoria (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid,
  user_id          uuid,              -- null = acción del sistema/bot
  accion           text not null,     -- INSERT | UPDATE | DELETE
  tabla            text not null,
  registro_id      text,
  datos_antes      jsonb,
  datos_despues    jsonb,
  created_at       timestamptz not null default now()
);
create index idx_auditoria_org on auditoria (organizacion_id, created_at desc);

alter table auditoria enable row level security;
-- El equipo puede CONSULTAR la bitácora de su organización…
create policy auditoria_select on auditoria for select
  using (organizacion_id = mi_organizacion());
-- …pero NADIE puede insertarla a mano, editarla ni borrarla desde el
-- panel (sin políticas de insert/update/delete: solo los triggers
-- security definer y el backend escriben acá).

create or replace function registrar_auditoria()
returns trigger language plpgsql security definer as $$
declare org uuid; reg text;
begin
  org := coalesce(
    (case when TG_OP = 'DELETE' then (to_jsonb(old)->>'organizacion_id')
          else (to_jsonb(new)->>'organizacion_id') end)::uuid, null);
  reg := case when TG_OP = 'DELETE' then (to_jsonb(old)->>'id')
              else (to_jsonb(new)->>'id') end;

  insert into auditoria (organizacion_id, user_id, accion, tabla, registro_id, datos_antes, datos_despues)
  values (
    org,
    auth.uid(),                                   -- null si fue el bot/backend
    TG_OP,
    TG_TABLE_NAME,
    reg,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end; $$;

-- Auditar las tablas sensibles
create trigger aud_leads          after insert or update or delete on leads
  for each row execute function registrar_auditoria();
create trigger aud_conversaciones after update or delete on conversaciones
  for each row execute function registrar_auditoria();
create trigger aud_mensajes       after insert on mensajes
  for each row execute function registrar_auditoria();
create trigger aud_agentes        after insert or update or delete on agentes
  for each row execute function registrar_auditoria();
create trigger aud_canales        after insert or update or delete on canales
  for each row execute function registrar_auditoria();
create trigger aud_documentos     after insert or update or delete on documentos
  for each row execute function registrar_auditoria();
create trigger aud_perfiles       after insert or update or delete on perfiles
  for each row execute function registrar_auditoria();
