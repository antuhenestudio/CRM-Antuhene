-- ============================================================
-- CRM WhatsApp — Esquema Supabase (PostgreSQL + pgvector)
-- Fase 1: leads, conversaciones, RAG y eventos programados
-- Multi-rubro: 'juridico' | 'inmobiliario'
-- ============================================================

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. LEADS (tablero Kanban)
-- ------------------------------------------------------------
create type estado_kanban as enum (
  'nuevo_lead',
  'filtrado_tier_a',
  'historia_laboral_recibida',
  'cita_agendada',
  'en_tramite',
  'ganado',
  'perdido'
);

create table leads (
  id            uuid primary key default gen_random_uuid(),
  telefono      text not null unique,          -- formato E.164: 549299XXXXXXX
  nombre        text,
  rubro         text not null default 'juridico',  -- 'juridico' | 'inmobiliario'
  estado        estado_kanban not null default 'nuevo_lead',

  -- Datos capturados conversacionalmente (detección pasiva)
  interes       text,                          -- ej: 'jubilacion ordinaria', 'lote Añelo'
  zona          text,
  plazo         text,
  convenio      text,                          -- ej: 'petroleros', 'camioneros', 'anses', 'issn'
  tier          text,                          -- 'A' | 'B' | 'C'
  birth_date    date,                          -- para Fidelización 365
  notas         jsonb default '{}'::jsonb,     -- campos extra sin migrar esquema

  -- Atribución de Ads (Fase 3, se deja listo)
  origen        text default 'organico',       -- 'organico' | 'ctwa' | 'web' | 'referido'
  ad_id         text,
  ctwa_clid     text,                          -- click id de Click-to-WhatsApp

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_leads_estado on leads (estado);
create index idx_leads_rubro  on leads (rubro);

-- ------------------------------------------------------------
-- 2. MENSAJES (historial de conversación = memoria del bot)
-- ------------------------------------------------------------
create table mensajes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  wamid        text unique,                    -- id de WhatsApp (dedup de webhooks)
  direccion    text not null,                  -- 'entrante' | 'saliente'
  contenido    text not null,
  created_at   timestamptz not null default now()
);

create index idx_mensajes_lead on mensajes (lead_id, created_at);

-- ------------------------------------------------------------
-- 3. DOCUMENTOS RAG (la IA solo responde con esto; cero invención)
-- ------------------------------------------------------------
create table documentos (
  id         uuid primary key default gen_random_uuid(),
  rubro      text not null,                    -- filtra el conocimiento por negocio
  titulo     text not null,
  contenido  text not null,
  embedding  vector(1536),                     -- text-embedding-3-small
  created_at timestamptz not null default now()
);

create index idx_documentos_embedding on documentos
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Función de búsqueda semántica
create or replace function buscar_documentos(
  query_embedding vector(1536),
  filtro_rubro text,
  cantidad int default 4
)
returns table (titulo text, contenido text, similitud float)
language sql stable as $$
  select d.titulo, d.contenido,
         1 - (d.embedding <=> query_embedding) as similitud
  from documentos d
  where d.rubro = filtro_rubro
  order by d.embedding <=> query_embedding
  limit cantidad;
$$;

-- ------------------------------------------------------------
-- 4. EVENTOS PROGRAMADOS (retargeting diferido + Fidelización 365)
--    Un cron job (n8n / pg_cron / Railway cron) procesa lo vencido
--    SOLO dentro de la ventana 09:00–21:00 AR.
-- ------------------------------------------------------------
create table eventos_programados (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  tipo         text not null,                  -- 'retargeting_1' | 'retargeting_2' | 'cumpleanios' | 'festividad'
  ejecutar_en  timestamptz not null,
  ejecutado    boolean not null default false,
  created_at   timestamptz not null default now()
);

create index idx_eventos_pendientes on eventos_programados (ejecutar_en)
  where ejecutado = false;

-- ------------------------------------------------------------
-- 5. Trigger de updated_at
-- ------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();
