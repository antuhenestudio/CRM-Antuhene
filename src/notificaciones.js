// ============================================================
// NOTIFICACIONES POR EVENTO DE NEGOCIO
// Cada organización define reglas: "cuando pase X, avisá por
// WhatsApp a estos contactos". Los envíos respetan la ventana
// horaria (09–21 AR) y la cadencia humana de 36 s ± 3 s para no
// arriesgar el número (reutiliza humanizacion.js).
// ============================================================

const { enviarTexto } = require('./whatsapp');
const {
  dentroDeVentanaOutbound, notificarEnCadencia,
} = require('./humanizacion');

function rellenar(plantilla, lead) {
  return (plantilla || 'Novedad: {nombre} ({registro_interno}) — {interes}')
    .replace(/{nombre}/g, lead.nombre || 'Contacto')
    .replace(/{registro_interno}/g, lead.registro_interno || '-')
    .replace(/{interes}/g, lead.interes || '-')
    .replace(/{telefono}/g, lead.telefono || '-')
    .replace(/{zona}/g, lead.zona || '-');
}

/**
 * Dispara las reglas que coincidan con un evento.
 * @param {object} supabase
 * @param {string} evento   'lead_nuevo' | 'tier_a' | 'cita_agendada' | 'ganado'
 * @param {object} lead     el lead que originó el evento
 * @param {object} canal    canal de WhatsApp por el que sale el aviso
 */
async function dispararEvento(supabase, { evento, lead, canal }) {
  const { data: reglas } = await supabase
    .from('reglas_notificacion')
    .select('*')
    .eq('organizacion_id', lead.organizacion_id)
    .eq('evento', evento)
    .eq('activa', true);

  if (!reglas?.length) return;

  for (const regla of reglas) {
    const texto = rellenar(regla.plantilla, lead);
    const destinos = regla.contactos || [];

    // Fuera de la ventana horaria: los avisos proactivos esperan.
    // (Se podría encolar en eventos_programados para las 09:01;
    // acá, por simplicidad, se omite el envío nocturno.)
    if (!dentroDeVentanaOutbound()) {
      console.log(`Aviso "${evento}" diferido: fuera de ventana horaria`);
      continue;
    }

    // Cadencia humana entre contactos (sin ráfagas): 36 s ± 3 s.
    notificarEnCadencia(destinos, (destino) => enviarTexto(canal, destino, texto))
      .catch((e) => console.error('Error notificando evento:', e));
  }
}

module.exports = { dispararEvento };
