-- ============================================================
-- MIGRACIÓN V14 — Legajo del cliente: historial de gestiones
-- Ejecutar DESPUÉS de schema_v13_academia.sql
--   Cada lead/cliente puede tener MÚLTIPLES gestiones (casos,
--   contactos, situaciones) fechadas y con motivo. Así se arma
--   el historial: un accidente en 2024, una sucesión en 2026, etc.
-- ============================================================

create table gestiones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  lead_id          uuid not null references leads(id) on delete cascade,
  fecha_contacto   date not null default current_date,
  motivo           text not null,          -- 'Accidente laboral', 'Sucesión', 'Consulta ART'
  descripcion      text,                   -- detalle de la situación
  estado           text not null default 'abierta',  -- 'abierta'|'en_proceso'|'cerrada'
  responsable_id   uuid references perfiles(user_id), -- quién la lleva
  valor            numeric(14,2),          -- honorarios/monto de esta gestión
  datos            jsonb default '{}'::jsonb,  -- campos libres por gestión
  creado_por       uuid references perfiles(user_id),
  created_at       timestamptz not null default now()
);
create index idx_gestiones_lead on gestiones (lead_id, fecha_contacto desc);
create index idx_gestiones_org on gestiones (organizacion_id, fecha_contacto desc);

-- ------------------------------------------------------------
-- RLS: cada organización ve y opera solo sus gestiones.
-- Borrar: solo dueño (el historial es evidencia; se protege).
-- ------------------------------------------------------------
alter table gestiones enable row level security;
create policy gestiones_select on gestiones for select
  using (organizacion_id = mi_organizacion());
create policy gestiones_insert on gestiones for insert
  with check (organizacion_id = mi_organizacion());
create policy gestiones_update on gestiones for update
  using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
create policy gestiones_delete on gestiones for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

create trigger aud_gestiones after insert or update or delete on gestiones
  for each row execute function registrar_auditoria();
