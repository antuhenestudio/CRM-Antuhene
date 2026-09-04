-- ============================================================
-- MIGRACIÓN V2 — Capa Multi-Tenant (modelo SaaS)
-- Ejecutar DESPUÉS de schema.sql.
-- Cada emprendedor = una organización. RLS garantiza aislamiento.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ORGANIZACIONES (tenants) y PERFILES (usuarios logueados)
-- ------------------------------------------------------------
create table organizaciones (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  rubro       text not null default 'general',
  plan        text not null default 'trial',   -- trial | basico | pro
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Vincula auth.users (Supabase Auth) con su organización y rol
create table perfiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  rol             text not null default 'miembro',  -- dueno | miembro
  nombre          text,
  created_at      timestamptz not null default now()
);

-- Helper: organización del usuario logueado
create or replace function mi_organizacion()
returns uuid language sql stable security definer as $$
  select organizacion_id from perfiles where user_id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 2. CANALES conectados por cliente (WhatsApp, IG, FB, Ads)
--    Los tokens NUNCA se exponen al frontend (sin policy SELECT
--    para authenticated: solo el backend con service_role los lee).
-- ------------------------------------------------------------
create table canales (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  tipo             text not null,      -- 'whatsapp' | 'instagram' | 'facebook' | 'meta_ads'
  identificador    text not null,      -- phone_number_id / ig_user_id / page_id / ad_account_id
  token_acceso     text,               -- token del cliente (cifrar en reposo: Supabase Vault)
  metadatos        jsonb default '{}'::jsonb,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (tipo, identificador)
);
create index idx_canales_org on canales (organizacion_id);

-- ------------------------------------------------------------
-- 3. PUBLICADOR DE CONTENIDO (calendario multicanal)
-- ------------------------------------------------------------
create table publicaciones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  canal_id         uuid not null references canales(id) on delete cascade,
  texto            text,
  media_url        text,               -- imagen/video en Supabase Storage
  programada_para  timestamptz not null,
  estado           text not null default 'programada', -- programada | publicada | error
  resultado        jsonb default '{}'::jsonb,          -- id del post, error, etc.
  created_at       timestamptz not null default now()
);
create index idx_publicaciones_pendientes on publicaciones (programada_para)
  where estado = 'programada';

-- ------------------------------------------------------------
-- 4. CAMPAÑAS ADS (caché de métricas por cliente, Fase 3)
-- ------------------------------------------------------------
create table campanias_ads (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  canal_id         uuid references canales(id) on delete set null,
  campania_meta_id text not null,
  nombre           text,
  metricas         jsonb default '{}'::jsonb,  -- gasto, cpl, leads, actualizado_en
  created_at       timestamptz not null default now(),
  unique (organizacion_id, campania_meta_id)
);

-- ------------------------------------------------------------
-- 5. Agregar organizacion_id a las tablas de la Fase 1
-- ------------------------------------------------------------
alter table leads               add column organizacion_id uuid references organizaciones(id) on delete cascade;
alter table documentos          add column organizacion_id uuid references organizaciones(id) on delete cascade;
alter table mensajes            add column organizacion_id uuid references organizaciones(id) on delete cascade;
alter table eventos_programados add column organizacion_id uuid references organizaciones(id) on delete cascade;

-- El teléfono ya no es único global: un mismo cliente final puede
-- escribirle a dos negocios distintos de la plataforma.
alter table leads drop constraint leads_telefono_key;
alter table leads add constraint leads_telefono_org unique (telefono, organizacion_id);

create index idx_leads_org on leads (organizacion_id, estado);

-- ------------------------------------------------------------
-- 6. ROW LEVEL SECURITY: cada tenant ve SOLO lo suyo
-- ------------------------------------------------------------
alter table organizaciones      enable row level security;
alter table perfiles            enable row level security;
alter table canales             enable row level security;
alter table publicaciones       enable row level security;
alter table campanias_ads       enable row level security;
alter table leads               enable row level security;
alter table mensajes            enable row level security;
alter table documentos          enable row level security;
alter table eventos_programados enable row level security;

create policy org_propia on organizaciones
  for select using (id = mi_organizacion());

create policy perfil_propio on perfiles
  for select using (user_id = auth.uid());

-- Canales: el cliente ve sus canales pero SIN el token
-- (crear una vista si el frontend necesita listarlos):
create view canales_publicos with (security_invoker = true) as
  select id, organizacion_id, tipo, identificador, activo, created_at
  from canales;
create policy canales_org on canales
  for select using (false);  -- tokens solo accesibles vía service_role

create policy publicaciones_org on publicaciones
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy campanias_org on campanias_ads
  for select using (organizacion_id = mi_organizacion());

create policy leads_org on leads
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy mensajes_org on mensajes
  for select using (organizacion_id = mi_organizacion());

create policy documentos_org on documentos
  for all using (organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

create policy eventos_org on eventos_programados
  for select using (organizacion_id = mi_organizacion());

-- ------------------------------------------------------------
-- 7. Alta automática: al registrarse un usuario nuevo se crea
--    su organización y su perfil de dueño.
-- ------------------------------------------------------------
create or replace function alta_organizacion()
returns trigger language plpgsql security definer as $$
declare nueva_org uuid;
begin
  insert into organizaciones (nombre)
  values (coalesce(new.raw_user_meta_data->>'nombre_negocio', 'Mi negocio'))
  returning id into nueva_org;

  insert into perfiles (user_id, organizacion_id, rol, nombre)
  values (new.id, nueva_org, 'dueno', new.raw_user_meta_data->>'nombre');
  return new;
end; $$;

create trigger trg_alta_usuario
  after insert on auth.users
  for each row execute function alta_organizacion();
