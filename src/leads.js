// ============================================================
// Persistencia multi-tenant: canales, leads, conversaciones,
// mensajes y Kanban. El backend usa service_role (bypass RLS);
// el aislamiento del panel lo garantizan las políticas RLS.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// ---- Caché de canales (evita una consulta por cada webhook) ----
const cacheCanales = new Map(); // identificador -> { canal, exp }
const TTL_MS = 5 * 60 * 1000;

/** Rutea el webhook: phone_number_id -> canal (con token y agente). */
async function obtenerCanal(identificador) {
  const hit = cacheCanales.get(identificador);
  if (hit && hit.exp > Date.now()) return hit.canal;

  const { data } = await supabase
    .from('canales')
    .select('*, agente:agentes(*)')
    .eq('identificador', identificador)
    .eq('activo', true)
    .maybeSingle();

  if (data) cacheCanales.set(identificador, { canal: data, exp: Date.now() + TTL_MS });
  return data;
}

async function obtenerOCrearLead(telefono, nombrePerfil, organizacionId) {
  const { data: existente } = await supabase
    .from('leads').select('*')
    .eq('telefono', telefono)
    .eq('organizacion_id', organizacionId)
    .maybeSingle();
  if (existente) return existente;

  const { data, error } = await supabase
    .from('leads')
    .insert({ telefono, nombre: nombrePerfil || null, organizacion_id: organizacionId })
    .select().single();
  if (error) throw error;
  return data;
}

/** Conversación única por lead+canal; crea si no existe. */
async function obtenerOCrearConversacion(lead, canal) {
  const { data: existente } = await supabase
    .from('conversaciones').select('*')
    .eq('lead_id', lead.id).eq('canal_id', canal.id)
    .maybeSingle();
  if (existente) return existente;

  const { data, error } = await supabase
    .from('conversaciones')
    .insert({
      organizacion_id: canal.organizacion_id,
      lead_id: lead.id,
      canal_id: canal.id,
      agente_id: canal.agente_id,
    })
    .select().single();
  if (error) throw error;
  return data;
}

async function guardarMensaje({ conversacion, autor, contenido, wamid = null, userId = null }) {
  await supabase.from('mensajes').upsert(
    {
      lead_id: conversacion.lead_id,
      conversacion_id: conversacion.id,
      canal_id: conversacion.canal_id,
      organizacion_id: conversacion.organizacion_id,
      direccion: autor === 'cliente' ? 'entrante' : 'saliente',
      autor,
      contenido,
      wamid,
      user_id: userId,
    },
    { onConflict: 'wamid', ignoreDuplicates: true }
  );
  await supabase.from('conversaciones')
    .update({ ultimo_mensaje: new Date().toISOString() })
    .eq('id', conversacion.id);
}

async function obtenerHistorial(conversacionId, limite = 20) {
  const { data } = await supabase
    .from('mensajes')
    .select('autor, contenido')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(limite);
  return (data || []).reverse();
}

/**
 * Actualiza el lead con datos extraídos y avanza el Kanban.
 * Regla Tier A por defecto (ajustable por organización):
 * convenio petroleros/camioneros => filtrado_tier_a.
 */
async function actualizarLead(lead, datosNuevos) {
  // Solo completar campos que estén vacíos en el lead (no pisar lo ya cargado a mano).
  const camposSeguros = ['nombre','apellido','telefono','email','dni','domicilio',
                         'zona','interes','convenio','birth_date'];
  const cambios = {};
  for (const campo of camposSeguros) {
    const nuevo = datosNuevos[campo];
    // Guardar solo si hay valor nuevo Y el lead no lo tenía (o estaba vacío)
    if (nuevo && (!lead[campo] || lead[campo] === '')) {
      cambios[campo] = nuevo;
    }
  }
  // Excepción: el 'telefono' de un lead web ('web:...') sí se puede completar
  // con el número real cuando el prospecto lo da.
  if (datosNuevos.telefono && (lead.telefono || '').startsWith('web:')) {
    cambios.telefono = datosNuevos.telefono;
  }

  // CALIFICACIÓN AUTOMÁTICA a "Cliente Interesado"
  // Un lead pasa a interesado cuando muestra interés real. Sirve para
  // cualquier rubro (no solo previsional). Señales que lo califican:
  //   - Tiene nombre Y motivo/interés (dijo quién es y qué necesita), o
  //   - Dio un teléfono real de contacto, o
  //   - Convenio previsional relevante (petroleros/camioneros).
  const leadActualizado = { ...lead, ...cambios };
  const tieneNombre  = leadActualizado.nombre && leadActualizado.nombre.trim();
  const tieneInteres = leadActualizado.interes && leadActualizado.interes.trim();
  const tieneTelReal = leadActualizado.telefono && !String(leadActualizado.telefono).startsWith('web:');
  const convenioRelevante = ['petroleros', 'camioneros'].includes(datosNuevos.convenio);

  const muestraInteres = (tieneNombre && tieneInteres) || tieneTelReal || convenioRelevante;

  if (lead.estado === 'nuevo_lead' && muestraInteres) {
    cambios.tier = 'A';
    cambios.estado = 'filtrado_tier_a';
  }
  if (Object.keys(cambios).length === 0) return lead;

  const { data } = await supabase
    .from('leads').update(cambios).eq('id', lead.id).select().single();
  const actualizado = data || lead;

  // Detección de duplicados: si se completó teléfono o email, buscar si ya
  // existe OTRO lead de la misma organización con ese dato.
  try {
    if ((cambios.telefono || cambios.email) && !actualizado.posible_duplicado_de) {
      const filtros = [];
      if (cambios.telefono) filtros.push(`telefono.eq.${cambios.telefono}`);
      if (cambios.email) filtros.push(`email.eq.${cambios.email}`);
      const { data: otros } = await supabase
        .from('leads').select('id, created_at')
        .eq('organizacion_id', actualizado.organizacion_id)
        .neq('id', actualizado.id)
        .or(filtros.join(','));
      if (otros && otros.length) {
        // Apuntar al más antiguo como "original"
        const original = otros.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
        await supabase.from('leads')
          .update({ posible_duplicado_de: original.id })
          .eq('id', actualizado.id);
      }
    }
  } catch (e) { console.warn('Detección de duplicados falló:', e.message); }

  return actualizado;
}

module.exports = {
  supabase,
  obtenerCanal,
  obtenerOCrearLead,
  obtenerOCrearConversacion,
  guardarMensaje,
  obtenerHistorial,
  actualizarLead,
};
