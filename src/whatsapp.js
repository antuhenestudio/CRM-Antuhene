// ============================================================
// Cliente WhatsApp Cloud API (oficial de Meta) — multi-tenant
// Cada llamada usa el token y phone_number_id DEL CANAL del
// cliente (leídos de la tabla `canales`), no de variables .env.
// ============================================================

const API_VERSION = 'v21.0';

async function llamarApi(canal, body) {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${canal.identificador}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${canal.token_acceso}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) console.error('Error WhatsApp API:', res.status, await res.text());
  return res.json().catch(() => ({}));
}

/** Marca como leído + "Escribiendo…" (dura hasta 25 s o hasta responder). */
function mostrarEscribiendo(canal, wamid) {
  return llamarApi(canal, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: wamid,
    typing_indicator: { type: 'text' },
  });
}

/** Texto libre (válido dentro de la ventana de 24 h). */
function enviarTexto(canal, telefono, texto) {
  return llamarApi(canal, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'text',
    text: { body: texto },
  });
}

/** Plantilla aprobada por Meta (mensajes proactivos fuera de 24 h). */
function enviarPlantilla(canal, telefono, nombrePlantilla, variables = []) {
  return llamarApi(canal, {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'template',
    template: {
      name: nombrePlantilla,
      language: { code: 'es_AR' },
      components: variables.length
        ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }]
        : [],
    },
  });
}

module.exports = { mostrarEscribiendo, enviarTexto, enviarPlantilla };
