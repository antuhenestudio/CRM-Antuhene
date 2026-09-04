// ============================================================
// CERTIFICADO — genera un PDF/HTML con la firma de Pablo Ivañez
// López (Fundador/CEO de AntüHene AI Studio). Descargable y
// compartible en LinkedIn. El código único permite verificarlo.
// ============================================================

/**
 * Devuelve el HTML del certificado (imprimible a PDF desde el panel
 * con window.print, o convertible en el backend). Sin dependencias.
 */
function certificadoHTML({ nombreAlumno, tituloCurso, fecha, codigo }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<style>
@page { size: A4 landscape; margin: 0; }
body{ margin:0; font-family: Georgia, serif; }
.cert{ width:1123px; height:794px; margin:0 auto; position:relative;
  background:#FCFBFA; border:18px solid #6D28D9; box-sizing:border-box; padding:60px 80px; }
.inner{ border:2px solid #8B5CF6; height:100%; padding:40px 50px; text-align:center;
  display:flex; flex-direction:column; }
.brand{ color:#6D28D9; font-size:20px; letter-spacing:2px; font-weight:bold; }
.title{ font-size:44px; color:#120E1F; margin:30px 0 6px; }
.sub{ font-size:16px; color:#645F73; margin-bottom:36px; }
.name{ font-size:36px; color:#6D28D9; border-bottom:2px solid #ddd; display:inline-block;
  padding:0 40px 8px; margin:8px 0 28px; }
.curso{ font-size:22px; color:#120E1F; margin:10px 0 40px; font-style:italic; }
.foot{ margin-top:auto; display:flex; justify-content:space-between; align-items:flex-end; }
.firma{ text-align:center; }
.firma .linea{ font-family:'Brush Script MT', cursive; font-size:30px; color:#120E1F; border-bottom:1px solid #333; padding-bottom:4px; }
.firma .cargo{ font-size:13px; color:#645F73; margin-top:6px; }
.codigo{ font-size:11px; color:#999; }
</style></head><body>
<div class="cert"><div class="inner">
  <div class="brand">ANTÜHENE AI STUDIO</div>
  <div class="title">Certificado de Finalización</div>
  <div class="sub">Se otorga el presente certificado a</div>
  <div class="name">${nombreAlumno}</div>
  <div class="sub">por haber completado satisfactoriamente el curso</div>
  <div class="curso">"${tituloCurso}"</div>
  <div class="foot">
    <div class="codigo">Código: ${codigo}<br>Verificable en antuhene.com/verificar</div>
    <div class="firma">
      <div class="linea">Pablo Ivañez López</div>
      <div class="cargo">Fundador / CEO — AntüHene AI Studio</div>
    </div>
    <div class="codigo">Fecha:<br>${fecha}</div>
  </div>
</div></div>
</body></html>`;
}

module.exports = { certificadoHTML };
