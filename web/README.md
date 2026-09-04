# Sitio web (landing de AntüHene AI Studio)

Guardá acá tu `index.html` (el archivo de la landing que ya tenés).

- Con GitHub Pages: Settings → Pages → deploy desde la rama `main`,
  carpeta `/web` (o mové el index.html a la raíz y usá `/root`).
- Cuando el backend esté desplegado, el widget de chat de la landing
  puede llamar a `POST https://tu-backend/api/chat` con
  `{ canal_web, session_id, mensaje }` para hablar con el bot real
  en lugar de las respuestas fijas actuales.
