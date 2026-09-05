// ============================================================
// TRIAL — canje de códigos y avisos de vencimiento
// - Canjea un código de 30 días para una organización.
// - Un cron revisa a diario los trials por vencer y avisa a los
//   7, 3 y 1 días, por panel (insights) y por email (Supabase).
// ============================================================

/** Canjea un código de trial. Devuelve el resultado (OK / error). */
async function canjearCodigo(supabase, { organizacionId, codigo }) {
  const { data, error } = await supabase.rpc('canjear_trial', {
    p_codigo: codigo, p_org: organizacionId,
  });
  if (error) throw error;
  return data; // 'OK' | 'CODIGO_INVALIDO' | 'CODIGO_VENCIDO' | 'CODIGO_AGOTADO' | 'YA_USASTE_TRIAL'
}

// Mensajes amables por cada hito de aviso
const MENSAJES_AVISO = {
  '7': 'Tu prueba gratis termina en 7 días. Cuando quieras, activá tu plan para no perder tus bots y tus datos.',
  '3': 'Te quedan 3 días de prueba. Activá tu plan para seguir sin interrupciones.',
  '1': '¡Último día de prueba! Mañana necesitás un plan activo para seguir usando AntüHene. Activalo hoy.',
};

/**
 * Revisa los trials por vencer y envía los avisos pendientes.
 * Crea un insight (aviso en el panel) y, si hay email configurado,
 * envía por correo. Marca cada aviso para no repetirlo.
 */
async function revisarTrials(supabase) {
  const { data: orgs } = await supabase.from('trials_por_vencer').select('*');
  if (!orgs?.length) return;

  for (const org of orgs) {
    const dias = org.dias_restantes;
    const yaAvisados = org.avisos_trial || [];
    // ¿Corresponde avisar en este umbral?
    const umbral = [7, 3, 1].find((u) => dias <= u && !yaAvisados.includes(String(u)));
    if (!umbral) continue;

    const mensaje = MENSAJES_AVISO[String(umbral)];

    // 1) Aviso en el panel (insight de Antü)
    try {
      await supabase.from('insights').insert({
        organizacion_id: org.id,
        tipo: 'alerta', zona: 'global', prioridad: 3,
        titulo: `Tu prueba termina en ${dias} día(s)`,
        mensaje,
        accion_texto: 'Ver planes', accion_zona: 'planes',
      });
    } catch (e) { console.warn('Insight trial falló:', e.message); }

    // 2) Aviso por email (usando el email del dueño en auth.users)
    try {
      const { data: perfil } = await supabase.from('perfiles')
        .select('user_id').eq('organizacion_id', org.id).eq('rol', 'dueno').maybeSingle();
      if (perfil) {
        // Nota: el envío real de email se hace con un servicio (Resend,
        // SendGrid, o Supabase Auth). Acá dejamos el registro; conectar
        // el proveedor de email es un paso de configuración aparte.
        console.log(`[EMAIL pendiente] Org ${org.nombre}: ${mensaje}`);
      }
    } catch (e) { console.warn('Email trial falló:', e.message); }

    // 3) Marcar el aviso como enviado
    try {
      await supabase.from('organizaciones')
        .update({ avisos_trial: [...yaAvisados, String(umbral)] })
        .eq('id', org.id);
    } catch (e) { console.warn('Marcar aviso falló:', e.message); }

    // 4) Si el trial ya venció, pasar a inactiva (muestra el muro de pago)
    if (dias <= 0) {
      await supabase.from('organizaciones')
        .update({ estado_suscripcion: 'inactiva' }).eq('id', org.id);
    }
  }
  console.log(`Trials revisados: ${orgs.length}`);
}

/** Inicia la revisión diaria (cada 12 h para no depender de la hora exacta). */
function iniciarRevisorTrials(supabase) {
  console.log('Revisor de trials iniciado (cada 12 h)');
  revisarTrials(supabase).catch(console.error);
  setInterval(() => revisarTrials(supabase).catch(console.error), 12 * 60 * 60 * 1000);
}

module.exports = { canjearCodigo, iniciarRevisorTrials };
