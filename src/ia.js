// ============================================================
// IA humanizada multi-tenant — con Gemini + OpenAI (respaldo)
// - Usa Gemini por defecto; si falla, prueba OpenAI automáticamente.
// - El prompt se construye desde el AGENTE + base por rubro.
// - RAG restringido a los documentos de ESA organización.
// - Funciona aunque el canal no tenga agente asignado (usa valores por defecto).
// ============================================================

const { ALMA_ANTUHENE } = require('./alma');

const OPENAI_URL = 'https://api.openai.com/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

// ---- Cuál usar primero: 'gemini' o 'openai' ----
const IA_PRIMARIA = process.env.IA_PRIMARIA || 'gemini';

// ------------------------------------------------------------
// Llamadas a cada proveedor
// ------------------------------------------------------------
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

// Gemini: genera texto a partir de un system prompt + historial + mensaje
async function geminiGenerar({ system, mensajes, temperature = 0.7, maxTokens = 800 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta GEMINI_API_KEY');

  // Gemini usa "contents" con roles user/model, y system aparte
  const contents = mensajes.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `${GEMINI_URL}/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error('Gemini: ' + JSON.stringify(data.error));
  const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) throw new Error('Gemini no devolvió texto');
  return texto.trim();
}

// OpenAI: genera texto (mismo formato que antes)
async function openaiGenerar({ system, mensajes, temperature = 0.7, maxTokens = 800 }) {
  const r = await openai('chat/completions', {
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: system }, ...mensajes],
    max_tokens: maxTokens,
    temperature,
  });
  if (r.error) throw new Error('OpenAI: ' + JSON.stringify(r.error));
  const texto = r?.choices?.[0]?.message?.content;
  if (!texto) throw new Error('OpenAI no devolvió texto');
  return texto.trim();
}

// Claude (Anthropic): genera texto
async function claudeGenerar({ system, mensajes, temperature = 0.7, maxTokens = 800 }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('Falta CLAUDE_API_KEY');
  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5',
      max_tokens: maxTokens,
      temperature,
      system,
      messages: mensajes.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude: ' + JSON.stringify(data.error));
  const texto = data?.content?.[0]?.text;
  if (!texto) throw new Error('Claude no devolvió texto');
  return texto.trim();
}

/**
 * Genera texto usando el proveedor primario; si falla, usa el otro.
 * Así, si Gemini o OpenAI se caen, el bot igual responde.
 */
async function generarConRespaldo(opciones) {
  // Motores disponibles por nombre
  const motores = { gemini: geminiGenerar, openai: openaiGenerar, claude: claudeGenerar };
  // Orden: el primario elegido, y después los otros dos como respaldo.
  const primario = IA_PRIMARIA;
  const orden = [primario, ...Object.keys(motores).filter((m) => m !== primario)];

  let ultimoError = null;
  for (const nombre of orden) {
    try {
      return await motores[nombre](opciones);
    } catch (e) {
      console.warn(`IA (${nombre}) falló, pruebo el siguiente:`, e.message);
      ultimoError = e;
    }
  }
  throw ultimoError || new Error('Todos los motores de IA fallaron');
}

// ------------------------------------------------------------
// Embeddings (para el RAG). Usa OpenAI. Si no hay clave, devuelve null
// y el bot responde sin documentos (no rompe).
// ------------------------------------------------------------
async function generarEmbedding(texto) {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const r = await openai('embeddings', { model: 'text-embedding-3-small', input: texto });
    return r?.data?.[0]?.embedding || null;
  } catch (e) {
    console.warn('Embedding falló:', e.message);
    return null;
  }
}

const BASE_RUBRO = {
  juridico: `Contexto: estudio jurídico. Tono formal pero cálido, confidencialidad.
NO des asesoramiento legal de fondo ni cites leyes/fallos. Captá el contacto
del consultante para que un profesional lo llame.`,
  inmobiliario: `Contexto: desarrolladora/inmobiliaria. Tono consultivo.
Captá el contacto del interesado para que un asesor lo llame.`,
  general: `Contexto: atención comercial. Captá el contacto del interesado
para que el equipo lo llame.`,
};

const TONOS = {
  formal: `# TONO: FORMAL / PROFESIONAL
Tratá a la persona de USTED. Serio, respetuoso, prolijo. Nada de jerga ni
chistes. Ideal para un trato profesional (estudios, salud, servicios serios).
Ejemplo: "Buenas tardes. Con gusto lo asesoro. ¿Podría indicarme su nombre?"`,
  cordial: `# TONO: CORDIAL / CERCANO
Voseo argentino cálido pero prolijo. Cercano sin ser confianzudo. El
equilibrio para la mayoría de los negocios.
Ejemplo: "¡Hola! Con gusto te ayudo. ¿Me decís tu nombre?"`,
  canchero: `# TONO: CANCHERO / RELAJADO
Informal, con onda, lenguaje de la calle argentino (pero sin faltar el
respeto). Podés usar expresiones coloquiales. Ideal para negocios jóvenes.
Ejemplo: "¡Buenas! Dale, te ayudo. ¿Cómo te llamás?"
OJO: canchero no es grosero. Leé a la persona: si es alguien mayor o el
tema es delicado, bajá un cambio y sé más respetuoso.`,
  entusiasta: `# TONO: ENTUSIASTA / VENDEDOR
Energético, positivo, con entusiasmo genuino. Podés usar algún emoji con
moderación. Ideal para promociones, eventos, retail.
Ejemplo: "¡Holaa! ¡Qué bueno que escribís! Te cuento todo 🎉"`,
  sobrio: `# TONO: SOBRIO / INSTITUCIONAL
Neutro, corporativo, claro y directo. Sin excesos de calidez ni informalidad.
Ideal para empresas, servicios formales, B2B.
Ejemplo: "Bienvenido. Estamos para asistirlo. ¿En qué podemos ayudarlo?"`,
};

function construirPromptSistema(agente, rubro, contexto) {
  const tono = TONOS[agente?.tono] || TONOS.cordial;
  return `${ALMA_ANTUHENE}

${tono}

# CONTEXTO DE ESTE NEGOCIO
${BASE_RUBRO[rubro] || BASE_RUBRO.general}
${agente?.objetivo ? 'OBJETIVO DE ESTA CONVERSACIÓN: ' + agente.objetivo : 'OBJETIVO: atender, orientar y calificar consultas.'}

# CONOCIMIENTO DISPONIBLE (lo único con lo que podés afirmar cosas)
${contexto}`;
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

/** Respuesta del bot con RAG multi-tenant + memoria de conversación. */
async function responder(supabase, { canal, historial, mensaje }) {
  // 1. Buscar contexto (RAG) — si no hay embedding o documentos, sigue igual
  let contexto = '(sin documentos relevantes cargados)';
  try {
    const embedding = await generarEmbedding(mensaje);
    if (embedding) {
      const { data: docs } = await supabase.rpc('buscar_documentos', {
        query_embedding: embedding,
        filtro_org: canal.organizacion_id,
        filtro_agente: canal.agente_id || null,
        cantidad: 4,
      });
      if (docs && docs.length) {
        contexto = docs.map((d) => `[${d.titulo}]\n${d.contenido}`).join('\n---\n');
      }
    }
  } catch (e) { console.warn('RAG falló (sigo sin documentos):', e.message); }

  // 2. Ficha del negocio (conocimiento base)
  let fichaNegocio = '';
  try {
    const { data: perfil } = await supabase.from('perfil_negocio')
      .select('*').eq('organizacion_id', canal.organizacion_id).maybeSingle();
    if (perfil) fichaNegocio = construirFichaNegocio(perfil);
  } catch (e) { console.warn('Ficha negocio falló:', e.message); }

  // 3. Armar prompt y mensajes
  const rubro = canal.agente?.rubro || 'general';
  const system = construirPromptSistema(canal.agente, rubro, contexto) + fichaNegocio;
  const mensajes = [
    ...historial.map((m) => ({
      role: m.autor === 'cliente' ? 'user' : 'assistant',
      content: m.contenido,
    })),
    { role: 'user', content: mensaje },
  ];

  // 4. Generar respuesta con Gemini o OpenAI (con respaldo)
  return await generarConRespaldo({ system, mensajes, temperature: 0.7, maxTokens: 800 });
}

/** Extracción conversacional pasiva (segundo plano). No rompe si falla. */
async function extraerDatos(mensaje, rubro = 'general') {
  try {
    const system = `Sos un extractor de datos de un CRM. Analizá el mensaje de un
cliente (rubro: ${rubro}) y sacá todos los datos personales que mencione.
Respondé SOLO un JSON válido, sin markdown, con estas claves:
{
  "nombre": "nombre de pila, o null",
  "apellido": "apellido, o null",
  "telefono": "teléfono/celular si lo da (solo números), o null",
  "email": "correo si lo da, o null",
  "dni": "DNI/documento si lo da, o null",
  "domicilio": "dirección si la da, o null",
  "zona": "ciudad/barrio/zona, o null",
  "interes": "qué necesita / motivo de la consulta, o null",
  "convenio": "anses|issn|petroleros|camioneros|otro, o null",
  "birth_date": "fecha de nacimiento YYYY-MM-DD, o null",
  "pide_baja": true si la persona pide NO recibir más mensajes (baja/opt-out), o false
}
REGLAS: usá null en todo campo que el mensaje NO mencione explícitamente.
No inventes ni infieras. Extraé solo lo que la persona dijo textualmente.`;
    const texto = await generarConRespaldo({
      system, mensajes: [{ role: 'user', content: mensaje }],
      temperature: 0, maxTokens: 250,
    });
    const limpio = texto.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(limpio);
    // Devolver solo los campos con valor (para no pisar lo ya cargado)
    return Object.fromEntries(
      Object.entries(datos).filter(([, v]) => v !== null && v !== '' && v !== 'null')
    );
  } catch {
    return {};
  }
}

module.exports = { responder, extraerDatos, generarEmbedding, generarConRespaldo };
