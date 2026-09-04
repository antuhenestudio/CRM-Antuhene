// ============================================================
// PUBLICADOR PROGRAMADO (estilo Postcron/Metricool, multi-tenant)
// Un worker revisa cada minuto la tabla `publicaciones` y sube
// el contenido vencido al canal correspondiente de cada cliente.
//
// Soporte por API oficial:
//   Instagram : feed (imagen/video), STORY, reel, carrusel
//   Facebook  : feed de página, STORY de página
//   TikTok    : video/foto al perfil (requiere aprobación de app; sin story)
//   LinkedIn  : post de página (requiere programa de socios; sin story)
//   WhatsApp  : los Estados NO tienen API — no automatizable.
// ============================================================

const API = 'v21.0';
const g = (path) => `https://graph.facebook.com/${API}/${path}`;

async function meta(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(JSON.stringify(data.error || data));
  return data;
}

const esVideo = (u) => /\.(mp4|mov)(\?|$)/i.test(u);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Instagram (canal.identificador = ig_user_id) ----------------
async function publicarInstagram(canal, pub) {
  const igId = canal.identificador;
  const token = canal.token_acceso;

  async function crearContenedor(url, extra = {}) {
    const body = esVideo(url)
      ? { media_type: 'REELS', video_url: url, ...extra }
      : { image_url: url, ...extra };
    const r = await meta(g(`${igId}/media`), token, body);
    return r.id;
  }

  let contenedor;
  if (pub.formato === 'story') {
    const url = pub.media_urls[0];
    contenedor = (await meta(g(`${igId}/media`), token, {
      media_type: 'STORIES',
      ...(esVideo(url) ? { video_url: url } : { image_url: url }),
    })).id;
  } else if (pub.formato === 'carrusel') {
    const hijos = [];
    for (const url of pub.media_urls.slice(0, 10)) {
      hijos.push(await crearContenedor(url, { is_carousel_item: true }));
      await dormir(1500);
    }
    contenedor = (await meta(g(`${igId}/media`), token, {
      media_type: 'CAROUSEL', children: hijos, caption: pub.texto || '',
    })).id;
  } else { // feed o reel
    const url = pub.media_urls[0];
    contenedor = (await meta(g(`${igId}/media`), token, {
      ...(esVideo(url)
        ? { media_type: 'REELS', video_url: url }
        : { image_url: url }),
      caption: pub.texto || '',
    })).id;
  }

  // Los videos tardan en procesarse: esperar antes de publicar
  if (pub.media_urls.some(esVideo)) await dormir(20000);
  const r = await meta(g(`${igId}/media_publish`), token, { creation_id: contenedor });
  return r.id;
}

// ---------------- Facebook (canal.identificador = page_id) ----------------
async function publicarFacebook(canal, pub) {
  const pageId = canal.identificador;
  const token = canal.token_acceso;
  const url = pub.media_urls[0];

  if (pub.formato === 'story') {
    // Stories de página: subir foto no publicada y crear la story
    if (esVideo(url)) throw new Error('Story de video FB: usar flujo de video_stories');
    const foto = await meta(g(`${pageId}/photos`), token, { url, published: false });
    const r = await meta(g(`${pageId}/photo_stories`), token, { photo_id: foto.id });
    return r.post_id || foto.id;
  }
  if (url && !esVideo(url)) {
    const r = await meta(g(`${pageId}/photos`), token, { url, caption: pub.texto || '' });
    return r.post_id || r.id;
  }
  if (url && esVideo(url)) {
    const r = await meta(g(`${pageId}/videos`), token, { file_url: url, description: pub.texto || '' });
    return r.id;
  }
  const r = await meta(g(`${pageId}/feed`), token, { message: pub.texto || '' });
  return r.id;
}

const PUBLICADORES = { instagram: publicarInstagram, facebook: publicarFacebook };
// tiktok / linkedin: agregar acá cuando la app tenga las aprobaciones.

// ---------------- Worker ----------------
async function procesarPendientes(supabase) {
  const { data: pendientes } = await supabase
    .from('publicaciones')
    .select('*, canal:canales(*)')
    .eq('estado', 'programada')
    .lte('programada_para', new Date().toISOString())
    .limit(10);

  for (const pub of pendientes || []) {
    const fn = PUBLICADORES[pub.canal?.tipo];
    try {
      if (!fn) throw new Error(`Canal ${pub.canal?.tipo} sin publicador habilitado`);
      const idPost = await fn(pub.canal, pub);
      await supabase.from('publicaciones').update({
        estado: 'publicada',
        publicado_en: new Date().toISOString(),
        resultado: { post_id: idPost },
      }).eq('id', pub.id);

      // Recurrencia: reprogramar la próxima ocurrencia
      if (pub.recurrencia) {
        const prox = new Date(pub.programada_para);
        if (pub.recurrencia === 'diaria') prox.setDate(prox.getDate() + 1);
        if (pub.recurrencia === 'semanal') prox.setDate(prox.getDate() + 7);
        if (pub.recurrencia === 'mensual') prox.setMonth(prox.getMonth() + 1);
        await supabase.from('publicaciones').insert({
          organizacion_id: pub.organizacion_id,
          canal_id: pub.canal_id,
          texto: pub.texto,
          media_urls: pub.media_urls,
          formato: pub.formato,
          recurrencia: pub.recurrencia,
          creado_por: pub.creado_por,
          programada_para: prox.toISOString(),
        });
      }
      console.log(`Publicado ${pub.formato} en ${pub.canal.tipo}:`, idPost);
    } catch (e) {
      const intentos = (pub.intentos || 0) + 1;
      await supabase.from('publicaciones').update({
        intentos,
        estado: intentos >= 3 ? 'error' : 'programada', // 3 reintentos y marca error
        resultado: { error: String(e.message).slice(0, 500) },
      }).eq('id', pub.id);
      console.error(`Error publicando ${pub.id} (intento ${intentos}):`, e.message);
    }
    await dormir(3000); // cadencia entre publicaciones (sin ráfagas)
  }
}

/** Inicia el worker: revisa la cola cada minuto. */
function iniciarPublicador(supabase) {
  console.log('Publicador programado iniciado (cada 60 s)');
  setInterval(() => procesarPendientes(supabase).catch(console.error), 60000);
}

module.exports = { iniciarPublicador, procesarPendientes };
