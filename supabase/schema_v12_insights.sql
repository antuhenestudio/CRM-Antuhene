-- ============================================================
-- MIGRACIÓN V12 — "Antü": IA analista que observa y recomienda
-- Ejecutar DESPUÉS de schema_v11_suscripciones.sql
--   Un motor analiza el CRM de cada cliente y genera insights
--   (recomendaciones, felicitaciones, alertas) que aparecen en
--   el panel según la zona/sección donde el cliente esté.
-- ============================================================

create table insights (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  tipo             text not null,     -- 'recomendacion' | 'felicitacion' | 'alerta' | 'sugerencia'
  zona             text not null,     -- dónde mostrarlo: 'resumen'|'leads'|'inbox'|'publicaciones'|'metricas'|'agenda'|'global'
  titulo           text not null,
  mensaje          text not null,     -- redactado con la voz de Antü
  prioridad        int not null default 1,   -- 1 baja … 3 alta
  accion_texto     text,              -- CTA opcional ("Ver leads sin contactar")
  accion_zona      text,              -- a qué sección lleva el CTA
  visto            boolean not null default false,
  descartado       boolean not null default false,
  created_at       timestamptz not null default now(),
  expira_en        timestamptz        -- opcional: insights que caducan
);
create index idx_insights_org on insights (organizacion_id, zona, visto)
  where descartado = false;

-- Evitar insights repetidos idénticos sin resolver: clave lógica
create unique index idx_insights_unico on insights (organizacion_id, tipo, titulo)
  where descartado = false and visto = false;

-- ------------------------------------------------------------
-- RLS: cada cliente ve y gestiona solo sus insights
-- ------------------------------------------------------------
alter table insights enable row level security;
create policy insights_select on insights for select
  using (organizacion_id = mi_organizacion());
-- El cliente puede marcar visto/descartado (update), no crear a mano:
create policy insights_update on insights for update
  using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
-- La inserción la hace el motor (backend con service_role).

-- ------------------------------------------------------------
-- Vista: insights activos por zona (lo que consume el panel)
-- ------------------------------------------------------------
create or replace view insights_activos with (security_invoker = true) as
select * from insights
where not descartado
order by prioridad desc, created_at desc;
