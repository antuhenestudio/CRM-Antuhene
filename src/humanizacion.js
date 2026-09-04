// ============================================================
// Capa 1 del Protocolo AntüHene: Humanización Algorítmica
// Delays de lectura/tipeo, ventana horaria y cadencia de alertas
// ============================================================

const azar = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pausa de "lectura": 1.500 a 3.500 ms al recibir un mensaje.
 */
async function pausaLectura() {
  await dormir(azar(1500, 3500));
}

/**
 * Duración del estado "Escribiendo…": 45–55 ms por carácter,
 * con piso de 1.500 ms y techo de 6.000 ms.
 */
function duracionTipeo(texto) {
  const ms = texto.length * azar(45, 55);
  return Math.min(Math.max(ms, 1500), 6000);
}

/**
 * Ventana de persuasión saliente (retargeting, fidelización):
 * 09:00 a 21:00 hora Argentina. Los mensajes ENTRANTES se
 * responden 24/7; esto solo aplica a envíos proactivos.
 */
function dentroDeVentanaOutbound(fecha = new Date()) {
  const horaAR = Number(
    new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: 'numeric', hour12: false,
    }).format(fecha)
  );
  return horaAR >= 9 && horaAR < 21;
}

/**
 * Próximo horario válido de envío: si estamos fuera de ventana,
 * devuelve las 09:01 AM (AR) del día correspondiente.
 */
function proximaVentanaOutbound(fecha = new Date()) {
  if (dentroDeVentanaOutbound(fecha)) return fecha;
  const d = new Date(fecha);
  const horaAR = Number(
    new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: 'numeric', hour12: false,
    }).format(d)
  );
  if (horaAR >= 21) d.setDate(d.getDate() + 1);
  // 09:01 AR = 12:01 UTC (AR es UTC-3 todo el año)
  d.setUTCHours(12, 1, 0, 0);
  return d;
}

/**
 * Algoritmo CADENCE: notificaciones internas consecutivas
 * (ej: avisar a 3 abogados/vendedores que entró un lead Tier A)
 * se espacian 36 s ± 3 s, sin ráfagas paralelas.
 */
async function notificarEnCadencia(destinos, enviarFn) {
  for (let i = 0; i < destinos.length; i++) {
    if (i > 0) await dormir(azar(33000, 39000));
    await enviarFn(destinos[i]);
  }
}

module.exports = {
  pausaLectura,
  duracionTipeo,
  dentroDeVentanaOutbound,
  proximaVentanaOutbound,
  notificarEnCadencia,
  dormir,
};
