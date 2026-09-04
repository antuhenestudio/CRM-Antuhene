// ============================================================
// SUSCRIPCIONES (Mercado Pago) — muro de pago del SaaS
// La cuenta se loguea siempre, pero conectar canales / activar
// bots requiere suscripción vigente. Cobro mensual recurrente
// vía preapproval de Mercado Pago; un webhook confirma los pagos.
// ============================================================

const MP_API = 'https://api.mercadopago.com';

async function mp(path, method, body) {
  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

/**
 * Crea una suscripción (preapproval) para una organización y un plan.
 * Devuelve el init_point (URL de checkout) al que se manda al cliente.
 */
async function crearSuscripcion(supabase, { organizacionId, planId, emailPagador }) {
  const { data: plan } = await supabase.from('planes').select('*').eq('id', planId).single();
  if (!plan) throw new Error('Plan inexistente');

  const pre = await mp('/preapproval', 'POST', {
    reason: `AntüHene AI Studio — Plan ${plan.nombre}`,
    external_reference: organizacionId,
    payer_email: emailPagador,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Number(plan.precio_ars),
      currency_id: 'ARS',
    },
    back_url: process.env.MP_BACK_URL,
    status: 'pending',
  });

  await supabase.from('organizaciones').update({
    plan_id: planId,
    mp_preapproval_id: pre.id,
  }).eq('id', organizacionId);

  return pre.init_point; // URL de checkout de Mercado Pago
}

/**
 * Webhook de Mercado Pago: confirma pagos y actualiza la vigencia.
 * MP notifica con { type, data: { id } }.
 */
async function procesarWebhookMP(supabase, notificacion) {
  if (notificacion.type !== 'payment') return;

  const pago = await mp(`/v1/payments/${notificacion.data.id}`, 'GET');
  const orgId = pago.external_reference;
  if (!orgId) return;

  const aprobado = pago.status === 'approved';
  const desde = new Date();
  const hasta = new Date(); hasta.setMonth(hasta.getMonth() + 1);

  await supabase.from('pagos').insert({
    organizacion_id: orgId,
    mp_payment_id: String(pago.id),
    monto: pago.transaction_amount,
    estado: pago.status,
    periodo_desde: desde.toISOString().slice(0, 10),
    periodo_hasta: hasta.toISOString().slice(0, 10),
  });

  if (aprobado) {
    await supabase.from('organizaciones').update({
      estado_suscripcion: 'activa',
      suscripcion_hasta: hasta.toISOString(),
    }).eq('id', orgId);
  } else if (pago.status === 'rejected') {
    await supabase.from('organizaciones').update({
      estado_suscripcion: 'morosa',
    }).eq('id', orgId);
  }
}

/** Guardián: ¿la organización puede usar vinculaciones? */
async function puedeVincular(supabase, organizacionId) {
  const { data } = await supabase.rpc('suscripcion_vigente', { org: organizacionId });
  return !!data;
}

module.exports = { crearSuscripcion, procesarWebhookMP, puedeVincular };
