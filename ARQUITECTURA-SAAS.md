# AntüHene AI Studio — Arquitectura SaaS: CRM Multicanal para Emprendedores

## Modelo
Cada cliente (emprendedor) = una **organización**. Se registra, se loguea
(Supabase Auth) y desde un solo panel: responde su inbox multicanal con IA,
ve su Kanban de leads, programa contenido y mira métricas de sus Ads.
RLS en Postgres garantiza el aislamiento total entre clientes.

## Ruteo multi-tenant del webhook
Un solo backend recibe TODOS los webhooks de Meta. El campo
`metadata.phone_number_id` (WhatsApp) o el `page_id`/`ig_user_id`
(Messenger/Instagram) del payload identifica el canal:

```
webhook → buscar en `canales` por identificador → organizacion_id
        → procesar con el token y el RAG de ESA organización
```

Cambio necesario en `src/leads.js`: `obtenerOCrearLead(telefono, nombre,
organizacionId)` y en `src/whatsapp.js`: el token deja de venir de .env y
se lee del canal correspondiente (con caché en memoria).

## Conexión de canales del cliente (autoservicio)
| Canal | Mecanismo oficial | Permiso de App Review |
|---|---|---|
| WhatsApp | Embedded Signup (popup de Meta dentro de tu CRM) | whatsapp_business_management / _messaging |
| Instagram DMs + publicar | Login con Facebook → seleccionar cuenta IG | instagram_manage_messages, instagram_content_publish |
| Facebook Página | Login con Facebook → seleccionar página | pages_messaging, pages_manage_posts |
| Meta Ads | OAuth sobre la cuenta publicitaria | ads_read / ads_management |

Requisitos previos: verificación del negocio en Meta Business Manager y
App Review aprobado. **Iniciar este trámite en paralelo al desarrollo**
(puede demorar semanas). Mientras tanto: onboarding manual (vos conectás
los canales de cada cliente desde tu propio Business Manager como
proveedor tecnológico), que además valida el negocio con clientes reales.

## Modelo de Agentes (v3)
Un **agente** es una configuración de IA: nombre, objetivo, personalidad y
RAG propio. Un agente atiende N canales con la misma voz; una organización
crea N agentes. Ejemplo (estudio jurídico):

```
Agente "Jubilaciones"  → WhatsApp 299-111... + Instagram del estudio
Agente "Sucesiones"    → WhatsApp 299-222...
Agente "ART"           → WhatsApp 299-333... + Messenger
```

Cada conversación tiene modo `bot` o `humano`: cuando un operador la toma
desde el inbox, el bot se silencia (handoff) y el equipo puede dejar
**notas internas** invisibles para el cliente final.

## Matriz de viabilidad de integraciones (ser honesto con el cliente)
| Integración | Estado | Vía |
|---|---|---|
| WhatsApp (varios números por cliente) | ✅ | Cloud API, cada número = canal |
| Instagram DMs + publicar | ✅ | Graph API (App Review) |
| Facebook Messenger + publicar | ✅ | Graph API (App Review) |
| Google Calendar (citas del bot) | ✅ | Google OAuth + Calendar API |
| Meta Ads (métricas + CAPI + CTWA) | ✅ | Marketing API |
| Google Ads | ✅ | API con developer token aprobado |
| TikTok Ads | ✅ | TikTok Marketing API |
| TikTok publicar contenido | ✅ | Content Posting API (aprobación) |
| TikTok DMs | ❌ | Sin API para terceros → cubrir con comentarios y lead ads |
| LinkedIn publicar + Ads | ✅ | Marketing API (programa de socios) |
| LinkedIn DMs automatizados | ❌ | Prohibido por LinkedIn; automatizarlo arriesga la cuenta del cliente |
| SEO local | ✅ | Google Business Profile API: ficha, posts y respuesta de reseñas con IA |
| "SEO IA" (visibilidad en asistentes) | ⚠️ | No es API: módulo de consultoría + reportes |

## Fases del producto SaaS
1. **Núcleo actual**: bot WhatsApp humanizado + leads + Kanban (por tenant).
2. **Panel del cliente**: login, inbox de WhatsApp, Kanban, carga de su RAG.
3. **Publicador**: calendario de contenido → cron publica en IG/FB a la hora
   programada (tabla `publicaciones`).
4. **Ads**: lectura de campañas y métricas por cliente (tabla `campanias_ads`),
   atribución Click-to-WhatsApp y CAPI.
5. **Facturación**: planes trial/básico/pro (campo `plan`) con Mercado Pago
   suscripciones.

## Seguridad
- Tokens de clientes: solo legibles por el backend (service_role); el
  frontend usa la vista `canales_publicos`. Cifrarlos en reposo
  (Supabase Vault) antes de salir a producción.
- El frontend usa exclusivamente la clave `anon` + RLS.

## Roles y auditoría (v5)
| Acción | dueno | admin | miembro |
|---|---|---|---|
| Ver leads, chats, Kanban | ✅ | ✅ | ✅ |
| Responder mensajes / mover Kanban / notas | ✅ | ✅ | ✅ |
| Crear/editar agentes, documentos, publicaciones | ✅ | ✅ | ❌ |
| Borrar leads, conversaciones, agentes, docs | ✅ | ❌ | ❌ |
| Invitar equipo y cambiar roles | ✅ | ❌ | ❌ |
| Editar o borrar mensajes / auditoría | ❌ | ❌ | ❌ |

- Aplicado con RLS en Postgres: la restricción vale aunque se ataque la API directa.
- Cada mensaje humano se firma con la sesión real (`auth.uid()`) vía trigger:
  no se puede enviar "en nombre de otro".
- Tabla `auditoria` (inmutable): quién hizo qué, cuándo, con datos antes/después.
  `user_id null` = acción del bot/sistema. Argumento de venta directo para
  estudios jurídicos y empresas con empleados.

## Publicador programado (v6) — soporte real por red
| Red | Feed | Historias | Reels/Video | Carrusel |
|---|---|---|---|---|
| Instagram | ✅ | ✅ (API oficial) | ✅ | ✅ |
| Facebook (página) | ✅ | ✅ (Page Stories) | ✅ | — |
| TikTok | ✅ video/foto (con aprobación) | ❌ sin API | ✅ | ✅ fotos |
| LinkedIn (página) | ✅ (programa socios) | ❌ (no existen) | ✅ | ✅ |
| WhatsApp Estados | ❌ SIN API — no automatizable por nadie | | | |

Worker: revisa la cola cada 60 s, publica con 3 reintentos, soporta
recurrencia (diaria/semanal/mensual) y deja auditoría de quién programó qué.
Los archivos (imagen/video) se suben a Supabase Storage y se referencian
por URL pública en `media_urls`.

## Conexión autoservicio de canales (OAuth)
Flujo del cliente: panel → "Conectar redes" → popup oficial de Meta →
se loguea y autoriza → el backend canjea el code por un token de larga
duración, descubre sus páginas de Facebook y cuentas de Instagram
vinculadas, y las da de alta como `canales` con sus tokens.
WhatsApp usa Embedded Signup (popup JS de Meta dentro del panel) →
`POST /conectar/whatsapp` registra los números.

Requisitos en la app de Meta para producción:
1. Verificación del negocio (Business Manager).
2. App Review aprobado para los permisos de SCOPES (conexiones.js).
3. "Facebook Login for Business" configurado con la redirect URL exacta.
4. Embedded Signup habilitado (producto WhatsApp).
Mientras tanto, en modo desarrollo funciona con cuentas de prueba y
con clientes cargados como testers de la app.

Seguridad: nunca se piden contraseñas; el `state` va firmado (HMAC,
15 min de validez) para que nadie conecte canales a una organización
ajena; el cliente revoca el acceso cuando quiera desde su Facebook.

## El "alma AntüHene" (personalidad única de todos los bots)
La humanización es ÚNICA para todos los bots de todos los clientes,
definida en `src/alma.js` (el corazón versionado del producto). Lo único
que cambia entre bots es el CONTENIDO: la ficha del negocio (perfil_negocio)
y el conocimiento cargado (RAG). Principios del alma:
- Respeto, cordialidad, cercanía, voseo argentino natural.
- Neuroventas por ESTILO del prospecto (apurado / dudoso / precio / datos /
  frío), NO por género — más efectivo y sin riesgo de marca.
- FOMO y CTA siempre presentes pero con moderación; urgencia solo si es real.
- Cero invención: solo afirma lo que está en la ficha y el RAG.

Al cambiar `alma.js`, mejora el comportamiento de TODOS los bots a la vez:
es la palanca central para subir la calidad de conversión de la plataforma.

## "Antü": la IA analista del CRM (v12)
Un motor (`src/antu.js`) analiza el CRM de cada organización cada 3 h y
genera insights (alertas, felicitaciones, sugerencias, recomendaciones)
guardados en la tabla `insights`. En el panel, la burbuja de Antü los
muestra con su voz cálida, con contador de no vistos y CTA que lleva a la
sección relevante. Arranca con reglas deterministas (leads Tier A sin
contactar, racha de cierres, sin publicaciones, conocimiento vacío, muchos
perdidos, cumpleaños de la semana); más adelante se suma redacción con IA.
