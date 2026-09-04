// ============================================================
// AntüHene AI Studio — Backend multi-tenant (Fase 1+)
// Un solo webhook atiende a TODOS los clientes de la plataforma:
// phone_number_id -> canal -> organización -> agente de IA.
// Incluye handoff bot/humano y endpoint público para el widget web.
// ============================================================

require('dotenv').config();
const express = require('express');
const { mostrarEscribiendo, enviarTexto } = require('./whatsapp');
const { pausaLectura, duracionTipeo, dormir, notificarEnCadencia } = require('./humanizacion');
const { responder, extraerDatos } = require('./ia');
const {
  supabase, obtenerCanal, obtenerOCrearLead, obtenerOCrearConversacion,
  guardarMensaje, obtenerHistorial, actualizarLead,
} = require('./leads');
const { iniciarPublicador } = require('./publicador');
const {
  urlConexionMeta, verificarState, canjearCode,
  registrarCanalesMeta, registrarWhatsApp,
} = require('./conexiones');

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// 1. Verificación del webhook (Meta)
// ------------------------------------------------------------
app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN
  ) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// ------------------------------------------------------------
// 2. Mensajes entrantes de WhatsApp (todos los tenants)
// ------------------------------------------------------------
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // responder rápido: Meta reintenta si tardamos

  const valor = req.body?.entry?.[0]?.changes?.[0]?.value;
  const msg = valor?.messages?.[0];
  if (!msg || msg.type !== 'text') return;

  procesarWhatsApp({
    phoneNumberId: valor.metadata?.phone_number_id,
    telefono: msg.from,
    texto: msg.text.body,
    wamid: msg.id,
    nombrePerfil: valor?.contacts?.[0]?.profile?.name,
  }).catch((e) => console.error('Error procesando mensaje:', e));
});

async function procesarWhatsApp({ phoneNumberId, telefono, texto, wamid, nombrePerfil }) {
  // a) Ruteo multi-tenant: ¿de qué cliente es este número?
  const canal = await obtenerCanal(phoneNumberId);
  if (!canal) return console.warn('Webhook de canal no registrado:', phoneNumberId);

  // b) Lead + conversación de este tenant
  let lead = await obtenerOCrearLead(telefono, nombrePerfil, canal.organizacion_id);
  const conversacion = await obtenerOCrearConversacion(lead, canal);
  const historial = await obtenerHistorial(conversacion.id);
  await guardarMensaje({ conversacion, autor: 'cliente', contenido: texto, wamid });

  // c) HANDOFF: si un operador humano tomó la conversación, el bot calla.
  if (conversacion.modo !== 'bot' || !canal.agente_id) return;

  // d) Humanización: pausa de lectura + "Escribiendo…" oficial
  await pausaLectura();
  await mostrarEscribiendo(canal, wamid);

  // e) Respuesta con RAG del tenant + extracción pasiva, en paralelo
  const [respuesta, datos] = await Promise.all([
    responder(supabase, { canal, historial, mensaje: texto }),
    extraerDatos(texto, canal.agente?.rubro),
  ]);

  // f) Tipeo proporcional y envío
  await dormir(duracionTipeo(respuesta));
  await enviarTexto(canal, telefono, respuesta);
  await guardarMensaje({ conversacion, autor: 'bot', contenido: respuesta });

  // g) Kanban + alerta interna Tier A (cadencia 36 s ± 3 s)
  const estadoAnterior = lead.estado;
  lead = await actualizarLead(lead, datos);
  if (estadoAnterior !== 'filtrado_tier_a' && lead.estado === 'filtrado_tier_a') {
    const destinos = canal.metadatos?.telefonos_alerta || [];
    notificarEnCadencia(destinos, (destino) =>
      enviarTexto(canal, destino,
        `🔔 Lead Tier A calificado\nNombre: ${lead.nombre || 'sin dato'}\n` +
        `Tel: ${lead.telefono}\nConvenio: ${lead.convenio || '-'}\nInterés: ${lead.interes || '-'}`)
    ).catch((e) => console.error('Error en alertas:', e));
  }
}

// ------------------------------------------------------------
// 3. Widget web público (el chat de la landing habla con el bot real)
//    El sitio envía { canal_web, session_id, mensaje }.
//    canal_web = identificador de un canal tipo 'web' en la tabla canales.
// ------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { canal_web, session_id, mensaje } = req.body;
    if (!canal_web || !session_id || !mensaje) {
      return res.status(400).json({ error: 'Faltan canal_web, session_id o mensaje' });
    }
    const canal = await obtenerCanal(canal_web);
    if (!canal || canal.tipo !== 'web') return res.status(404).json({ error: 'Canal web no encontrado' });

    const lead = await obtenerOCrearLead(`web:${session_id}`, null, canal.organizacion_id);
    const conversacion = await obtenerOCrearConversacion(lead, canal);
    const historial = await obtenerHistorial(conversacion.id);
    await guardarMensaje({ conversacion, autor: 'cliente', contenido: mensaje });

    const [respuesta, datos] = await Promise.all([
      responder(supabase, { canal, historial, mensaje }),
      extraerDatos(mensaje, canal.agente?.rubro),
    ]);
    await guardarMensaje({ conversacion, autor: 'bot', contenido: respuesta });
    await actualizarLead(lead, datos);

    res.json({ respuesta });
  } catch (e) {
    console.error('Error /api/chat:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ------------------------------------------------------------
// 4. API para el panel/Kanban (el frontend real usará Supabase
//    con RLS; estos endpoints sirven para pruebas y prototipos)
// ------------------------------------------------------------
app.get('/api/leads', async (req, res) => {
  const { organizacion_id } = req.query;
  if (!organizacion_id) return res.status(400).json({ error: 'Falta organizacion_id' });
  const { data, error } = await supabase
    .from('leads').select('*')
    .eq('organizacion_id', organizacion_id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/leads/:id', async (req, res) => {
  const { estado } = req.body;
  const { data, error } = await supabase
    .from('leads').update({ estado }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ------------------------------------------------------------
// 5. Conexión de redes por el propio cliente (OAuth de Meta)
// ------------------------------------------------------------
// El panel abre esta URL en un popup: login oficial de Meta.
app.get('/conectar/meta', (req, res) => {
  const { organizacion_id } = req.query;
  if (!organizacion_id) return res.status(400).send('Falta organizacion_id');
  res.redirect(urlConexionMeta(organizacion_id));
});

// Meta redirige acá con el code; se registran los canales del cliente.
app.get('/conectar/meta/callback', async (req, res) => {
  try {
    const organizacionId = verificarState(req.query.state);
    if (!organizacionId || !req.query.code) return res.status(400).send('Solicitud inválida o vencida');

    const token = await canjearCode(req.query.code);
    const canales = await registrarCanalesMeta(supabase, organizacionId, token);

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>✅ Conexión exitosa</h2>
      <p>Canales conectados: ${canales.map((c) => `${c.tipo} (${c.nombre})`).join(', ') || 'ninguno'}</p>
      <p>Ya podés cerrar esta ventana y volver al panel.</p>
      <script>setTimeout(() => window.close(), 4000)</script>
    </body></html>`);
  } catch (e) {
    console.error('Error OAuth Meta:', e);
    res.status(500).send('Error al conectar. Intentá de nuevo desde el panel.');
  }
});

// WhatsApp Embedded Signup: el popup JS del panel envía el code acá.
app.post('/conectar/whatsapp', async (req, res) => {
  try {
    const { organizacion_id, code } = req.body;
    if (!organizacion_id || !code) return res.status(400).json({ error: 'Faltan organizacion_id o code' });
    const canales = await registrarWhatsApp(supabase, organizacion_id, code);
    res.json({ canales });
  } catch (e) {
    console.error('Error Embedded Signup:', e);
    res.status(500).json({ error: 'No se pudo conectar WhatsApp' });
  }
});

// ------------------------------------------------------------
// 6. Programar contenido (historias, feed, reels, carruseles)
//    El panel real usará Supabase con RLS; este endpoint sirve
//    para pruebas y para integrar herramientas propias.
// ------------------------------------------------------------
app.post('/api/publicaciones', async (req, res) => {
  const { organizacion_id, canal_id, texto, media_urls, formato, programada_para, recurrencia } = req.body;
  if (!organizacion_id || !canal_id || !programada_para) {
    return res.status(400).json({ error: 'Faltan organizacion_id, canal_id o programada_para' });
  }
  const { data, error } = await supabase.from('publicaciones').insert({
    organizacion_id, canal_id,
    texto: texto || null,
    media_urls: media_urls || [],
    formato: formato || 'feed',
    recurrencia: recurrencia || null,
    programada_para,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

iniciarPublicador(supabase);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AntüHene AI Studio escuchando en puerto ${PORT}`));
