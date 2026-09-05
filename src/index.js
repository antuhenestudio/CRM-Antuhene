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
const { procesarFuente } = require('./ingesta');
const { dispararEvento } = require('./notificaciones');
const { recalcularScore } = require('./scoring');
const { crearSuscripcion, procesarWebhookMP, puedeVincular } = require('./suscripciones');
const { iniciarAntu } = require('./antu');
const { comprarCurso, procesarPagoCurso, corregirTest, marcarVideoVisto, chequearCompletado } = require('./academia');
const { certificadoHTML } = require('./certificado');
const { resumirConversacion } = require('./resumen');
const { canjearCodigo, iniciarRevisorTrials } = require('./trial');
const { iniciarAvisadorLeads } = require('./aviso_lead');
const {
  urlConexionGoogle, canjearCodeGoogle, crearEvento, detectarCita,
} = require('./calendar');
const multer = require('multer');
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();

// ------------------------------------------------------------
// CORS: permite que los widgets en sitios externos (y el panel)
// hablen con el backend. Sin esto, el chat del widget no responde.
// ------------------------------------------------------------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Servir el widget embebible y archivos estáticos de /web
const path = require('path');
app.get('/widget.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'web', 'widget.js'));
});

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

  // g) Actualizar datos, recalcular puntaje/tier y disparar eventos
  lead = await actualizarLead(lead, datos);
  const score = await recalcularScore(supabase, lead);
  lead.tier = score.tier; lead.puntaje = score.puntaje;

  if (historial.length === 0) {
    dispararEvento(supabase, { evento: 'lead_nuevo', lead, canal });
  }
  if (score.subioAtierA) {
    dispararEvento(supabase, { evento: 'tier_a', lead, canal });
  }

  // h) ¿El mensaje propone una cita concreta? Agendarla en Google Calendar
  try {
    const cita = await detectarCita(texto, lead.nombre);
    if (cita) {
      // Validar horario comercial (salvo negocio online)
      const { data: enHorario } = await supabase.rpc('dentro_horario_atencion', {
        org: canal.organizacion_id, momento: cita.inicio_iso,
      });
      const { data: calCanal } = await supabase.from('canales').select('*')
        .eq('organizacion_id', canal.organizacion_id)
        .eq('tipo', 'google_calendar').eq('activo', true).maybeSingle();
      if (!enHorario) {
        console.log('Cita fuera de horario comercial, no se agenda:', cita.inicio_iso);
      } else if (calCanal) {
        const ev = await crearEvento(calCanal, {
          titulo: cita.titulo,
          descripcion: `Lead ${lead.registro_interno || ''} · ${lead.telefono}\nInterés: ${lead.interes || '-'}`,
          inicio: cita.inicio_iso, fin: cita.fin_iso,
        });
        await supabase.from('citas').insert({
          organizacion_id: canal.organizacion_id, lead_id: lead.id,
          agente_id: canal.agente_id, titulo: cita.titulo,
          inicio: cita.inicio_iso, fin: cita.fin_iso, gcal_event_id: ev.id,
        });
        await supabase.from('leads').update({ estado: 'cita_agendada' }).eq('id', lead.id);
        dispararEvento(supabase, { evento: 'cita_agendada', lead, canal });
      }
    }
  } catch (e) { console.error('Error agendando cita:', e.message); }
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
// 4-bis. Conversaciones reales del inbox (para el panel)
// ------------------------------------------------------------
// Lista las conversaciones de una organización con el último mensaje.
app.get('/api/conversaciones', async (req, res) => {
  try {
    const { organizacion_id } = req.query;
    if (!organizacion_id) return res.status(400).json({ error: 'Falta organizacion_id' });
    const { data, error } = await supabase
      .from('conversaciones')
      .select('id, modo, ultimo_mensaje, lead:lead_id(nombre, telefono, interes), canal:canal_id(tipo)')
      .eq('organizacion_id', organizacion_id)
      .order('ultimo_mensaje', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error('Error /api/conversaciones:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Trae los mensajes de una conversación + un resumen con IA.
app.get('/api/conversaciones/:id', async (req, res) => {
  try {
    const { data: mensajes, error } = await supabase
      .from('mensajes')
      .select('autor, contenido, created_at')
      .eq('conversacion_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    let analisis = null;
    if (mensajes && mensajes.length >= 2) {
      try { analisis = await resumirConversacion(mensajes); }
      catch (e) { console.warn('Resumen falló:', e.message); }
    }
    res.json({ mensajes: mensajes || [], analisis });
  } catch (e) {
    console.error('Error /api/conversaciones/:id:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ------------------------------------------------------------
// 5. Conexión de redes por el propio cliente (OAuth de Meta)
// ------------------------------------------------------------
// El panel abre esta URL en un popup: login oficial de Meta.
app.get('/conectar/meta', async (req, res) => {
  const { organizacion_id } = req.query;
  if (!organizacion_id) return res.status(400).send('Falta organizacion_id');
  if (!(await puedeVincular(supabase, organizacion_id))) {
    return res.status(402).send('Suscripción requerida para conectar canales.');
  }
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

// Google Calendar: conectar la agenda del negocio.
app.get('/conectar/google', (req, res) => {
  const { organizacion_id } = req.query;
  if (!organizacion_id) return res.status(400).send('Falta organizacion_id');
  const crypto = require('crypto');
  const payload = `${organizacion_id}.${Date.now()}`;
  const firma = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  const state = Buffer.from(`${payload}.${firma}`).toString('base64url');
  res.redirect(urlConexionGoogle(state));
});

app.get('/conectar/google/callback', async (req, res) => {
  try {
    const organizacionId = verificarState(req.query.state);
    if (!organizacionId || !req.query.code) return res.status(400).send('Solicitud inválida o vencida');
    const tokens = await canjearCodeGoogle(req.query.code);
    if (!tokens.refresh_token) return res.status(400).send('Google no devolvió refresh_token. Revocá el acceso y volvé a conectar.');
    await supabase.from('canales').upsert({
      organizacion_id: organizacionId, tipo: 'google_calendar',
      identificador: `gcal-${organizacionId}`, token_acceso: tokens.refresh_token,
      metadatos: { calendar_id: 'primary' }, activo: true,
    }, { onConflict: 'tipo,identificador' });
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>✅ Google Calendar conectado</h2><p>Las citas que detecte el bot se van a agendar en tu calendario.</p>
      <script>setTimeout(()=>window.close(),3500)</script></body></html>`);
  } catch (e) {
    console.error('Error OAuth Google:', e);
    res.status(500).send('Error al conectar Google.');
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
// Trial: canjear un código de prueba de 30 días
// ------------------------------------------------------------
app.post('/api/trial/canjear', async (req, res) => {
  try {
    const { organizacion_id, codigo } = req.body;
    if (!organizacion_id || !codigo) return res.status(400).json({ error: 'Faltan datos' });
    const resultado = await canjearCodigo(supabase, {
      organizacionId: organizacion_id, codigo: codigo.trim().toUpperCase(),
    });
    res.json({ resultado });
  } catch (e) {
    console.error('Error canjeando trial:', e);
    res.status(500).json({ error: 'No se pudo canjear el código' });
  }
});

// ------------------------------------------------------------
// 5-pre. Suscripciones (muro de pago con Mercado Pago)
// ------------------------------------------------------------
app.post('/api/suscripcion', async (req, res) => {
  try {
    const { organizacion_id, plan_id, email } = req.body;
    if (!organizacion_id || !plan_id || !email) {
      return res.status(400).json({ error: 'Faltan organizacion_id, plan_id o email' });
    }
    const checkout = await crearSuscripcion(supabase, {
      organizacionId: organizacion_id, planId: plan_id, emailPagador: email,
    });
    res.json({ checkout_url: checkout });
  } catch (e) {
    console.error('Error creando suscripción:', e);
    res.status(500).json({ error: 'No se pudo iniciar la suscripción' });
  }
});

// Mercado Pago notifica los pagos acá (configurar esta URL en MP)
app.post('/webhook/mercadopago', async (req, res) => {
  res.sendStatus(200);
  (async () => {
    try {
      if (req.body.type === 'payment') {
        const pago = await (await fetch(`https://api.mercadopago.com/v1/payments/${req.body.data.id}`,
          { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } })).json();
        // ¿es pago de curso o de suscripción?
        const esCurso = await procesarPagoCurso(supabase, pago);
        if (!esCurso) await procesarWebhookMP(supabase, req.body);
      } else {
        await procesarWebhookMP(supabase, req.body);
      }
    } catch (e) { console.error('Error webhook MP:', e); }
  })();
});

// ------------------------------------------------------------
// Academia: comprar curso, tests, progreso, certificado
// ------------------------------------------------------------
app.post('/api/academia/comprar', async (req, res) => {
  try {
    const { user_id, organizacion_id, curso_id, email } = req.body;
    if (!user_id || !curso_id || !email) return res.status(400).json({ error: 'Faltan datos' });
    const url = await comprarCurso(supabase, { userId: user_id, orgId: organizacion_id, cursoId: curso_id, email });
    res.json({ checkout_url: url });
  } catch (e) { res.status(500).json({ error: 'No se pudo iniciar la compra' }); }
});

app.post('/api/academia/video-visto', async (req, res) => {
  try {
    const { user_id, leccion_id, curso_id } = req.body;
    await marcarVideoVisto(supabase, { userId: user_id, leccionId: leccion_id });
    const r = await chequearCompletado(supabase, { userId: user_id, cursoId: curso_id });
    res.json(r || {});
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/test', async (req, res) => {
  try {
    const { user_id, leccion_id, curso_id, respuestas } = req.body;
    const r = await corregirTest(supabase, { userId: user_id, leccionId: leccion_id, respuestas });
    let cert = null;
    if (r.aprobado) cert = await chequearCompletado(supabase, { userId: user_id, cursoId: curso_id });
    res.json({ ...r, ...(cert || {}) });
  } catch (e) { res.status(500).json({ error: 'Error corrigiendo el test' }); }
});

app.get('/api/academia/certificado/:inscripcion', async (req, res) => {
  try {
    const { data: insc } = await supabase.from('inscripciones')
      .select('*, curso:cursos(titulo)').eq('id', req.params.inscripcion).maybeSingle();
    if (!insc || !insc.completado) return res.status(404).send('Certificado no disponible');
    const { data: perfil } = await supabase.from('perfiles').select('nombre').eq('user_id', insc.user_id).maybeSingle();
    res.send(certificadoHTML({
      nombreAlumno: perfil?.nombre || 'Alumno',
      tituloCurso: insc.curso?.titulo || 'Curso',
      fecha: new Date(insc.completado_en).toLocaleDateString('es-AR'),
      codigo: insc.certificado_id,
    }));
  } catch (e) { res.status(500).send('Error'); }
});

// ------------------------------------------------------------
// 5-bis. Nutrir el conocimiento del bot (RAG): subir archivo o URL
// ------------------------------------------------------------
app.post('/api/conocimiento/archivo', subir.single('archivo'), async (req, res) => {
  try {
    const { organizacion_id, agente_id, tipo } = req.body;
    if (!organizacion_id || !tipo || !req.file) {
      return res.status(400).json({ error: 'Faltan organizacion_id, tipo o archivo' });
    }
    const { data: fuente, error } = await supabase.from('fuentes_conocimiento').insert({
      organizacion_id, agente_id: agente_id || null, tipo,
      nombre: req.file.originalname,
    }).select().single();
    if (error) throw error;

    // Procesar en segundo plano (responder ya)
    res.json({ fuente_id: fuente.id, estado: 'procesando' });
    procesarFuente(supabase, fuente, req.file.buffer)
      .catch((e) => console.error('Error procesando fuente:', e.message));
  } catch (e) {
    console.error('Error ingesta archivo:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo' });
  }
});

app.post('/api/conocimiento/url', async (req, res) => {
  try {
    const { organizacion_id, agente_id, url } = req.body;
    if (!organizacion_id || !url) return res.status(400).json({ error: 'Faltan organizacion_id o url' });
    const { data: fuente, error } = await supabase.from('fuentes_conocimiento').insert({
      organizacion_id, agente_id: agente_id || null, tipo: 'url',
      nombre: url, origen_url: url,
    }).select().single();
    if (error) throw error;
    res.json({ fuente_id: fuente.id, estado: 'procesando' });
    procesarFuente(supabase, fuente).catch((e) => console.error('Error procesando URL:', e.message));
  } catch (e) {
    res.status(500).json({ error: 'No se pudo procesar la URL' });
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
iniciarAntu(supabase);
iniciarRevisorTrials(supabase);
iniciarAvisadorLeads(supabase);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AntüHene AI Studio escuchando en puerto ${PORT}`));
