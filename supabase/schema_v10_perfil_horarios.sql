-- ============================================================
-- MIGRACIÓN V10 — Perfil comercial + Horarios de atención
-- Ejecutar DESPUÉS de schema_v9_scoring_agenda.sql
--   1. Ficha del negocio (nutre al bot automáticamente)
--   2. Horarios de atención (el bot solo agenda dentro de ellos)
-- ============================================================

-- ------------------------------------------------------------
-- 1. PERFIL COMERCIAL DEL NEGOCIO
--    Una fila por organización. El bot la lee como conocimiento
--    base, sin que el cliente tenga que subir documentos.
-- ------------------------------------------------------------
create table perfil_negocio (
  organizacion_id  uuid primary key references organizaciones(id) on delete cascade,
  tipo_negocio     text,            -- 'Estudio jurídico', 'Inmobiliaria', 'Restaurante'...
  descripcion      text,            -- a qué se dedica, en sus palabras
  direccion        text,            -- dirección postal
  lat              numeric(10,7),   -- coordenadas para el mapa real
  lng              numeric(10,7),
  telefono         text,
  whatsapp         text,
  email            text,
  sitio_web        text,
  canales_atencion text,            -- "WhatsApp, presencial, teléfono, Instagram"
  servicios        jsonb default '[]'::jsonb,  -- [{nombre, descripcion, precio?}]
  faq              jsonb default '[]'::jsonb,   -- [{pregunta, respuesta}]
  es_online        boolean not null default false,  -- vende/atiende sin horario fijo
  actualizado_en   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. HORARIOS DE ATENCIÓN
--    Franjas por día de la semana (0=domingo ... 6=sábado).
--    El bot solo ofrece/confirma turnos dentro de estas franjas,
--    salvo que perfil_negocio.es_online = true.
-- ------------------------------------------------------------
create table horarios_atencion (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  dia_semana       int not null check (dia_semana between 0 and 6),
  hora_desde       time not null,   -- ej: 09:00
  hora_hasta       time not null,   -- ej: 13:00 (se pueden cargar 2 franjas para cortar al mediodía)
  created_at       timestamptz not null default now()
);
create index idx_horarios_org on horarios_atencion (organizacion_id, dia_semana);

-- Función: ¿el instante dado cae dentro del horario de atención?
-- (En zona horaria de Argentina.)
create or replace function dentro_horario_atencion(
  org uuid, momento timestamptz
)
returns boolean language plpgsql stable as $$
declare
  es_online boolean;
  dow int;
  hora time;
begin
  select p.es_online into es_online from perfil_negocio p where p.organizacion_id = org;
  if coalesce(es_online, false) then return true; end if;  -- negocio online: sin restricción

  dow  := extract(dow  from momento at time zone 'America/Argentina/Buenos_Aires')::int;
  hora := (momento at time zone 'America/Argentina/Buenos_Aires')::time;

  return exists (
    select 1 from horarios_atencion h
    where h.organizacion_id = org
      and h.dia_semana = dow
      and hora >= h.hora_desde
      and hora <  h.hora_hasta
  );
end; $$;

-- ------------------------------------------------------------
-- 3. RLS + auditoría
-- ------------------------------------------------------------
alter table perfil_negocio     enable row level security;
alter table horarios_atencion  enable row level security;

create policy perfil_select on perfil_negocio for select
  using (organizacion_id = mi_organizacion());
create policy perfil_upsert on perfil_negocio for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy perfil_update on perfil_negocio for update
  using (organizacion_id = mi_organizacion() and soy_gestor());

create policy horarios_select on horarios_atencion for select
  using (organizacion_id = mi_organizacion());
create policy horarios_write on horarios_atencion for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy horarios_update on horarios_atencion for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy horarios_delete on horarios_atencion for delete
  using (organizacion_id = mi_organizacion() and soy_gestor());

create trigger aud_perfil after insert or update on perfil_negocio
  for each row execute function registrar_auditoria();
