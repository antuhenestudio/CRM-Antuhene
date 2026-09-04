# Web de AntüHene AI Studio

Acá van las dos caras del producto:

## `index.html` — Landing comercial (público)
La página que atrae clientes (la que ya tenés diseñada). Guardá tu
`index.html` en esta carpeta. Si aún no lo tenés, se puede regenerar.

## `app.html` — Panel del CRM (privado, con login)
La aplicación donde el cliente se loguea y trabaja: resumen, inbox
multicanal, tablero Kanban de clientes, publicaciones programadas y
conexión de redes.

### Configurar el panel
Abrí `app.html` y editá las 3 líneas del bloque CONFIGURACIÓN:

```js
const SUPABASE_URL      = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-CLAVE-ANON';        // Settings → API (la anon es pública y segura)
const BACKEND_URL       = 'https://TU-BACKEND.railway.app';
```

- La clave **anon** es la única que va en el frontend. NUNCA pongas acá
  la `service_role`: esa vive solo en el backend.
- El aislamiento entre clientes lo garantiza RLS en Supabase.

### Probar sin configurar nada
Abrí `app.html` en el navegador y tocá **"Ver demo sin cuenta"**: verás
el panel funcionando con datos de ejemplo (un estudio jurídico de muestra).

### Publicar
Con GitHub Pages / Vercel / Netlify, esta carpeta se sirve como sitio
estático. La landing queda en `/index.html` y el panel en `/app.html`.

## Plantillas para clientes (web/plantillas/)
Modelos descargables que el cliente completa y vuelve a subir:
ficha del negocio (Word), preguntas frecuentes (Word), catálogo de
servicios (Excel) y base de clientes (Excel). Se sirven junto al panel
y el backend los procesa con el módulo de ingesta.

## widget.js — Bot para sitios web de los clientes
El cliente obtiene su snippet desde el panel (Conectar redes → Bot para tu
sitio web) y lo pega en su página. El widget habla con /api/chat usando su
canal `web`, responde con el alma AntüHene + su RAG + ficha, y capta contactos
en el CRM. Requiere un canal tipo `web` creado para esa organización.
