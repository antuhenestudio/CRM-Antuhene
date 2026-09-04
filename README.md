# AntüHene AI Studio — CRM SaaS Multicanal con IA Humanizada

> Documento maestro del proyecto. Resume todo lo definido: arquitectura,
> módulos, base de datos, decisiones de negocio, precios, integraciones y
> la hoja de ruta de puesta en marcha. Guardá este archivo en la raíz del
> repositorio como referencia y checklist.

**Fundador / CEO:** Pablo Ivañez López
**Ubicación:** Neuquén, Argentina
**Sitio:** antuhenestudio.github.io (panel) · dominio propio pendiente

---

## 1. Qué es AntüHene AI Studio

Un CRM multi-tenant que se vende como servicio a emprendedores y negocios.
Cada cliente se loguea, conecta sus canales (WhatsApp, Instagram, Facebook),
configura bots con IA conversacional humanizada, y gestiona sus leads,
publicaciones, métricas y agenda desde un solo panel.

**Diferencial central:** la IA humanizada ("el alma AntüHene") — respetuosa,
cercana, con neuroventas por estilo del prospecto, FOMO y CTA con moderación,
y cero invención de datos. Es igual en todos los bots; lo único que cambia es
el contenido que cada negocio carga.

---

## 2. Arquitectura general

\`\`\`
Panel web (HTML responsive)  --> GitHub Pages / Vercel
        | usa Supabase (anon key) + llama al backend
        v
Backend Node.js/Express      --> Railway / Render
        | webhook, IA, publicador, Antu, suscripciones
        v
Supabase (PostgreSQL + pgvector + Auth + RLS)
        |
        +-- WhatsApp Cloud API (oficial de Meta)
        +-- Instagram / Facebook (Graph API)
        +-- Google Calendar (citas)
        +-- OpenAI (gpt-4o-mini + embeddings + Whisper)
        +-- Mercado Pago (suscripciones + cursos)
\`\`\`

Regla de oro multi-tenant: cada cliente con su propia cuenta comercial de
Meta (WABA), conectada a la app de AntüHene — nunca todos bajo un mismo
portfolio (los límites de mensajería se comparten por portfolio).

---

## 3. Estructura del repositorio

\`\`\`
antuhene-ai-studio/
├── src/                         # Backend (Node.js)
│   ├── index.js                 # Servidor: webhook, rutas, orquestación
│   ├── alma.js                  # "El alma AntüHene": personalidad única de los bots
│   ├── ia.js                    # Respuestas con RAG + extracción de datos
│   ├── humanizacion.js          # Delays de tipeo, ventana horaria, cadencia 36s
│   ├── whatsapp.js              # Cliente WhatsApp Cloud API (oficial)
│   ├── leads.js                 # Persistencia: canales, leads, conversaciones
│   ├── conexiones.js            # OAuth Meta: conectar redes por el cliente
│   ├── calendar.js              # Google Calendar: OAuth, detección y creación de citas
│   ├── scoring.js               # Calificación configurable de leads (Tier A/B/C)
│   ├── publicador.js            # Contenido programado (IG/FB: feed/story/reel/carrusel)
│   ├── ingesta.js               # RAG: procesa PDF/Word/Excel/URL -> embeddings
│   ├── notificaciones.js        # Avisos por evento (respetando tiempos humanos)
│   ├── suscripciones.js         # Muro de pago (Mercado Pago, preapproval)
│   ├── antu.js                  # Antü: IA analista que genera insights
│   ├── academia.js              # Cursos, tests, progreso
│   └── certificado.js           # Certificado con firma del CEO
├── supabase/                    # Migraciones SQL (ejecutar EN ORDEN, ver seccion 4)
├── web/
│   ├── app.html                 # Panel del CRM (login + todas las secciones)
│   ├── index.html               # Landing comercial (pública)
│   ├── calculadora-precios.html # Calculadora de costos y precios
│   └── plantillas/              # Modelos descargables para clientes
├── .env.example                 # Variables de entorno (nunca subir el .env real)
├── package.json
└── README.md                    # Este archivo
\`\`\`

---

## 4. Base de datos (Supabase) — ejecutar EN ORDEN

En Supabase -> SQL Editor, correr una por una y en este orden:

1. schema.sql — leads, mensajes, documentos (pgvector), eventos
2. schema_v2_multitenant.sql — organizaciones, perfiles, canales, RLS
3. schema_v3_agentes.sql — agentes de IA, conversaciones, inbox, citas
4. schema_v4_rag_multitenant.sql — RAG filtrado por organización y agente
5. schema_v5_roles_auditoria.sql — roles (dueño/admin/miembro) + auditoría inmutable
6. schema_v6_publicador.sql — publicaciones con formato y recurrencia
7. schema_v7_ficha_metricas.sql — ficha ampliada, registro interno, gasto ads, CAC/ROI
8. schema_v8_personalizacion.sql — campos personalizados, fuentes RAG, reglas de aviso
9. schema_v9_scoring_agenda.sql — scoring configurable + agenda Google
10. schema_v10_perfil_horarios.sql — perfil del negocio + horarios de atención
11. schema_v11_suscripciones.sql — planes, suscripciones, pagos
12. schema_v12_insights.sql — insights de Antü
13. schema_v13_academia.sql — cursos, lecciones, tests, certificados
14. schema_v14_gestiones.sql — historial de gestiones por cliente (legajo)

---

## 5. Funcionalidades construidas

- Multi-tenant con RLS: cada cliente ve solo lo suyo, garantizado en Postgres.
- Login (Supabase Auth): registro, ingreso, sesión persistente.
- Bots configurables: crear N bots por cliente y enlazarlos a canales.
- Inbox unificado: WhatsApp + Instagram + Messenger, con handoff bot<->humano.
- Kanban de clientes: 7 columnas, arrastrar tarjetas, registro interno (AH-2026-0001).
- Ficha/legajo del cliente: popup con datos filiatorios + historial de gestiones fechadas.
- Scoring de leads: reglas por negocio -> Tier A/B/C, con campanita de calificados.
- Agenda Google Calendar: el bot detecta citas y las agenda (solo en horario comercial).
- Publicador: contenido programado a IG/FB (feed, story, reel, carrusel) con recurrencia.
- Memoria del bot (RAG): sube PDF/Word/Excel/URL o usa las plantillas; cero invención.
- Ficha del negocio: tipo, dirección con mapa, servicios, FAQ -> alimenta al bot.
- Roles y auditoría: dueño/admin/miembro; bitácora inmutable de quién hizo qué.
- Métricas de decisión: inversión, CAC y ROI REALES (solo con datos cargados).
- Antü (IA analista): observa el CRM y da recomendaciones, felicita, alerta.
- Academia: cursos con video (Vimeo protegido), tests, certificado firmado, pago individual.
- Suscripciones (Mercado Pago): muro de pago; sin pago no se conectan canales.
- Plantillas descargables: ficha, FAQ (Word), servicios, base de clientes (Excel).
- Responsive + íconos Lucide: menú hamburguesa en celular, todas las secciones accesibles.

---

## 6. Variables de entorno (.env)

Copiar .env.example a .env y completar. NUNCA subir el .env real a Git.

\`\`\`
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE=          # SOLO backend
# Meta / WhatsApp
WA_VERIFY_TOKEN=
META_APP_ID=
META_APP_SECRET=
OAUTH_REDIRECT_URL=https://tu-backend/conectar/meta/callback
OAUTH_STATE_SECRET=
# OpenAI
OPENAI_API_KEY=
# Google Calendar
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URL=https://tu-backend/conectar/google/callback
# Mercado Pago
MP_ACCESS_TOKEN=
MP_BACK_URL=https://tu-panel/app.html
\`\`\`

En el panel (web/app.html), editar las 3 líneas del bloque CONFIGURACIÓN:
SUPABASE_URL, SUPABASE_ANON_KEY (la anon es pública y segura) y BACKEND_URL.

---

## 7. Decisiones de negocio (lo que definimos)

### WhatsApp: SOLO API oficial (Cloud API)
Decisión firme: NO usar métodos no oficiales (Baileys / whatsapp-web.js / QR).
Emular WhatsApp Web viola los Términos de WhatsApp y termina en el baneo del
número del cliente — el canal con el que trabaja. Los "delays humanos" no lo
evitan (la detección es por firma técnica, no por velocidad). El consentimiento
del usuario no traslada el problema: el daño cae sobre el cliente final y sobre
la marca AntüHene. La vía oficial da multicuenta, sin baneos, y las
conversaciones entrantes son gratis.

### Neuroventas: por estilo, no por género
El bot adapta la persuasión al estilo del prospecto (apurado / dudoso /
precio / datos / frío), NO segmenta por género. FOMO y CTA siempre presentes
pero con moderación; urgencia solo si es real.

### Integraciones — matriz de viabilidad
| Canal | DMs automatizados | Publicar | Ads |
|---|---|---|---|
| WhatsApp | Si (Cloud API) | — | Si |
| Instagram | Si (Graph API) | Si | Si |
| Facebook | Si (Graph API) | Si | Si |
| TikTok | Si (Business Messaging API; cuenta Business; verificar AR) | Si | Si |
| LinkedIn | No (prohibido automatizar DMs) | Si (páginas) | Si |
| SEO local | Google Business Profile API (ficha + responder reseñas con IA) | | |

### Costos de IA (OpenAI, verificado sep 2026, en USD)
- Texto gpt-4o-mini: 0,15/M entrada · 0,60/M salida
- Audio Whisper: 0,006/min · Embeddings: 0,02/M
- Bot promedio (1000 conversaciones/mes + 30% audio): ~US4,4/mes (~6.500 ARS)
- El costo variable que más pesa es WhatsApp (Meta), no la IA. El dólar es la variable crítica.

### Conversaciones que aguanta cada plan (costo IA ~15% del precio)
| Plan | Precio/mes | Conv/día cómodas |
|---|---|---|
| Emprendedor | 35.000 | ~27 |
| Profesional | 70.000 | ~53 |
| Negocio | 120.000 | ~92 |

> Los precios son un PUNTO DE PARTIDA. Verificar con la calculadora
> (web/calculadora-precios.html) usando costos reales, y comparar con la
> competencia en Argentina antes de publicarlos. Editar en la tabla planes.

---

## 8. Puesta en marcha (checklist)

### A) Código en GitHub
- [ ] Subir el repositorio (privado) a GitHub.
- [ ] Verificar que .gitignore excluye .env.

### B) Supabase
- [ ] Crear proyecto en supabase.com.
- [ ] Ejecutar las 14 migraciones en orden (seccion 4).
- [ ] Copiar SUPABASE_URL, service_role y anon.

### C) Backend (Railway / Render)
- [ ] Conectar el repo, cargar variables de entorno (seccion 6).
- [ ] Anotar la URL pública del backend.

### D) Panel (GitHub Pages / Vercel)
- [ ] Editar las 3 líneas de CONFIGURACIÓN en web/app.html.
- [ ] Publicar. (Ya está en antuhenestudio.github.io)

### E) Meta Business (empezar YA, es lo lento)
- [ ] Crear Meta Business Portfolio (business.facebook.com).
- [ ] Iniciar Business Verification (días/semanas).
- [ ] Crear app Business + producto WhatsApp + Facebook Login for Business.
- [ ] Configurar Embedded Signup con la redirect URL.
- [ ] App Review: whatsapp_business_management, whatsapp_business_messaging, business_management.
- [ ] Mientras espera: probar con el número de prueba y clientes como testers.

### F) Google Cloud (para la agenda)
- [ ] Proyecto en Google Cloud Console, activar Calendar API.
- [ ] Configurar pantalla de consentimiento OAuth + credenciales.

### G) Mercado Pago
- [ ] Crear aplicación, obtener Access Token.
- [ ] Configurar el webhook: https://tu-backend/webhook/mercadopago
- [ ] Confirmar la comisión vigente en el panel de MP.

### H) Cómo conecta un cliente su WhatsApp (una vez todo listo)
1. Cliente -> panel -> "Conectar WhatsApp" -> popup oficial de Meta.
2. Inicia sesión, crea/elige su WABA, ingresa su número NUEVO, lo verifica por SMS.
3. Queda conectado al CRM; el webhook recibe sus mensajes.
> Cada cliente con su propia WABA (para no compartir límites).

---

## 9. Cumplimiento legal (importante — no es asesoramiento legal)

Manejás WhatsApp de terceros y datos de sus clientes finales. Obligaciones:
- Meta: publicar Política de Privacidad; cumplir políticas de mensajería.
- Argentina (Ley 25.326 de Protección de Datos Personales): sos responsable
  del tratamiento; conviene registrar la base ante la AAIP y tener texto de
  privacidad y términos claros que tus clientes acepten.
- Datos sensibles (DNI, datos de ART/salud): más razón para consentimiento y resguardo.

Recomendación: consultar con un abogado especializado en protección de datos.
(Tenés un estudio jurídico como cliente — puede ser un buen intercambio.)

---

## 10. Roadmap (próximos pasos posibles)

- [ ] Desplegar y probar de punta a punta con el número de prueba de Meta.
- [ ] Antü v2: que gpt-4o-mini redacte cada insight de forma única y contextual.
- [ ] Redacción con IA de avisos y saludos (Fidelización 365).
- [ ] TikTok/LinkedIn Lead Ads -> CRM (traer leads por la vía oficial).
- [ ] Meta Conversions API (CAPI) + Click-to-WhatsApp (atribución de Ads).
- [ ] PWA (instalable en el celular como app).
- [ ] Panel de administración de AntüHene (crear cursos, ver clientes).

---

Construido paso a paso. Todo el sistema respeta la regla de no inventar datos
(ni el bot con los clientes, ni las métricas con los números). La honestidad
del producto es parte de la marca AntüHene.
