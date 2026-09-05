// ============================================================
// RESUMEN Y DETERMINACIÓN DE CONVERSACIONES (con IA)
// TONO INTERNO: canchero, directo, con calle — como un colega
// que te explica la situación sin vueltas para que actúes rápido.
// Es para consumo del EQUIPO dentro del CRM, no para el cliente.
// ============================================================

const { generarConRespaldo } = require('./ia');

async function resumirConversacion(historial) {
  const conversacion = historial
    .map((m) => `${m.autor === 'cliente' ? 'Cliente' : 'Bot'}: ${m.contenido}`)
    .join('\n');

  const system = `Sos el mano derecha del dueño de un negocio, mirando el CRM.
Te paso una conversación entre un prospecto y el bot. Tu laburo es resumirla
para el equipo con tono CANCHERO y DIRECTO, con calle, como un colega que te
dice las cosas de frente para que actúes rápido. Nada de formalismo acá: esto
es para adentro, para que el equipo sepa qué hacer YA.

Devolvé SOLO un JSON válido, sin markdown, con:
{
  "resumen": "2-3 líneas contando quién es y qué necesita, en criollo",
  "determinacion": "la posta: qué tan caliente está y qué hacer YA (ej: 'está caliente, ya dejó el teléfono y pidió reunión — llamalo hoy que se te escapa'). Sé directo y accionable.",
  "nombre": "nombre del prospecto si lo dijo, o null",
  "interes": "el tema/motivo principal, o null",
  "temperatura": "frio | tibio | caliente"
}
Reglas: no inventes datos que no estén en la charla. En 'determinacion' explicá
POR QUÉ está en esa temperatura (qué señales dio) y qué conviene hacer.`;

  const texto = await generarConRespaldo({
    system,
    mensajes: [{ role: 'user', content: conversacion }],
    temperature: 0.4, maxTokens: 400,
  });
  try {
    const limpio = texto.replace(/```json|```/g, '').trim();
    return JSON.parse(limpio);
  } catch {
    return { resumen: 'No se pudo generar el resumen.', determinacion: '', nombre: null, interes: null, temperatura: 'frio' };
  }
}

module.exports = { resumirConversacion };
