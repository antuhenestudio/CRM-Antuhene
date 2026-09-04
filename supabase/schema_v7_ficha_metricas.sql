-- ============================================================
-- MIGRACIÓN V7 — Ficha de cliente ampliada + Métricas de decisión
-- Ejecutar DESPUÉS de schema_v6_publicador.sql
-- Agrega: datos filiatorios, secretario asignado, fecha de ingreso,
-- número de registro interno correlativo, valor del caso ganado,
-- y una tabla de gasto publicitario para calcular CAC y ROI reales.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ampliar la ficha del lead/cliente
-- ------------------------------------------------------------
alter table leads add column dni              text;
alter table leads add column apellido         text;
alter table leads add column domicilio        text;
alter table leads add column email            text;
alter table leads add column secretario_id    uuid references perfiles(user_id);
  -- responsable interno asignado (secretario, abogado, vendedor)
alter table leads add column fecha_ingreso     date default current_date;
alter table leads add column valor_caso        numeric(14,2);
  -- honorarios/venta esperada o cobrada de este cliente (para ROI)
alter table leads add column datos_filiatorios jsonb default '{}'::jsonb;
  -- campos extra sin migrar esquema (estado civil, nacionalidad, etc.)

-- ------------------------------------------------------------
-- 2. Número de registro interno correlativo: AH-2026-0001
--    Una secuencia por organización y por año.
-- ------------------------------------------------------------
alter table leads add column registro_interno text;

create table contadores_registro (
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  anio            int  not null,
  ultimo          int  not null default 0,
  primary key (organizacion_id, anio)
);

create or replace function asignar_registro_interno()
returns trigger language plpgsql security definer as $$
declare a int := extract(year from now()); n int;
begin
  if new.registro_interno is not null then return new; end if;

  insert into contadores_registro (organizacion_id, anio, ultimo)
  values (new.organizacion_id, a, 1)
  on conflict (organizacion_id, anio)
    do update set ultimo = contadores_registro.ultimo + 1
  returning ultimo into n;

  new.registro_interno := 'AH-' || a || '-' || lpad(n::text, 4, '0');
  return new;
end; $$;

create trigger trg_registro_interno
  before insert on leads
  for each row execute function asignar_registro_interno();

-- ------------------------------------------------------------
-- 3. Gasto publicitario (para CAC y ROI reales)
--    Cargable a mano ahora; alimentable por API de Ads en Fase 3.
-- ------------------------------------------------------------
create table gastos_publicidad (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  plataforma       text not null,          -- 'meta' | 'google' | 'tiktok' | 'otro'
  campania         text,
  monto            numeric(14,2) not null,
  moneda           text not null default 'ARS',
  desde            date not null,
  hasta            date not null,
  origen           text not null default 'manual',  -- 'manual' | 'api'
  creado_por       uuid references perfiles(user_id),
  created_at       timestamptz not null default now()
);
create index idx_gastos_org on gastos_publicidad (organizacion_id, desde);

-- ------------------------------------------------------------
-- 4. Vista de métricas de decisión (CAC y ROI reales por org)
--    CAC  = gasto en ads / clientes ganados
--    ROI  = (ingresos de ganados - gasto) / gasto
--    Solo usa números cargados; si no hay datos, devuelve null
--    en vez de inventar.
-- ------------------------------------------------------------
create or replace view metricas_negocio with (security_invoker = true) as
with ganados as (
  select organizacion_id,
         count(*)                          as clientes_ganados,
         coalesce(sum(valor_caso), 0)      as ingresos
  from leads
  where estado = 'ganado'
  group by organizacion_id
),
gasto as (
  select organizacion_id, coalesce(sum(monto), 0) as inversion
  from gastos_publicidad
  group by organizacion_id
),
totales as (
  select organizacion_id,
         count(*)                                            as leads_totales,
         count(*) filter (where tier = 'A')                  as leads_tier_a,
         count(*) filter (where estado = 'ganado')           as ganados,
         count(*) filter (where estado = 'perdido')          as perdidos
  from leads group by organizacion_id
)
select
  t.organizacion_id,
  t.leads_totales,
  t.leads_tier_a,
  t.ganados,
  t.perdidos,
  round(100.0 * t.ganados / nullif(t.leads_totales, 0), 1)   as tasa_conversion,
  coalesce(gs.inversion, 0)                                   as inversion_ads,
  coalesce(g.ingresos, 0)                                     as ingresos,
  round(gs.inversion / nullif(g.clientes_ganados, 0), 2)      as cac,
  round((g.ingresos - gs.inversion) / nullif(gs.inversion, 0), 2) as roi
from totales t
left join ganados g  on g.organizacion_id = t.organizacion_id
left join gasto   gs on gs.organizacion_id = t.organizacion_id;

-- ------------------------------------------------------------
-- 5. RLS + auditoría de lo nuevo
-- ------------------------------------------------------------
alter table gastos_publicidad enable row level security;
create policy gastos_select on gastos_publicidad for select
  using (organizacion_id = mi_organizacion());
create policy gastos_write on gastos_publicidad for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy gastos_update on gastos_publicidad for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy gastos_delete on gastos_publicidad for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

create trigger aud_gastos after insert or update or delete on gastos_publicidad
  for each row execute function registrar_auditoria();
