// ============================================================
// CONEXIÓN DE REDES POR EL PROPIO CLIENTE (OAuth de Meta)
// Flujo: el cliente toca "Conectar" en su panel → popup oficial
// de Meta → se loguea y autoriza → volvemos con un code → lo
// canjeamos por tokens de larga duración → damos de alta sus
// canales (página de Facebook + cuenta de Instagram vinculada).
// WhatsApp usa Embedded Signup (popup JS de Meta en el panel).
// Nunca se piden contraseñas; el cliente puede revocar el
// permiso desde su configuración de Facebook cuando quiera.
// ============================================================

const crypto = require('crypto');
const API = 'v21.0';
const g = (p) => `https://graph.facebook.com/${API}/${p}`;

const SCOPES = [
  'pages_show_list',
  'pages_manage_posts',        // publicar en la página
  'pages_messaging',           // Messenger
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish', // feed/reels/stories de IG
  'instagram_manage_messages', // DMs de IG
  'business_management',
].join(',');

// ---- state firmado (HMAC): evita que alguien conecte canales a otra org ----
function firmarState(organizacionId) {
  const payload = `${organizacionId}.${Date.now()}`;
  const firma = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET)
    .update(payload).digest('hex');
  return Buffer.from(`${payload}.${firma}`).toString('base64url');
}
function verificarState(state) {
  try {
    const [org, ts, firma] = Buffer.from(state, 'base64url').toString().split('.');
    const esperada = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET)
      .update(`${org}.${ts}`).digest('hex');
    const ok = crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
    const fresco = Date.now() - Number(ts) < 15 * 60 * 1000; // 15 min
    return ok && fresco ? org : null;
  } catch { return null; }
}

/** URL del popup de login de Meta para conectar la organización. */
function urlConexionMeta(organizacionId) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.OAUTH_REDIRECT_URL,
    state: firmarState(organizacionId),
    scope: SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/${API}/dialog/oauth?${params}`;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}

/** code -> token corto -> token de larga duración (~60 días). */
async function canjearCode(code) {
  const corto = await getJson(g(`oauth/access_token?${new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.OAUTH_REDIRECT_URL,
    code,
  })}`));
  const largo = await getJson(g(`oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: corto.access_token,
  })}`));
  return largo.access_token;
}

/**
 * Con el token del usuario, descubre sus páginas y cuentas de IG
 * vinculadas, y las registra como `canales` de su organización.
 * Los tokens de página NO caducan mientras el permiso siga vigente.
 */
async function registrarCanalesMeta(supabase, organizacionId, tokenUsuario) {
  const paginas = await getJson(
    g(`me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${tokenUsuario}`)
  );

  const creados = [];
  for (const p of paginas.data || []) {
    const { data: fb } = await supabase.from('canales').upsert({
      organizacion_id: organizacionId,
      tipo: 'facebook',
      identificador: p.id,
      token_acceso: p.access_token,
      metadatos: { nombre: p.name },
      activo: true,
    }, { onConflict: 'tipo,identificador' }).select().single();
    if (fb) creados.push({ tipo: 'facebook', nombre: p.name });

    if (p.instagram_business_account) {
      const ig = p.instagram_business_account;
      const { data: igCanal } = await supabase.from('canales').upsert({
        organizacion_id: organizacionId,
        tipo: 'instagram',
        identificador: ig.id,
        token_acceso: p.access_token, // IG opera con el token de la página
        metadatos: { username: ig.username, page_id: p.id },
        activo: true,
      }, { onConflict: 'tipo,identificador' }).select().single();
      if (igCanal) creados.push({ tipo: 'instagram', nombre: `@${ig.username}` });
    }
  }
  return creados;
}

/**
 * WhatsApp Embedded Signup: el popup JS de Meta en el panel devuelve
 * un `code`; acá se canjea y se registran los números conectados.
 */
async function registrarWhatsApp(supabase, organizacionId, code) {
  const token = await canjearCode(code);
  // Descubrir la WABA y sus números compartidos con la app
  const debug = await getJson(g(`debug_token?input_token=${token}&access_token=${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`));
  const wabaIds = (debug.data?.granular_scopes || [])
    .find((s) => s.scope === 'whatsapp_business_management')?.target_ids || [];

  const creados = [];
  for (const wabaId of wabaIds) {
    const nums = await getJson(g(`${wabaId}/phone_numbers?access_token=${token}`));
    for (const n of nums.data || []) {
      await supabase.from('canales').upsert({
        organizacion_id: organizacionId,
        tipo: 'whatsapp',
        identificador: n.id, // phone_number_id
        token_acceso: token,
        metadatos: { numero: n.display_phone_number, waba_id: wabaId },
        activo: true,
      }, { onConflict: 'tipo,identificador' });
      creados.push({ tipo: 'whatsapp', nombre: n.display_phone_number });
    }
  }
  return creados;
}

module.exports = { urlConexionMeta, verificarState, canjearCode, registrarCanalesMeta, registrarWhatsApp };
