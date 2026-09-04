// ============================================================
// SCORING DE LEADS — calificación configurable por negocio
// Cada organización define reglas ("interés=jubilación → +30",
// "tiene email → +10"). El puntaje acumulado define el tier
// según los umbrales de la organización. Reemplaza la regla
// fija anterior (petroleros/camioneros).
// ============================================================

function cumple(regla, lead) {
  const v = lead[regla.campo];
  if (regla.operador === 'existe') return v != null && v !== '';
  if (regla.operador === 'contiene') {
    return String(v || '').toLowerCase().includes(String(regla.valor || '').toLowerCase());
  }
  return String(v || '').toLowerCase() === String(regla.valor || '').toLowerCase();
}

/**
 * Recalcula puntaje y tier de un lead según las reglas de su
 * organización, y persiste el cambio. Devuelve { puntaje, tier, subio }.
 */
async function recalcularScore(supabase, lead) {
  const [{ data: reglas }, { data: org }] = await Promise.all([
    supabase.from('reglas_scoring').select('*')
      .eq('organizacion_id', lead.organizacion_id).eq('activa', true),
    supabase.from('organizaciones').select('umbral_tier_a, umbral_tier_b')
      .eq('id', lead.organizacion_id).single(),
  ]);

  // Campos derivados que las reglas pueden mirar
  const enriquecido = {
    ...lead,
    tiene_email: lead.email ? 'si' : '',
  };

  let puntaje = 0;
  for (const r of reglas || []) if (cumple(r, enriquecido)) puntaje += r.puntos;

  const a = org?.umbral_tier_a ?? 60;
  const b = org?.umbral_tier_b ?? 30;
  const tier = puntaje >= a ? 'A' : puntaje >= b ? 'B' : 'C';

  const tierAnterior = lead.tier;
  const cambios = { puntaje, tier };
  // Si alcanzó Tier A y estaba sin calificar, lo movemos en el Kanban
  if (tier === 'A' && lead.estado === 'nuevo_lead') cambios.estado = 'filtrado_tier_a';

  await supabase.from('leads').update(cambios).eq('id', lead.id);

  return { puntaje, tier, subioAtierA: tier === 'A' && tierAnterior !== 'A' };
}

module.exports = { recalcularScore };
