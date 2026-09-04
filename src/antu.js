// ============================================================
// "ANTÜ" — la IA analista del CRM
// Observa los datos de cada organización y genera insights:
// recomendaciones, felicitaciones, alertas y sugerencias, con
// su voz cálida. Arranca con reglas claras y deterministas;
// más adelante se le suma redacción con IA (gpt-4o-mini).
//
// Se corre periódicamente (cron) por cada organización activa.
// ============================================================

// Cada regla recibe un "snapshot" de métricas y devuelve un
// insight { tipo, zona, titulo, mensaje, prioridad, accion_texto, accion_zona }
// o null si no aplica.

const REGLAS = [
  // 1) Leads Tier A sin contactar → alerta
  (s) => s.tierASinContactar >= 1 ? {
    tipo: 'alerta', zona: 'leads', prioridad: 3,
    titulo: `Tenés ${s.tierASinContactar} lead(s) calificado(s) sin contactar`,
    mensaje: `Vi que hay ${s.tierASinContactar} lead(s) Tier A esperando. Son los más propensos a convertir: contactalos hoy mientras el interés está caliente.`,
    accion_texto: 'Ver leads', accion_zona: 'leads',
  } : null,

  // 2) Conversaciones sin responder hace rato → alerta
  (s) => s.convSinResponder >= 1 ? {
    tipo: 'alerta', zona: 'inbox', prioridad: 3,
    titulo: `${s.convSinResponder} conversación(es) esperan respuesta`,
    mensaje: `Hay ${s.convSinResponder} chat(s) que un humano dejó pendientes. Cada minuto cuenta: responder rápido mejora mucho tu tasa de cierre.`,
    accion_texto: 'Ir al inbox', accion_zona: 'inbox',
  } : null,

  // 3) Buena racha de cierres → felicitación
  (s) => s.ganadosSemana >= 3 ? {
    tipo: 'felicitacion', zona: 'resumen', prioridad: 2,
    titulo: `¡Gran semana! ${s.ganadosSemana} clientes ganados`,
    mensaje: `Cerraste ${s.ganadosSemana} clientes esta semana. Vas muy bien. Si querés sostener la racha, revisá que no queden leads Tier A sin seguimiento.`,
  } : null,

  // 4) Sin publicaciones programadas → sugerencia
  (s) => s.pubProgramadas === 0 ? {
    tipo: 'sugerencia', zona: 'publicaciones', prioridad: 1,
    titulo: 'No tenés contenido programado',
    mensaje: `Cuando no publicás seguido, tus redes pierden alcance. Te sugiero programar al menos 2 o 3 posts esta semana para mantener tu negocio presente.`,
    accion_texto: 'Programar contenido', accion_zona: 'publicaciones',
  } : null,

  // 5) Conocimiento del bot vacío → recomendación
  (s) => s.fuentesConocimiento === 0 ? {
    tipo: 'recomendacion', zona: 'global', prioridad: 2,
    titulo: 'Tu bot todavía no tiene conocimiento cargado',
    mensaje: `Para que responda bien a tus clientes, cargá tu ficha de negocio y algún documento (o usá las plantillas). Cuanto mejor lo alimentes, mejor vende por vos.`,
    accion_texto: 'Configurar bot', accion_zona: 'config',
  } : null,

  // 6) Muchos leads perdidos → sugerencia de mejora
  (s) => s.tasaPerdidos >= 40 ? {
    tipo: 'sugerencia', zona: 'metricas', prioridad: 2,
    titulo: 'Estás perdiendo bastantes leads',
    mensaje: `El ${s.tasaPerdidos}% de tus leads terminó como perdido. Puede ser el tiempo de respuesta o el seguimiento. Revisemos juntos: activá avisos automáticos para no dejar a nadie sin atención.`,
    accion_texto: 'Ver decisiones', accion_zona: 'metricas',
  } : null,

  // 7) Cumpleaños de clientes esta semana → oportunidad
  (s) => s.cumplesSemana >= 1 ? {
    tipo: 'sugerencia', zona: 'resumen', prioridad: 1,
    titulo: `${s.cumplesSemana} cliente(s) cumplen años esta semana`,
    mensaje: `Un saludo de cumpleaños genera fidelidad real. El bot puede enviarlo solo, pero si querés sumar un beneficio, es un gran momento para reconectar.`,
  } : null,
];

/** Arma el snapshot de métricas de una organización. */
async function snapshot(supabase, orgId) {
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const [tierA, convPend, ganados, pub, fuentes, totales, cumples] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId).eq('tier', 'A').in('estado', ['nuevo_lead', 'filtrado_tier_a']),
    supabase.from('conversaciones').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId).eq('modo', 'humano'),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId).eq('estado', 'ganado').gte('updated_at', hace7),
    supabase.from('publicaciones').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId).eq('estado', 'programada'),
    supabase.from('fuentes_conocimiento').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId),
    supabase.from('leads').select('estado', { count: 'exact' }).eq('organizacion_id', orgId),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', orgId).not('birth_date', 'is', null),
  ]);

  const total = totales.count || 0;
  const perdidos = (totales.data || []).filter((l) => l.estado === 'perdido').length;

  return {
    tierASinContactar: tierA.count || 0,
    convSinResponder: convPend.count || 0,
    ganadosSemana: ganados.count || 0,
    pubProgramadas: pub.count || 0,
    fuentesConocimiento: fuentes.count || 0,
    tasaPerdidos: total ? Math.round((perdidos / total) * 100) : 0,
    cumplesSemana: cumples.count || 0, // aprox: clientes con cumpleaños cargado
  };
}

/** Genera y guarda los insights de una organización. */
async function analizarOrganizacion(supabase, orgId) {
  const s = await snapshot(supabase, orgId);
  const nuevos = REGLAS.map((r) => r(s)).filter(Boolean);

  for (const ins of nuevos) {
    // upsert lógico: no duplicar el mismo insight sin resolver
    await supabase.from('insights').upsert({
      organizacion_id: orgId,
      tipo: ins.tipo, zona: ins.zona, titulo: ins.titulo,
      mensaje: ins.mensaje, prioridad: ins.prioridad,
      accion_texto: ins.accion_texto || null, accion_zona: ins.accion_zona || null,
    }, { onConflict: 'organizacion_id,tipo,titulo', ignoreDuplicates: true });
  }
  return nuevos.length;
}

/** Corre el análisis para todas las organizaciones con suscripción vigente. */
async function correrAntu(supabase) {
  const { data: orgs } = await supabase
    .from('organizaciones').select('id')
    .in('estado_suscripcion', ['activa', 'trial']);
  for (const o of orgs || []) {
    try { await analizarOrganizacion(supabase, o.id); }
    catch (e) { console.error('Antü error en org', o.id, e.message); }
  }
  console.log(`Antü analizó ${orgs?.length || 0} organizaciones`);
}

/** Inicia el análisis periódico (cada 3 horas). */
function iniciarAntu(supabase) {
  console.log('Antü (IA analista) iniciada — cada 3 h');
  correrAntu(supabase).catch(console.error);
  setInterval(() => correrAntu(supabase).catch(console.error), 3 * 60 * 60 * 1000);
}

module.exports = { iniciarAntu, analizarOrganizacion };
