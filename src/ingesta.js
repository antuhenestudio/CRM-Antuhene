// ============================================================
// INGESTA DE CONOCIMIENTO (RAG) — procesa archivos y URLs
// Extrae texto de PDF/Word/Excel/URL, lo trocea y genera
// embeddings, guardándolos en `documentos` (filtrados por
// organización y, opcionalmente, por agente). Cero invención:
// el bot solo responde con lo que se cargó acá.
//
// Requiere: pdf-parse, mammoth, xlsx  (ver package.json)
// ============================================================

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { generarEmbedding } = require('./ia');

/** Trocea texto largo en chunks con solapamiento (mejor recuperación). */
function trocear(texto, tam = 1000, solape = 150) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  const chunks = [];
  for (let i = 0; i < limpio.length; i += tam - solape) {
    const frag = limpio.slice(i, i + tam).trim();
    if (frag.length > 40) chunks.push(frag);
  }
  return chunks;
}

// ---- Extractores por tipo (reciben un Buffer, salvo URL) ----
async function textoDePDF(buffer) { return (await pdfParse(buffer)).text; }
async function textoDeWord(buffer) { return (await mammoth.extractRawText({ buffer })).value; }
function textoDeExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames
    .map((n) => `Hoja: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
    .join('\n\n');
}
async function textoDeURL(url) {
  const res = await fetch(url);
  const html = await res.text();
  // Extracción simple: quita scripts/estilos y etiquetas.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

/**
 * Procesa una fuente ya registrada (estado 'pendiente') y llena
 * `documentos` con sus chunks + embeddings.
 * @param {object} supabase
 * @param {object} fuente  fila de fuentes_conocimiento
 * @param {Buffer} buffer  contenido del archivo (no para URL)
 */
async function procesarFuente(supabase, fuente, buffer) {
  await supabase.from('fuentes_conocimiento')
    .update({ estado: 'procesando' }).eq('id', fuente.id);

  try {
    let texto = '';
    if (fuente.tipo === 'pdf') texto = await textoDePDF(buffer);
    else if (fuente.tipo === 'word') texto = await textoDeWord(buffer);
    else if (fuente.tipo === 'excel') texto = textoDeExcel(buffer);
    else if (fuente.tipo === 'url') texto = await textoDeURL(fuente.origen_url);
    else if (fuente.tipo === 'texto') texto = fuente.origen_url || '';

    const chunks = trocear(texto);
    if (!chunks.length) throw new Error('No se pudo extraer texto útil del archivo.');

    // Generar embeddings e insertar (en lotes para no saturar)
    let insertados = 0;
    for (const frag of chunks) {
      const embedding = await generarEmbedding(frag);
      const { error } = await supabase.from('documentos').insert({
        organizacion_id: fuente.organizacion_id,
        agente_id: fuente.agente_id,
        fuente_id: fuente.id,
        titulo: fuente.nombre,
        contenido: frag,
        embedding,
      });
      if (!error) insertados++;
    }

    await supabase.from('fuentes_conocimiento').update({
      estado: 'listo', fragmentos: insertados,
    }).eq('id', fuente.id);

    return { insertados };
  } catch (e) {
    await supabase.from('fuentes_conocimiento').update({
      estado: 'error', detalle: String(e.message).slice(0, 500),
    }).eq('id', fuente.id);
    throw e;
  }
}

module.exports = { procesarFuente, trocear };
