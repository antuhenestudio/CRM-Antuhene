// ============================================================
// MOTOR DE CADENCIA — UX de respuesta humanizada (vía OFICIAL)
// Orquesta el ciclo completo de una respuesta natural sobre la
// WhatsApp Cloud API. Es para BUENA EXPERIENCIA (que se sienta
// humano y cálido), no para evadir detección: con la API oficial
// no hay riesgo de baneo, así que esto suma calidez, no camuflaje.
//
// Ciclo:
//  1. Pausa de lectura antes de marcar leído.
//  2. Si el mensaje fue un audio, "escucha" (espera ~su duración).
//  3. Muestra "Escribiendo…" un tiempo proporcional al largo.
//  4. Envía la respuesta, segmentada si es larga, con jitter.
// ============================================================

const jitter = (base, rango) => base + Math.random() * rango;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calcula la duración del "Escribiendo…" según el largo del texto.
 * Velocidad humana: 30–40 caracteres/segundo. Mín 2s, máx 10s.
 */
function duracionComposing(texto) {
  const cps = 30 + Math.random() * 10;          // 30–40 cps
  let ms = (texto.length / cps) * 1000;
  ms = ms + jitter(300, 900);                    // varianza natural
  return Math.min(Math.max(ms, 2000), 10000);    // 2s..10s
}

/**
 * Segmenta un texto largo en 2–3 mensajes cortos, cortando en
 * límites naturales (fin de oración) para que se lea bien.
 */
function segmentar(texto, maxPartes = 3) {
  if (texto.length <= 160) return [texto];
  // Cortar por oraciones
  const oraciones = texto.match(/[^.!?]+[.!?]*\s*/g) || [texto];
  const partes = [];
  let actual = '';
  for (const o of oraciones) {
    if ((actual + o).length > 180 && actual) { partes.push(actual.trim()); actual = ''; }
    actual += o;
    if (partes.length >= maxPartes - 1) break;
  }
  if (actual.trim()) partes.push(actual.trim());
  // Si quedó texto sin repartir, agregarlo al último
  const usado = partes.join(' ');
  if (usado.length < texto.length - 5) partes[partes.length - 1] += ' ' + texto.slice(usado.length).trim();
  return partes.slice(0, maxPartes);
}

/**
 * Ejecuta el ciclo completo de respuesta humanizada.
 * @param {object} wa    cliente WhatsApp con { marcarLeido, mostrarComposing, enviarTexto }
 * @param {object} ctx   { canal, telefono, wamid, esAudio, duracionAudioSeg, respuesta }
 */
async function responderConCadencia(wa, ctx) {
  const { canal, telefono, wamid, esAudio, duracionAudioSeg, respuesta } = ctx;

  // 1. Pausa de lectura (no marca leído al instante)
  await dormir(jitter(1500, 2500));   // 1.5s .. 4s
  if (wamid && wa.marcarLeido) await wa.marcarLeido(canal, wamid);

  // 2. Si fue audio, "escuchar" (esperar ~la duración del audio, con tope)
  if (esAudio && duracionAudioSeg) {
    const escucha = Math.min(duracionAudioSeg * 1000, 12000); // tope 12s
    await dormir(escucha + jitter(200, 600));
  }

  // 3. Segmentar la respuesta y enviar cada parte con su composing
  const partes = segmentar(respuesta);
  for (let i = 0; i < partes.length; i++) {
    if (wa.mostrarComposing) await wa.mostrarComposing(canal, telefono);
    await dormir(duracionComposing(partes[i]));
    await wa.enviarTexto(canal, telefono, partes[i]);
    // Pausa breve entre mensajes segmentados
    if (i < partes.length - 1) await dormir(jitter(600, 800));
  }
}

module.exports = { responderConCadencia, duracionComposing, segmentar };
