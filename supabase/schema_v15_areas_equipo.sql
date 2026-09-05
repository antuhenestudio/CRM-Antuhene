-- ============================================================
-- MIGRACIÓN V15 — Áreas del negocio + derivación automática
-- Ejecutar DESPUÉS de schema_v14_gestiones.sql
--   1. Áreas configurables por el administrador (Jubilaciones, ART...)
--   2. Cada usuario interno se asigna a un área
--   3. El bot detecta el tema y asigna el lead al responsable del área
--   Modelo: todos ven todo, pero cada lead tiene su área y responsable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ÁREAS (las crea el administrador del estudio)
-- ------------------------------------------------------------
create table areas (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  nombre           text not null,          -- 'Jubilaciones', 'ART', 'Sucesiones', 'ANSES'
  descripcion      text,
  -- Palabras/temas que disparan esta área (para que el bot detecte)
  palabras_clave   text[] default '{}',    -- ['jubilacion','anses','retiro','aportes']
  -- Usuario interno responsable por defecto de esta área
  responsable_id   uuid references perfiles(user_id) on delete set null,
  activa           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_areas_org on areas (organizacion_id);

-- Cada usuario interno puede pertenecer a un área principal
alter table perfiles add column area_id uuid references areas(id) on delete set null;
alter table perfiles add column puesto text;   -- 'Secretaria', 'Abogado', 'Asistente'

-- El lead queda clasificado por área y asignado a un responsable
alter table leads add column area_id uuid references areas(id) on delete set null;
alter table leads add column asignado_a uuid references perfiles(user_id) on delete set null;

-- ------------------------------------------------------------
-- 2. RLS: áreas visibles/gestionables por la organización
--    (crear/editar/borrar áreas: solo dueño o admin)
-- ------------------------------------------------------------
alter table areas enable row level security;
create policy areas_select on areas for select
  using (organizacion_id = mi_organizacion());
create policy areas_write on areas for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy areas_update on areas for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy areas_delete on areas for delete
  using (organizacion_id = mi_organizacion() and soy_dueno());

create trigger aud_areas after insert or update or delete on areas
  for each row execute function registrar_auditoria();

-- ------------------------------------------------------------
-- 3. Invitaciones de equipo (el admin da de alta usuarios)
--    El usuario se registra con este email y queda vinculado
--    a la organización con el rol y área asignados.
-- ------------------------------------------------------------
create table invitaciones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  email            text not null,
  rol              text not null default 'miembro',   -- 'admin' | 'miembro'
  area_id          uuid references areas(id) on delete set null,
  puesto           text,
  estado           text not null default 'pendiente', -- 'pendiente' | 'aceptada'
  invitado_por     uuid references perfiles(user_id),
  created_at       timestamptz not null default now(),
  unique (organizacion_id, email)
);

alter table invitaciones enable row level security;
create policy invit_select on invitaciones for select
  using (organizacion_id = mi_organizacion());
create policy invit_write on invitaciones for insert
  with check (organizacion_id = mi_organizacion() and soy_gestor());
create policy invit_update on invitaciones for update
  using (organizacion_id = mi_organizacion() and soy_gestor());
create policy invit_delete on invitaciones for delete
  using (organizacion_id = mi_organizacion() and soy_gestor());

-- Al registrarse un usuario nuevo, si tiene invitación pendiente,
-- se vincula a esa organización (en vez de crear una nueva).
create or replace function procesar_invitacion()
returns trigger language plpgsql security definer as $$
declare inv record;
begin
  select * into inv from invitaciones
  where email = new.email and estado = 'pendiente' limit 1;

  if found then
    insert into perfiles (user_id, organizacion_id, rol, nombre, area_id, puesto)
    values (new.id, inv.organizacion_id, inv.rol,
            new.raw_user_meta_data->>'nombre', inv.area_id, inv.puesto);
    update invitaciones set estado = 'aceptada' where id = inv.id;
    return new;  -- NO crea organización nueva
  end if;
  return new;    -- sin invitación: sigue el flujo normal (crea su org)
end; $$;

-- Este trigger corre ANTES que el de alta_organizacion (por nombre alfabético
-- 'procesar_invitacion' vs 'alta_organizacion'); para asegurar el orden,
-- modificamos alta_organizacion para que NO cree org si ya hay perfil.
create or replace function alta_organizacion()
returns trigger language plpgsql security definer as $$
declare nueva_org uuid;
begin
  -- Si el usuario ya tiene perfil (vino por invitación), no crear org.
  if exists (select 1 from perfiles where user_id = new.id) then
    return new;
  end if;
  insert into organizaciones (nombre)
  values (coalesce(new.raw_user_meta_data->>'nombre_negocio', 'Mi negocio'))
  returning id into nueva_org;
  insert into perfiles (user_id, organizacion_id, rol, nombre)
  values (new.id, nueva_org, 'dueno', new.raw_user_meta_data->>'nombre');
  return new;
end; $$;

-- Recrear el trigger de invitación para que corra en el alta de usuario
drop trigger if exists trg_procesar_invitacion on auth.users;
create trigger trg_procesar_invitacion
  after insert on auth.users
  for each row execute function procesar_invitacion();
