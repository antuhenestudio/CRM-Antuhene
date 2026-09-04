// ============================================================
// ACADEMIA — cursos, tests, progreso y certificados
// Pago individual por Mercado Pago (independiente de los planes).
// La corrección de tests ocurre acá (backend): las respuestas
// correctas nunca se exponen al frontend.
// ============================================================

const { crearSuscripcion } = require('./suscripciones'); // reutiliza cliente MP
const MP_API = 'https://api.mercadopago.com';

async function mp(path, method, body) {
  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

/** Genera un pago único (Checkout Pro) para comprar un curso. */
async function comprarCurso(supabase, { userId, orgId, cursoId, email }) {
  const { data: curso } = await supabase.from('cursos').select('*').eq('id', cursoId).single();
  if (!curso) throw new Error('Curso inexistente');

  // Registrar inscripción pendiente
  await supabase.from('inscripciones').upsert({
    user_id: userId, organizacion_id: orgId, curso_id: cursoId, estado_pago: 'pendiente',
  }, { onConflict: 'user_id,curso_id', ignoreDuplicates: false });

  const pref = await mp('/checkout/preferences', 'POST', {
    items: [{ title: `Curso: ${curso.titulo}`, quantity: 1, unit_price: Number(curso.precio_ars), currency_id: 'ARS' }],
    payer: { email },
    external_reference: `curso:${cursoId}:${userId}`,
    back_urls: { success: process.env.MP_BACK_URL, pending: process.env.MP_BACK_URL, failure: process.env.MP_BACK_URL },
    auto_return: 'approved',
  });
  return pref.init_point;
}

/** Webhook: confirma el pago de un curso y habilita el acceso. */
async function procesarPagoCurso(supabase, pago) {
  const ref = pago.external_reference || '';
  if (!ref.startsWith('curso:')) return false;
  const [, cursoId, userId] = ref.split(':');
  if (pago.status === 'approved') {
    await supabase.from('inscripciones').update({
      estado_pago: 'pagado', mp_payment_id: String(pago.id),
    }).eq('user_id', userId).eq('curso_id', cursoId);
  }
  return true;
}

/** Corrige el test de una lección (backend: respuestas seguras). */
async function corregirTest(supabase, { userId, leccionId, respuestas }) {
  const { data: preguntas } = await supabase
    .from('preguntas_test').select('id, correcta, orden')
    .eq('leccion_id', leccionId).order('orden');
  if (!preguntas?.length) return { aprobado: true, puntaje: 100 }; // lección sin test

  let aciertos = 0;
  preguntas.forEach((p, i) => { if (respuestas[i] === p.correcta) aciertos++; });
  const puntaje = Math.round((aciertos / preguntas.length) * 100);
  const aprobado = puntaje >= 70; // umbral de aprobación

  await supabase.from('progreso_lecciones').upsert({
    user_id: userId, leccion_id: leccionId,
    test_aprobado: aprobado, puntaje, actualizado: new Date().toISOString(),
  }, { onConflict: 'user_id,leccion_id' });

  return { aprobado, puntaje };
}

/** Marca un video como visto. */
async function marcarVideoVisto(supabase, { userId, leccionId }) {
  await supabase.from('progreso_lecciones').upsert({
    user_id: userId, leccion_id: leccionId, video_visto: true,
    actualizado: new Date().toISOString(),
  }, { onConflict: 'user_id,leccion_id' });
}

/** Tras aprobar/ver, revisa si el curso quedó completo → certificado. */
async function chequearCompletado(supabase, { userId, cursoId }) {
  await supabase.rpc('verificar_curso_completo', { p_user: userId, p_curso: cursoId });
  const { data } = await supabase.from('inscripciones')
    .select('completado, certificado_id').eq('user_id', userId).eq('curso_id', cursoId).maybeSingle();
  return data;
}

module.exports = {
  comprarCurso, procesarPagoCurso, corregirTest, marcarVideoVisto, chequearCompletado,
};
