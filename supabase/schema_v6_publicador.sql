-- ============================================================
-- MIGRACIÓN V6 — Publicador de contenido programado
-- Ejecutar DESPUÉS de schema_v5_roles_auditoria.sql
-- Historias, feed, reels y carruseles programados por canal.
-- ============================================================

-- Ampliar la tabla publicaciones (creada en v2)
alter table publicaciones add column formato text not null default 'feed';
  -- 'feed' | 'story' | 'reel' | 'carrusel'
alter table publicaciones add column media_urls text[] default '{}';
  -- URLs públicas (Supabase Storage) de imagen(es)/video
alter table publicaciones add column creado_por uuid references perfiles(user_id);
alter table publicaciones add column intentos int not null default 0;
alter table publicaciones add column publicado_en timestamptz;

-- Recurrencia simple (ej: historia de "horarios" todos los lunes 9:00)
alter table publicaciones add column recurrencia text;
  -- null = única | 'diaria' | 'semanal' | 'mensual'

comment on column publicaciones.formato is
  'feed/story/reel/carrusel. Soporte por canal: IG(todos), FB(feed+story),
   TikTok(feed video/foto, sin story), LinkedIn(feed, sin story).
   WhatsApp Status NO tiene API: no se puede automatizar.';

-- Auditar el publicador (quién programó/borró contenido)
create trigger aud_publicaciones after insert or update or delete on publicaciones
  for each row execute function registrar_auditoria();

-- Índice ya existente idx_publicaciones_pendientes sigue válido.
