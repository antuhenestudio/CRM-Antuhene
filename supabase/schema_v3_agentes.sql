-- ============================================================
-- MIGRACIÓN V3 — Agentes de IA + Inbox unificado con handoff
-- Ejecutar DESPUÉS de schema_v2_multitenant.sql
--
-- Concepto central:
--   AGENTE  = voz + objetivo + conocimiento (RAG propio)
--   CANAL   = un número de WhatsApp, una cuenta de IG, etc.
--   Un agente puede atender N canales (misma voz en todas las redes)
--   y una organización puede tener N agentes (Jubilaciones, ART...).
-- ============================================================

-- ------------------------------------------------------------
-- 1. AGENTES DE IA (configurables por el cliente desde el panel)
-- ------------------------------------------------------------
create table agentes (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  nombre           text not null,              -- 'Jubilaciones', 'Sucesiones', 'ART'
  objetivo         text not null,              -- ej: 'calificar y agendar revisión sin cargo'
  personalidad     text,                       -- instrucciones de voz/tono extra
  saludo_inicial   text,
  rubro            text not null default 'general',
  activo           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_agentes_org on agentes (organizacion_id);

-- Cada canal se atiende con un agente (o ninguno = solo humano)
alter table canales add column agente_id uuid references agentes(id) on delete set null;

-- El conocimiento puede ser general de la organización (agente_id null)
-- o exclusivo de un agente (RAG de Sucesiones ≠ RAG de Jubilaciones)
alter table documentos add column agente_id uuid references agentes(id) on delete cascade;

-- ------------------------------------------------------------
-- 2. CONVERSACIONES (inbox unificado + handoff bot ⇄ humano)
-- ------------------------------------------------------------
create table conversaciones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  lead_id          uuid not null references leads(id) on delete cascade,
  canal_id         uuid not null references canales(id) on delete cascade,
  agente_id        uuid references agentes(id) on delete set null,
  modo             text not null default 'bot',   -- 'bot' | 'humano' | 'cerrada'
  asignada_a       uuid references perfiles(user_id) on delete set null,
  ultimo_mensaje   timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (lead_id, canal_id)
);
create index idx_conversaciones_inbox on conversaciones (organizacion_id, ultimo_mensaje desc);

-- Regla de handoff: cuando un operador humano toma la conversación
-- (modo = 'humano'), el bot deja de responder hasta que se devuelva
-- a modo 'bot'. Esto se controla en el backend antes de llamar a la IA.

-- Mensajes: quién habló y por qué canal
alter table mensajes add column conversacion_id uuid references conversaciones(id) on delete cascade;
alter table mensajes add column canal_id uuid references canales(id) on delete set null;
alter table mensajes add column autor text not null default 'cliente';  -- 'cliente' | 'bot' | 'humano'
alter table mensajes add column user_id uuid references perfiles(user_id); -- si autor = 'humano'

-- ------------------------------------------------------------
-- 3. NOTAS INTERNAS (chat de equipo dentro de la conversación,
--    invisible para el cliente final — estilo Kommo/HubSpot)
-- ------------------------------------------------------------
create table notas_internas (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  conversacion_id  uuid not null references conversaciones(id) on delete cascade,
  user_id          uuid not null references perfiles(user_id) on delete cascade,
  texto            text not null,
  created_at       timestamptz not null default now()
);
create index idx_notas_conv on notas_internas (conversacion_id, created_at);

-- ------------------------------------------------------------
-- 4. CITAS (integración Google Calendar por organización)
-- ------------------------------------------------------------
create table citas (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  lead_id          uuid not null references leads(id) on delete cascade,
  agente_id        uuid references agentes(id) on delete set null,
  titulo           text not null,
  inicio           timestamptz not null,
  fin              timestamptz not null,
  gcal_event_id    text,                          -- id del evento en Google Calendar
  estado           text not null default 'agendada', -- agendada | realizada | cancelada
  created_at       timestamptz not null default now()
);
create index idx_citas_org on citas (organizacion_id, inicio);

-- ------------------------------------------------------------
-- 5. RLS para las tablas nuevas
-- ------------------------------------------------------------
alter table agentes         enable row level security;
alter table conversaciones  enable row level security;
alter table notas_internas  enable row level security;
alter table citas           enable row level security;

create policy agentes_org on agentes
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy conversaciones_org on conversaciones
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy notas_org on notas_internas
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy citas_org on citas
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());
