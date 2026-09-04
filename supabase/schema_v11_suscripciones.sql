-- ============================================================
-- MIGRACIÓN V11 — Suscripciones y muro de pago (Mercado Pago)
-- Ejecutar DESPUÉS de schema_v10_perfil_horarios.sql
--   - La cuenta puede loguearse siempre, pero las VINCULACIONES
--     (conectar canales, activar bots) requieren suscripción activa.
--   - Cobro recurrente mensual vía Mercado Pago (preapproval).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Estado de suscripción en la organización
-- ------------------------------------------------------------
alter table organizaciones add column estado_suscripcion text not null default 'inactiva';
  -- 'inactiva' | 'trial' | 'activa' | 'morosa' | 'cancelada'
alter table organizaciones add column plan_id           text;
alter table organizaciones add column mp_preapproval_id text;   -- id de la suscripción en MP
alter table organizaciones add column suscripcion_hasta timestamptz;  -- vigencia pagada
alter table organizaciones add column trial_hasta       timestamptz;

-- ------------------------------------------------------------
-- 2. Catálogo de planes (los define AntüHene, no el cliente)
--    El precio se decide comercialmente; acá se guarda el vigente.
-- ------------------------------------------------------------
create table planes (
  id            text primary key,          -- 'emprendedor' | 'profesional' | 'negocio'
  nombre        text not null,
  precio_ars    numeric(12,2) not null,
  descripcion   text,
  max_bots      int not null default 1,
  max_canales   int not null default 1,
  activo        boolean not null default true
);

-- ------------------------------------------------------------
-- 3. Historial de pagos (para conciliación y auditoría)
-- ------------------------------------------------------------
create table pagos (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  mp_payment_id    text,
  monto            numeric(12,2),
  estado           text,                    -- 'approved' | 'rejected' | 'pending'
  periodo_desde    date,
  periodo_hasta    date,
  created_at       timestamptz not null default now()
);
create index idx_pagos_org on pagos (organizacion_id, created_at desc);

-- ------------------------------------------------------------
-- 4. Función guardián: ¿la organización puede usar vinculaciones?
--    (activa o en trial vigente). Se usa desde el backend antes
--    de conectar canales o activar bots.
-- ------------------------------------------------------------
create or replace function suscripcion_vigente(org uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from organizaciones o
    where o.id = org
      and (
        (o.estado_suscripcion = 'activa' and (o.suscripcion_hasta is null or o.suscripcion_hasta > now()))
        or (o.estado_suscripcion = 'trial' and o.trial_hasta > now())
      )
  );
$$;

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
alter table pagos enable row level security;
create policy pagos_select on pagos for select
  using (organizacion_id = mi_organizacion());
-- Inserción de pagos: solo el backend (service_role), nunca el panel.

-- Planes: lectura pública para mostrar precios en el muro de pago
alter table planes enable row level security;
create policy planes_select on planes for select using (true);

-- ------------------------------------------------------------
-- 6. Planes con precios ORIENTATIVOS (punto de partida editable)
--    Verificá con tu costo real (calculadora) y la competencia
--    antes de publicarlos. Cambialos con:
--    update planes set precio_ars = XXXX where id = 'emprendedor';
-- ------------------------------------------------------------
insert into planes (id, nombre, precio_ars, descripcion, max_bots, max_canales) values
  ('emprendedor', 'Emprendedor', 35000,  'Para el que arranca: 1 bot, 1 canal, CRM y agenda', 1, 1),
  ('profesional', 'Profesional', 70000,  'Para equipos: 3 bots, 5 canales, publicaciones y métricas', 3, 5),
  ('negocio',     'Negocio',     120000, 'Alto volumen: 10 bots, 20 canales y todo incluido', 10, 20)
on conflict (id) do update set
  precio_ars = excluded.precio_ars,
  descripcion = excluded.descripcion,
  max_bots = excluded.max_bots,
  max_canales = excluded.max_canales;

create trigger aud_org_suscripcion after update on organizaciones
  for each row execute function registrar_auditoria();
