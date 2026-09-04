/* ============================================================
   AntüHene AI Studio — Widget de chat embebible
   Se sirve a los sitios web de los clientes. Cada cliente pega
   un snippet que carga este archivo con SU canal_web. El widget
   habla con el backend (/api/chat), que responde con el alma
   AntüHene + el RAG y la ficha de ESE negocio, y captura nombre
   y contacto en la conversación.

   Uso (lo genera el panel para cada cliente):
   <script src="https://TU-BACKEND/widget.js"
           data-canal="antuhene-xxxx"
           data-backend="https://TU-BACKEND"
           data-color="#8B5CF6"
           data-titulo="Asistente"></script>
   ============================================================ */
(function () {
  var s = document.currentScript;
  var CANAL = s.getAttribute('data-canal');
  var BACKEND = s.getAttribute('data-backend');
  var COLOR = s.getAttribute('data-color') || '#8B5CF6';
  var TITULO = s.getAttribute('data-titulo') || 'Asistente';
  var SALUDO = s.getAttribute('data-saludo') || '¡Hola! ¿En qué puedo ayudarte?';
  if (!CANAL || !BACKEND) { console.error('Widget AntüHene: faltan data-canal o data-backend'); return; }

  // Sesión persistente por visitante (para dar contexto a la conversación)
  var sid = localStorage.getItem('ah_sid');
  if (!sid) { sid = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); localStorage.setItem('ah_sid', sid); }

  // ---- Estilos (aislados con prefijo ahw-) ----
  var css = document.createElement('style');
  css.textContent = [
    '.ahw-btn{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;',
    'background:' + COLOR + ';box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;z-index:999998;',
    'display:flex;align-items:center;justify-content:center;border:none;transition:transform .2s}',
    '.ahw-btn:hover{transform:scale(1.06)}',
    '.ahw-btn svg{width:28px;height:28px;fill:#fff}',
    '.ahw-panel{position:fixed;bottom:92px;right:20px;width:350px;max-width:calc(100vw - 40px);',
    'height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;z-index:999999;',
    'box-shadow:0 24px 60px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;',
    'font-family:-apple-system,Segoe UI,Roboto,sans-serif}',
    '.ahw-panel.open{display:flex}',
    '.ahw-head{background:' + COLOR + ';color:#fff;padding:16px;font-weight:600;display:flex;',
    'align-items:center;justify-content:space-between}',
    '.ahw-head span{font-size:15px}.ahw-close{cursor:pointer;opacity:.85;font-size:20px;background:none;border:none;color:#fff}',
    '.ahw-body{flex:1;overflow-y:auto;padding:14px;background:#F7F7F9;display:flex;flex-direction:column;gap:9px}',
    '.ahw-msg{max-width:82%;padding:10px 13px;border-radius:13px;font-size:14px;line-height:1.45}',
    '.ahw-in{background:#fff;color:#1a1a1a;align-self:flex-start;border-bottom-left-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.08)}',
    '.ahw-out{background:' + COLOR + ';color:#fff;align-self:flex-end;border-bottom-right-radius:3px}',
    '.ahw-typing{align-self:flex-start;color:#999;font-size:13px;padding:6px 10px}',
    '.ahw-foot{padding:10px;background:#fff;border-top:1px solid #eee;display:flex;gap:8px}',
    '.ahw-foot input{flex:1;border:1px solid #ddd;border-radius:20px;padding:10px 14px;font-size:14px;outline:none}',
    '.ahw-foot input:focus{border-color:' + COLOR + '}',
    '.ahw-foot button{background:' + COLOR + ';border:none;color:#fff;border-radius:50%;width:40px;height:40px;cursor:pointer;font-size:16px}',
    '.ahw-powered{text-align:center;font-size:10px;color:#bbb;padding:4px}'
  ].join('');
  document.head.appendChild(css);

  // ---- HTML ----
  var btn = document.createElement('button');
  btn.className = 'ahw-btn';
  btn.setAttribute('aria-label', 'Abrir chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'ahw-panel';
  panel.innerHTML =
    '<div class="ahw-head"><span>' + esc(TITULO) + '</span><button class="ahw-close" aria-label="Cerrar">×</button></div>' +
    '<div class="ahw-body" id="ahw-body"></div>' +
    '<div class="ahw-foot"><input id="ahw-input" placeholder="Escribí tu mensaje..." autocomplete="off"><button id="ahw-send" aria-label="Enviar">➤</button></div>' +
    '<div class="ahw-powered">con IA de AntüHene AI Studio</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector('#ahw-body');
  var input = panel.querySelector('#ahw-input');
  var abierto = false, saludoDado = false;

  btn.onclick = function () {
    abierto = !abierto;
    panel.classList.toggle('open', abierto);
    if (abierto && !saludoDado) { addMsg(SALUDO, 'in'); saludoDado = true; input.focus(); }
  };
  panel.querySelector('.ahw-close').onclick = function () { abierto = false; panel.classList.remove('open'); };

  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function addMsg(txt, tipo) {
    var el = document.createElement('div');
    el.className = 'ahw-msg ahw-' + tipo;
    el.textContent = txt;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function enviar() {
    var txt = input.value.trim();
    if (!txt) return;
    addMsg(txt, 'out');
    input.value = '';
    var typing = document.createElement('div');
    typing.className = 'ahw-typing';
    typing.textContent = TITULO + ' está escribiendo...';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    fetch(BACKEND + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canal_web: CANAL, session_id: sid, mensaje: txt })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        addMsg(d.respuesta || 'Disculpá, no pude responder ahora. Probá de nuevo en un momento.', 'in');
      })
      .catch(function () {
        typing.remove();
        addMsg('Hubo un problema de conexión. Intentá de nuevo, por favor.', 'in');
      });
  }

  panel.querySelector('#ahw-send').onclick = enviar;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') enviar(); });
})();
