// ============================================================
// IA humanizada multi-tenant:
// - El prompt se construye desde el AGENTE configurado por el
//   cliente (nombre, objetivo, personalidad) + base por rubro.
// - RAG restringido a los documentos de ESA organización (y del
//   agente, si tiene conocimiento exclusivo). Cero invención.
// ============================================================

const OPENAI_URL = 'https://api.openai.com/v1';
const { ALMA_ANTUHENE } = require('./alma');

async function openai(ruta, body) {
  const res = await fetch(`${OPENAI_URL}/${ruta}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function generarEmbedding(texto) {
  const r = await openai('embeddings', { model: 'text-embedding-3-small', input: texto });
  return r.data[0].embedding;
}

const BASE_RUBRO = {
  juridico: `Contexto profesional: estudio jurídico. Tono formal pero cercano,
escucha activa, confidencialidad. NO des asesoramiento legal de fondo, NO cites
leyes, artículos ni fallos: calificá la consulta y derivá al profesional.`,
  inmobiliario: `Contexto profesional: desarrolladora/inmobiliaria. Tono
consultivo, enfocado en inversión, servicios y financiación.`,
  general: `Contexto profesional: atención comercial de un negocio.`,
};

function construirPromptSistema(agente, rubro, contexto) {
  // El "alma" (voz + neuroventas + FOMO/CTA + anti-invención) es ÚNICA
  // para todos los bots. Lo único que varía es el CONTENIDO: el objetivo
  // puntual del bot, el rubro y la documentación real del negocio.
  return `${ALMA_ANTUHENE}

# CONTEXTO DE ESTE NEGOCIO
${BASE_RUBRO[rubro] || BASE_RUBRO.general}
${agente?.objetivo ? 'OBJETIVO DE ESTA CONVERSACIÓN: ' + agente.objetivo : 'OBJETIVO: atender, orientar y calificar consultas.'}

# CONOCIMIENTO DISPONIBLE (lo único con lo que podés afirmar cosas)
${contexto}`;
}

/** Respuesta del bot con RAG multi-tenant + memoria de conversación. */
async function responder(supabase, { canal, historial, mensaje }) {
  const embedding = await generarEmbedding(mensaje);
  const [{ data: docs }, { data: perfil }] = await Promise.all([
    supabase.rpc('buscar_documentos', {
      query_embedding: embedding,
      filtro_org: canal.organizacion_id,
      filtro_agente: canal.agente_id,
      cantidad: 4,
    }),
    supabase.from('perfil_negocio').select('*').eq('organizacion_id', canal.organizacion_id).maybeSingle(),
  ]);
  const contexto = (docs || [])
    .map((d) => `[${d.titulo}]\n${d.contenido}`)
    .join('\n---\n') || '(sin documentos relevantes cargados)';

  const fichaNegocio = perfil ? construirFichaNegocio(perfil) : '';

  const rubro = canal.agente?.rubro || 'general';
  const mensajes = [
    { role: 'system', content: construirPromptSistema(canal.agente, rubro, contexto) + fichaNegocio },
    ...historial.map((m) => ({
      role: m.autor === 'cliente' ? 'user' : 'assistant',
      content: m.contenido,
    })),
    { role: 'user', content: mensaje },
  ];

  const r = await openai('chat/completions', {
    model: 'gpt-4o-mini',
    messages: mensajes,
    max_tokens: 300,
    temperature: 0.7,
  });
  return r.choices[0].message.content.trim();
}

/** Arma el bloque de conocimiento base a partir de la ficha del negocio. */
function construirFichaNegocio(p) {
  const servicios = (p.servicios || [])
    .map((s) => `- ${s.nombre}${s.descripcion ? ': ' + s.descripcion : ''}${s.precio ? ' (' + s.precio + ')' : ''}`)
    .join('\n');
  const faq = (p.faq || [])
    .map((f) => `P: ${f.pregunta}\nR: ${f.respuesta}`)
    .join('\n');
  const horario = p.es_online
    ? 'Atención online, sin horario fijo.'
    : 'Consultá los horarios de atención cargados antes de ofrecer turnos.';

  return `\n\nFICHA DEL NEGOCIO (usá esto para responder al prospecto; son datos reales del comercio):
${p.tipo_negocio ? 'Tipo de negocio: ' + p.tipo_negocio : ''}
${p.descripcion ? 'A qué se dedica: ' + p.descripcion : ''}
${p.direccion ? 'Dirección: ' + p.direccion : ''}
${p.telefono ? 'Teléfono: ' + p.telefono : ''}${p.whatsapp ? ' · WhatsApp: ' + p.whatsapp : ''}
${p.canales_atencion ? 'Canales de atención: ' + p.canales_atencion : ''}
${p.sitio_web ? 'Sitio web: ' + p.sitio_web : ''}
${servicios ? 'Servicios / productos:\n' + servicios : ''}
${faq ? 'Preguntas frecuentes:\n' + faq : ''}
${horario}`;
}

/** Extracción conversacional pasiva (segundo plano). */
async function extraerDatos(mensaje, rubro = 'general') {
  const r = await openai('chat/completions', {
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `Extraé datos del mensaje de un cliente (rubro: ${rubro}).
Respondé SOLO un JSON válido, sin markdown, con las claves:
nombre, interes, zona, plazo, convenio (anses|issn|petroleros|camioneros|otro),
birth_date (YYYY-MM-DD o null). Usá null en todo campo que el mensaje no
mencione explícitamente. No infieras.`,
      },
      { role: 'user', content: mensaje },
    ],
  });
  try {
    const limpio = r.choices[0].message.content.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(limpio);
    return Object.fromEntries(
      Object.entries(datos).filter(([, v]) => v !== null && v !== '')
    );
  } catch {
    return {};
  }
}

module.exports = { responder, extraerDatos, generarEmbedding };
