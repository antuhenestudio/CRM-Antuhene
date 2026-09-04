-- ============================================================
-- MIGRACIÓN V13 — Academia de capacitaciones
-- Ejecutar DESPUÉS de schema_v12_insights.sql
--   Cursos con videos + tests por lección + certificado firmado.
--   Pago individual por Mercado Pago (NO incluido en los planes).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CURSOS (los crea AntüHene, no el cliente)
-- ------------------------------------------------------------
create table cursos (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  descripcion   text,
  categoria     text,                 -- 'marketing' | 'negocios' | 'ventas' | 'ia'
  nivel         text default 'inicial',
  precio_ars    numeric(12,2) not null default 0,
  portada_url   text,
  publicado     boolean not null default false,
  orden         int not null default 0,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. LECCIONES (videos dentro de cada curso)
-- ------------------------------------------------------------
create table lecciones (
  id            uuid primary key default gen_random_uuid(),
  curso_id      uuid not null references cursos(id) on delete cascade,
  titulo        text not null,
  vimeo_id      text,                 -- SOLO el ID numérico de Vimeo (nunca la URL)
                                      -- El video debe tener en Vimeo: "Hide from Vimeo"
                                      -- + embed restringido a tu dominio.
  duracion_min  int,
  orden         int not null default 0,
  created_at    timestamptz not null default now()
);
create index idx_lecciones_curso on lecciones (curso_id, orden);

-- ------------------------------------------------------------
-- 3. PREGUNTAS DE TEST (dentro de cada lección)
-- ------------------------------------------------------------
create table preguntas_test (
  id             uuid primary key default gen_random_uuid(),
  leccion_id     uuid not null references lecciones(id) on delete cascade,
  pregunta       text not null,
  opciones       jsonb not null,       -- ["opción A","opción B","opción C"]
  correcta       int not null,         -- índice de la opción correcta (0-based)
  orden          int not null default 0
);
create index idx_preguntas_leccion on preguntas_test (leccion_id, orden);

-- ------------------------------------------------------------
-- 4. INSCRIPCIONES (quién compró qué curso)
-- ------------------------------------------------------------
create table inscripciones (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  organizacion_id  uuid references organizaciones(id) on delete set null,
  curso_id         uuid not null references cursos(id) on delete cascade,
  estado_pago      text not null default 'pendiente', -- 'pendiente'|'pagado'
  mp_payment_id    text,
  completado       boolean not null default false,
  certificado_id   text,               -- código único del certificado
  completado_en    timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, curso_id)
);
create index idx_inscripciones_user on inscripciones (user_id);

-- ------------------------------------------------------------
-- 5. PROGRESO por lección (videos vistos + test aprobado)
-- ------------------------------------------------------------
create table progreso_lecciones (
  user_id       uuid not null references auth.users(id) on delete cascade,
  leccion_id    uuid not null references lecciones(id) on delete cascade,
  video_visto   boolean not null default false,
  test_aprobado boolean not null default false,
  puntaje       int,                   -- % de aciertos en el test
  actualizado   timestamptz not null default now(),
  primary key (user_id, leccion_id)
);

-- ------------------------------------------------------------
-- 6. Marca un curso como completado cuando todas sus lecciones
--    tienen video visto + test aprobado. Emite el código de
--    certificado (verificable).
-- ------------------------------------------------------------
create or replace function verificar_curso_completo(p_user uuid, p_curso uuid)
returns void language plpgsql security definer as $$
declare total int; hechas int; cod text;
begin
  select count(*) into total from lecciones where curso_id = p_curso;
  select count(*) into hechas
  from progreso_lecciones pl
  join lecciones l on l.id = pl.leccion_id
  where l.curso_id = p_curso and pl.user_id = p_user
    and pl.video_visto and pl.test_aprobado;

  if total > 0 and hechas >= total then
    cod := 'AH-CERT-' || upper(substr(md5(p_user::text || p_curso::text), 1, 10));
    update inscripciones
      set completado = true, completado_en = now(), certificado_id = cod
      where user_id = p_user and curso_id = p_curso and completado = false;
  end if;
end; $$;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
-- Cursos y lecciones: catálogo público (para mostrar la tienda).
-- Las preguntas de test NO se exponen con su respuesta al frontend:
-- la corrección se hace en el backend.
alter table cursos            enable row level security;
alter table lecciones         enable row level security;
alter table preguntas_test    enable row level security;
alter table inscripciones     enable row level security;
alter table progreso_lecciones enable row level security;

create policy cursos_pub on cursos for select using (publicado = true);
create policy lecciones_pub on lecciones for select using (true);
-- preguntas_test: sin policy de select para authenticated → solo backend.

create policy insc_propia on inscripciones for select
  using (user_id = auth.uid());
create policy insc_update on inscripciones for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy prog_propio on progreso_lecciones for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
