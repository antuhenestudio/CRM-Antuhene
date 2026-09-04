# AntüHene AI Studio — CRM SaaS Multicanal con IA Humanizada

Plataforma multi-tenant: cada emprendedor se loguea, conecta sus canales
(WhatsApp, Instagram, Facebook…), configura sus **agentes de IA** (voz +
objetivo + conocimiento propio) y gestiona leads en un Kanban con inbox
unificado y handoff bot ⇄ humano.

## Arquitectura

```
WhatsApp Cloud API (webhook único para todos los clientes)
        │  phone_number_id
        ▼
canales ──► organización ──► agente de IA (voz, objetivo, RAG propio)
        │
        ▼
Node.js/Express ──► OpenAI (gpt-4o-mini + embeddings)
        │
        ▼
Supabase: leads · conversaciones · mensajes · documentos(pgvector) · RLS
```

## Estructura del repo

```
src/               Backend (webhook, humanización, IA, persistencia)
supabase/          Migraciones SQL (ejecutar EN ORDEN: schema.sql → v2 → v3 → v4)
web/               Landing (index.html) para GitHub Pages
ARQUITECTURA-SAAS.md   Modelo de negocio, agentes y matriz de integraciones
```

## Puesta en marcha

1. **Supabase**: creá el proyecto y ejecutá en SQL Editor, en orden:
   `schema.sql`, `schema_v2_multitenant.sql`, `schema_v3_agentes.sql`,
   `schema_v4_rag_multitenant.sql`, `schema_v5_roles_auditoria.sql`, `schema_v6_publicador.sql`.
2. **Meta**: app Business con producto WhatsApp; webhook →
   `https://tu-backend/webhook` con tu `WA_VERIFY_TOKEN`, campo `messages`.
3. **Deploy**: conectá este repo a Railway/Render, cargá las variables
   de `.env.example`.
4. **Alta de un cliente** (mientras no exista el panel):
   - Insertar fila en `organizaciones`.
   - Insertar su `agente` (nombre, objetivo, personalidad, rubro).
   - Insertar su `canal` tipo `whatsapp` con `identificador` =
     phone_number_id y `token_acceso` = token de ese número, y
     `agente_id` del agente. En `metadatos` podés poner
     `{"telefonos_alerta": ["549299..."]}`.
   - Cargar sus `documentos` (con embedding) para el RAG.
5. **Widget web**: crear un canal tipo `web` (identificador libre, ej.
   `antuhene-landing`) y apuntar el chat del sitio a `POST /api/chat`.

## Subir a GitHub

```bash
cd crm-whatsapp
git init
git add .
git commit -m "AntüHene AI Studio: CRM multi-tenant con IA humanizada (base)"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/antuhene-ai-studio.git
git push -u origin main
```

⚠️ El `.gitignore` ya excluye `.env`. Nunca subas claves al repo: si un
token llega a Git, regeneralo.

## Notas importantes

- **Handoff**: si `conversaciones.modo = 'humano'`, el bot se silencia y
  el equipo responde desde el panel; las `notas_internas` son invisibles
  para el cliente final.
- **Mensajes proactivos** (retargeting, cumpleaños): fuera de la ventana
  de 24 h Meta exige plantillas pre-aprobadas; respetar la ventana
  09:00–21:00 AR (`humanizacion.js`).
- **Rubro jurídico**: el agente está instruido para no dar asesoramiento
  legal de fondo ni citar normas o fallos; todo contenido legal del RAG
  debe redactarlo/validarlo el profesional del estudio.
- **Integraciones**: ver la matriz de viabilidad en ARQUITECTURA-SAAS.md
  antes de prometer canales (TikTok y LinkedIn no permiten DMs por API).

## Roadmap

- [x] Núcleo multi-tenant: webhook → canal → agente, handoff, chat web
- [ ] Panel con login (Supabase Auth): inbox, Kanban, creador de agentes
- [ ] Cron de eventos (retargeting + Fidelización 365) con plantillas
- [x] Conexión autoservicio OAuth (FB/IG) + Embedded Signup (WhatsApp)
- [ ] Webhooks de Instagram/Messenger (DMs por Graph API)
- [ ] Publicador de contenido, Ads y facturación (Mercado Pago)
