-- ============================================================
-- MIGRACIÓN V9 — Scoring de leads + Agenda Google
-- Ejecutar DESPUÉS de schema_v8_personalizacion.sql
--   1. Reglas de puntaje configurables por organización
--   2. Puntaje y tier calculados sobre el lead
--   3. Soporte para el calendar_id de Google por organización
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reglas de scoring (cada negocio define qué suma puntos)
-- ------------------------------------------------------------
create table reglas_scoring (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  campo            text not null,     -- 'convenio' | 'zona' | 'interes' | 'tiene_email' | 'respondio' | 'plazo'
  operador         text not null default 'igual',  -- 'igual' | 'contiene' | 'existe'
  valor            text,              -- valor a comparar (null para 'existe')
  puntos           int not null,
  activa           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_scoring_org on reglas_scoring (organizacion_id) where activa;

-- Umbrales de tier por organización (A/B/C según puntaje acumulado)
alter table organizaciones add column umbral_tier_a int not null default 60;
alter table organizaciones add column umbral_tier_b int not null default 30;

-- ------------------------------------------------------------
-- 2. Puntaje en el lead
-- ------------------------------------------------------------
alter table leads add column puntaje int not null default 0;
-- (la columna `tier` ya existe desde la base; ahora la deriva el scoring)

-- ------------------------------------------------------------
-- 3. Agenda de Google por organización
-- ------------------------------------------------------------
-- El canal tipo 'google_calendar' guarda el refresh_token en
-- token_acceso y el calendar_id (normalmente 'primary') en metadatos.
-- No hace falta tabla nueva: reutiliza `canales`.
comment on table canales is
  'Canales del negocio. tipo puede ser: whatsapp, instagram, facebook,
   web, meta_ads, google_calendar. Para google_calendar: token_acceso =
   refresh_token de Google; metadatos->>calendar_id = agenda destino.';

-- ------------------------------------------------------------
-- 4. Vista: leads calificados pendientes de contacto (la campanita)
-- ------------------------------------------------------------
create or replace view leads_pendientes with (security_invoker = true) as
select id, organizacion_id, nombre, telefono, interes, zona, tier,
       puntaje, registro_interno, created_at
from leads
where tier = 'A'
  and estado in ('nuevo_lead', 'filtrado_tier_a')
order by puntaje desc, created_at desc;

-- ------------------------------------------------------------
-- 5. RLS + auditoría
-- ------------------------------------------------------------
alter table reglas_scoring enable row level security;
create policy scoring_select on reglas_scoring for select
  using (organizacion_id = mi_organizacion());
create policy scoring_write on reglas_scoring for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy scoring_update on reglas_scoring for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy scoring_delete on reglas_scoring for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

create trigger aud_scoring after insert or update or delete on reglas_scoring
  for each row execute function registrar_auditoria();
