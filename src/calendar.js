// ============================================================
// GOOGLE CALENDAR (multi-tenant) — agenda por negocio
// - OAuth: cada organización conecta su propia cuenta de Google.
// - Detección de fecha/hora en lenguaje natural desde el chat.
// - Creación del evento en la agenda del cliente.
// El calendario se muestra dentro del panel embebido (iframe con
// el calendar_id de la organización).
// ============================================================

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

// ---- OAuth ----
function urlConexionGoogle(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URL,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',      // para recibir refresh_token
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH}?${p}`;
}

async function canjearCodeGoogle(code) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URL,
      grant_type: 'authorization_code',
    }),
  });
  return res.json(); // { access_token, refresh_token, ... }
}

/** El refresh_token (guardado en el canal) da un access_token fresco. */
async function accessTokenDesdeRefresh(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('No se pudo refrescar el token de Google');
  return d.access_token;
}

/** Crea un evento en la agenda de la organización. */
async function crearEvento(canalGoogle, { titulo, descripcion, inicio, fin }) {
  const accessToken = await accessTokenDesdeRefresh(canalGoogle.token_acceso);
  const calendarId = canalGoogle.metadatos?.calendar_id || 'primary';
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo,
      description: descripcion,
      start: { dateTime: inicio, timeZone: 'America/Argentina/Buenos_Aires' },
      end:   { dateTime: fin,    timeZone: 'America/Argentina/Buenos_Aires' },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data; // incluye data.id = gcal_event_id
}

/**
 * Detección de intención de cita en lenguaje natural usando la IA.
 * Devuelve { quiere_cita, inicio_iso, fin_iso, titulo } o null.
 * Usa la fecha actual como referencia para resolver "el jueves".
 */
async function detectarCita(mensaje, contextoNombre = 'Cliente') {
  const hoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `Fecha y hora actual en Argentina: ${hoy}.
Analizá si el mensaje propone o confirma una cita/turno con día y hora concretos.
Respondé SOLO JSON, sin markdown:
{"quiere_cita": true|false, "inicio_iso": "YYYY-MM-DDTHH:MM:SS", "duracion_min": 30, "titulo": "..."}
Si no hay una fecha Y hora concretas, devolvé {"quiere_cita": false}.
Resolvé expresiones como "el jueves a las 10" respecto de la fecha actual.
No inventes: si falta el día o la hora, quiere_cita = false.`,
        },
        { role: 'user', content: mensaje },
      ],
    }),
  });
  try {
    const d = await res.json();
    const j = JSON.parse(d.choices[0].message.content.replace(/```json|```/g, '').trim());
    if (!j.quiere_cita || !j.inicio_iso) return null;
    const inicio = new Date(j.inicio_iso);
    const fin = new Date(inicio.getTime() + (j.duracion_min || 30) * 60000);
    return {
      titulo: j.titulo || `Cita con ${contextoNombre}`,
      inicio_iso: inicio.toISOString(),
      fin_iso: fin.toISOString(),
    };
  } catch {
    return null;
  }
}

module.exports = {
  urlConexionGoogle, canjearCodeGoogle, crearEvento, detectarCita,
};
