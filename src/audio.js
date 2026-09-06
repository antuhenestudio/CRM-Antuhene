// ============================================================
// MÓDULO DE AUDIOS — transcripción de notas de voz (Whisper)
// Recibe el audio de WhatsApp (OGG/Opus), lo convierte a MP3 con
// fluent-ffmpeg, lo transcribe con Whisper y devuelve el texto +
// la duración (para el motor de humanización que "escucha" el audio).
//
// Requiere en package.json: fluent-ffmpeg, ffmpeg-static
// (ffmpeg-static trae el binario de ffmpeg sin instalarlo aparte)
// ============================================================

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const fs = require('fs');
const os = require('os');
const path = require('path');

const OPENAI_URL = 'https://api.openai.com/v1';

/**
 * Descarga el audio de WhatsApp Cloud API usando el media_id.
 * Devuelve un Buffer con el contenido OGG/Opus.
 */
async function descargarAudioWhatsApp(mediaId, token) {
  // 1. Obtener la URL temporal del media
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  if (!meta.url) throw new Error('No se pudo obtener la URL del audio');

  // 2. Descargar el binario (requiere el token en el header)
  const audioRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const arrayBuf = await audioRes.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Convierte un Buffer OGG/Opus a un archivo MP3 temporal.
 * Devuelve { rutaMp3, duracionSeg }.
 */
function convertirAMp3(bufferOgg) {
  return new Promise((resolve, reject) => {
    const tmp = os.tmpdir();
    const entrada = path.join(tmp, `audio-${Date.now()}.ogg`);
    const salida = path.join(tmp, `audio-${Date.now()}.mp3`);
    fs.writeFileSync(entrada, bufferOgg);

    let duracion = 0;
    ffmpeg(entrada)
      .on('codecData', (data) => {
        // data.duration viene como "00:00:12.34"
        const p = (data.duration || '0:0:0').split(':').map(Number);
        duracion = p[0] * 3600 + p[1] * 60 + p[2];
      })
      .toFormat('mp3')
      .on('end', () => {
        try { fs.unlinkSync(entrada); } catch (e) {}
        resolve({ rutaMp3: salida, duracionSeg: Math.round(duracion) || 5 });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(entrada); } catch (e) {}
        reject(err);
      })
      .save(salida);
  });
}

/**
 * Transcribe un archivo MP3 con Whisper (OpenAI).
 * Nota honesta: Whisper es de OpenAI y necesita saldo en esa cuenta.
 * Si OpenAI no tiene saldo, esta función falla y el flujo sigue sin
 * transcripción (el bot pide que reformulen por texto).
 */
async function transcribirWhisper(rutaMp3) {
  const archivo = fs.readFileSync(rutaMp3);
  const form = new FormData();
  form.append('file', new Blob([archivo], { type: 'audio/mp3' }), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('language', 'es');

  const res = await fetch(`${OPENAI_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json();
  try { fs.unlinkSync(rutaMp3); } catch (e) {}
  if (data.error) throw new Error('Whisper: ' + JSON.stringify(data.error));
  return data.text || '';
}

/**
 * Flujo completo: media_id → descarga → mp3 → transcripción.
 * Devuelve { texto, duracionSeg }.
 */
async function procesarAudio(mediaId, token) {
  const bufferOgg = await descargarAudioWhatsApp(mediaId, token);
  const { rutaMp3, duracionSeg } = await convertirAMp3(bufferOgg);
  const texto = await transcribirWhisper(rutaMp3);
  return { texto, duracionSeg };
}

module.exports = { procesarAudio, descargarAudioWhatsApp, convertirAMp3, transcribirWhisper };
