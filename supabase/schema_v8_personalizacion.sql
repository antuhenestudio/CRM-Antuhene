-- ============================================================
-- MIGRACIÓN V8 — Personalización por cliente
-- Ejecutar DESPUÉS de schema_v7_ficha_metricas.sql
--   1. Campos personalizados de ficha (cada org define los suyos)
--   2. Fuentes de conocimiento del RAG (PDF/Word/Excel/URL)
--   3. Reglas de notificación a contactos (eventos del negocio)
-- ============================================================

-- ------------------------------------------------------------
-- 1. CAMPOS PERSONALIZADOS
--    Cada organización define qué campos extra tiene su ficha.
-- ------------------------------------------------------------
create table campos_personalizados (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  clave            text not null,          -- 'm2_buscados', 'nro_expediente'
  etiqueta         text not null,          -- 'M² buscados', 'N° de expediente'
  tipo             text not null default 'texto',  -- texto|numero|fecha|opcion|booleano
  opciones         text[],                 -- si tipo = 'opcion'
  orden            int not null default 0,
  created_at       timestamptz not null default now(),
  unique (organizacion_id, clave)
);

-- Valores de esos campos por lead (clave-valor, flexible)
create table valores_campos (
  lead_id          uuid not null references leads(id) on delete cascade,
  campo_id         uuid not null references campos_personalizados(id) on delete cascade,
  valor            text,
  primary key (lead_id, campo_id)
);

-- ------------------------------------------------------------
-- 2. FUENTES DE CONOCIMIENTO DEL RAG
--    Registro de cada archivo/URL que el cliente sube para
--    nutrir a su bot. El backend procesa el archivo, extrae el
--    texto, lo trocea y genera embeddings en `documentos`.
-- ------------------------------------------------------------
create table fuentes_conocimiento (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  agente_id        uuid references agentes(id) on delete cascade,  -- null = general de la org
  tipo             text not null,          -- 'pdf' | 'word' | 'excel' | 'url' | 'texto'
  nombre           text not null,          -- nombre de archivo o título
  origen_url       text,                   -- URL (web) o path en Supabase Storage
  estado           text not null default 'pendiente', -- pendiente|procesando|listo|error
  fragmentos       int default 0,          -- cuántos chunks generó
  detalle          text,                   -- mensaje de error si falla
  creado_por       uuid references perfiles(user_id),
  created_at       timestamptz not null default now()
);
create index idx_fuentes_org on fuentes_conocimiento (organizacion_id, created_at desc);

-- Vincular cada chunk de `documentos` a su fuente (para poder borrar)
alter table documentos add column fuente_id uuid references fuentes_conocimiento(id) on delete cascade;

-- ------------------------------------------------------------
-- 3. REGLAS DE NOTIFICACIÓN
--    "Cuando pase X, avisá por WhatsApp a estos contactos."
--    Los envíos respetan la ventana horaria y la cadencia
--    humana (humanizacion.js) para no arriesgar el número.
-- ------------------------------------------------------------
create table reglas_notificacion (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  evento           text not null,          -- 'lead_nuevo'|'tier_a'|'cita_agendada'|'ganado'
  contactos        text[] not null,        -- teléfonos E.164 a avisar
  plantilla        text,                   -- texto con {nombre},{registro_interno},{interes}
  activa           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_reglas_org on reglas_notificacion (organizacion_id, evento);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
alter table campos_personalizados  enable row level security;
alter table valores_campos         enable row level security;
alter table fuentes_conocimiento   enable row level security;
alter table reglas_notificacion    enable row level security;

-- Campos: todos ven; gestores definen; dueño borra
create policy campos_select on campos_personalizados for select
  using (organizacion_id = mi_organizacion());
create policy campos_write on campos_personalizados for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy campos_update on campos_personalizados for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy campos_delete on campos_personalizados for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

-- Valores: siguen a su lead (misma organización); todos operan
create policy valores_all on valores_campos for all
  using (exists (select 1 from leads l
    where l.id = valores_campos.lead_id and l.organizacion_id = mi_organizacion()))
  with check (exists (select 1 from leads l
    where l.id = valores_campos.lead_id and l.organizacion_id = mi_organizacion()));

-- Fuentes de conocimiento: gestores administran
create policy fuentes_select on fuentes_conocimiento for select
  using (organizacion_id = mi_organizacion());
create policy fuentes_write on fuentes_conocimiento for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy fuentes_delete on fuentes_conocimiento for delete
  using (organizacion_id = mi_organizacion() and soy_gestor());

-- Reglas de notificación: gestores administran
create policy reglas_select on reglas_notificacion for select
  using (organizacion_id = mi_organizacion());
create policy reglas_write on reglas_notificacion for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy reglas_update on reglas_notificacion for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy reglas_delete on reglas_notificacion for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

-- Auditar lo sensible
create trigger aud_fuentes after insert or delete on fuentes_conocimiento
  for each row execute function registrar_auditoria();
create trigger aud_reglas after insert or update or delete on reglas_notificacion
  for each row execute function registrar_auditoria();
