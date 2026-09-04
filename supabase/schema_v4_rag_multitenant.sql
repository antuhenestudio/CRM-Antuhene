-- ============================================================
-- MIGRACIÓN V4 — RAG multi-tenant
-- Ejecutar DESPUÉS de schema_v3_agentes.sql.
-- La búsqueda semántica ahora filtra por organización y agente:
-- el bot de "Sucesiones" jamás responde con datos de otro
-- cliente ni de otro agente.
-- ============================================================

drop function if exists buscar_documentos(vector, text, int);

create or replace function buscar_documentos(
  query_embedding vector(1536),
  filtro_org uuid,
  filtro_agente uuid default null,
  cantidad int default 4
)
returns table (titulo text, contenido text, similitud float)
language sql stable as $$
  select d.titulo, d.contenido,
         1 - (d.embedding <=> query_embedding) as similitud
  from documentos d
  where d.organizacion_id = filtro_org
    and (d.agente_id is null or d.agente_id = filtro_agente)
  order by d.embedding <=> query_embedding
  limit cantidad;
$$;
