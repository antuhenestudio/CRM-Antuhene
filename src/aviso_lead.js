// ============================================================
// AVISO DE LEAD AL EQUIPO (con resumen IA completo)
// Cuando un prospecto termina de conversar (sin actividad por X
// minutos), la IA arma un aviso rico con el resumen y la
// determinación, y lo publica como insight en el panel. Si hay
// WhatsApp conectado + reglas, también lo envía por ese canal.
//
// Ejemplo del aviso que genera:
// "🔔 Nuevo lead Interesado por Instagram. Pablo Pérez tuvo un
//  accidente laboral (en moto yendo al trabajo), requiere
//  asistencia por videollamada. Contactar al 2996737073."
// ============================================================

const { resumirConversacion } = require('./resumen');

const CANAL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', web: 'la web' };

/**
 * Genera y publica el aviso de un lead que terminó de conversar.
 * @param {object} supabase
 * @param {object} conversacion  { id, lead_id, canal_id, organizacion_id }
 */
async function avisarLeadCompleto(supabase, conversacion) {
  // 1. Traer el historial completo de la conversación
  const { data: mensajes } = await supabase
    .from('mensajes').select('autor, contenido')
    .eq('conversacion_id', conversacion.id)
    .order('created_at', { ascending: true });
  if (!mensajes || mensajes.length < 2) return; // charla muy corta

  // 2. Traer datos del lead y del canal
  const { data: lead } = await supabase
    .from('leads').select('*').eq('id', conversacion.lead_id).maybeSingle();
  const { data: canal } = await supabase
    .from('canales').select('tipo').eq('id', conversacion.canal_id).maybeSingle();
  const porDonde = CANAL_LABEL[canal?.tipo] || 'un canal';

  // 3. La IA arma el resumen y la determinación
  let analisis;
  try { analisis = await resumirConversacion(mensajes); }
  catch (e) { console.warn('Resumen del aviso falló:', e.message); return; }

  const nombre = analisis.nombre || lead?.nombre || 'Un prospecto';
  const contacto = (lead?.telefono || '').replace('web:', '') || 'sin teléfono';

  // 4. Armar el texto del aviso, tipo el ejemplo de Pablo
  const textoAviso =
    `🔔 Nuevo lead por ${porDonde}. ${analisis.resumen || ''} ` +
    `${analisis.determinacion || ''} Contactar al ${contacto}.`;

  // 5. Publicar como insight en el panel (aparece YA, sin depender de WhatsApp)
  try {
    await supabase.from('insights').insert({
      organizacion_id: conversacion.organizacion_id,
      tipo: 'alerta', zona: 'inbox', prioridad: 3,
      titulo: `Nuevo lead: ${nombre} (por ${porDonde})`,
      mensaje: textoAviso,
      accion_texto: 'Ver conversación', accion_zona: 'inbox',
    });
  } catch (e) { console.warn('Insight del aviso falló:', e.message); }

  // 6. Enviar por WhatsApp a los contactos configurados (si hay canal WA activo)
  //    Requiere WhatsApp oficial conectado (Meta). Si no hay, se omite.
  try {
    const { enviarTexto } = require('./whatsapp');
    const { notificarEnCadencia, dentroDeVentanaOutbound } = require('./humanizacion');

    const { data: reglas } = await supabase
      .from('reglas_notificacion').select('contactos')
      .eq('organizacion_id', conversacion.organizacion_id)
      .eq('evento', 'lead_nuevo').eq('activa', true);
    const { data: canalWA } = await supabase.from('canales').select('*')
      .eq('organizacion_id', conversacion.organizacion_id)
      .eq('tipo', 'whatsapp').eq('activo', true).maybeSingle();

    if (reglas?.length && canalWA && dentroDeVentanaOutbound()) {
      const destinos = reglas.flatMap((r) => r.contactos || []);
      notificarEnCadencia(destinos, (d) => enviarTexto(canalWA, d, textoAviso))
        .catch((e) => console.error('Error enviando aviso WA:', e));
    }
  } catch (e) { console.warn('Envío WA del aviso omitido:', e.message); }
}

// ------------------------------------------------------------
// Detector de "conversación terminada": revisa conversaciones cuyo
// último mensaje fue hace > INACTIVIDAD_MIN minutos y todavía no
// tienen aviso generado. Corre periódicamente.
// ------------------------------------------------------------
const INACTIVIDAD_MIN = 10;

async function revisarConversacionesTerminadas(supabase) {
  const limite = new Date(Date.now() - INACTIVIDAD_MIN * 60000).toISOString();
  // Conversaciones inactivas y sin aviso (marca en metadatos)
  const { data: convs } = await supabase
    .from('conversaciones')
    .select('id, lead_id, canal_id, organizacion_id, ultimo_mensaje, aviso_generado')
    .lt('ultimo_mensaje', limite)
    .or('aviso_generado.is.null,aviso_generado.eq.false')
    .limit(20);

  for (const c of convs || []) {
    try {
      await avisarLeadCompleto(supabase, c);
      await supabase.from('conversaciones')
        .update({ aviso_generado: true }).eq('id', c.id);
    } catch (e) { console.error('Error avisando lead', c.id, e.message); }
  }
  if (convs?.length) console.log(`Avisos de leads generados: ${convs.length}`);
}

function iniciarAvisadorLeads(supabase) {
  console.log('Avisador de leads iniciado (revisa cada 5 min)');
  setInterval(() => revisarConversacionesTerminadas(supabase).catch(console.error), 5 * 60000);
}

module.exports = { avisarLeadCompleto, iniciarAvisadorLeads };
