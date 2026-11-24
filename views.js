// Plantillas HTML simples (sin dependencias).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

function fmtDate(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ_DISPLAY || 'America/Argentina/Buenos_Aires' });
}

function layout({ title, user, flash, body }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#b3261e">
<title>${esc(title)} · Amigo Invisible</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎁</text></svg>">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">🎁 Amigo Invisible</a>
  ${user ? `<form method="post" action="/salir"><button class="link">Salir</button></form>` : ''}
</header>
<main>
  ${flash ? `<div class="flash ${esc(flash.type)}">${esc(flash.msg)}</div>` : ''}
  ${body}
</main>
</body>
</html>`;
}

function authPage({ mode, values = {}, needsCode, drawDone }) {
  const isReg = mode === 'registro';
  if (isReg && drawDone) {
    return `<section class="card center"><h1>El sorteo ya se hizo</h1><p>Ya no se pueden sumar participantes.</p><a class="btn" href="/entrar">Entrar</a></section>`;
  }
  return `
<section class="card narrow">
  <h1>${isReg ? 'Crear cuenta' : 'Entrar'}</h1>
  <form method="post" action="/${mode}" class="stack">
    ${isReg ? `<label>Nombre<input name="name" required maxlength="60" autocomplete="name" value="${esc(values.name)}"></label>` : ''}
    <label>Email<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(values.email)}"></label>
    <label>Contraseña<input name="password" type="password" required minlength="${isReg ? 6 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>
    ${isReg && needsCode ? `<label>Código del grupo<input name="code" required autocomplete="off" value="${esc(values.code)}"><small>Te lo pasa quien organiza.</small></label>` : ''}
    <button class="btn">${isReg ? 'Registrarme' : 'Entrar'}</button>
  </form>
  <p class="muted">${isReg ? '¿Ya tenés cuenta? <a href="/entrar">Entrá acá</a>' : '¿Primera vez? <a href="/registro">Creá tu cuenta</a>'}</p>
</section>`;
}

function dashboard({ user, participants, drawDone, receiver, sentHints, receivedHints, minPlayers }) {
  const list = participants.map((p) => `<li>${esc(p.name)}${p.is_admin ? ' <span class="tag">organiza</span>' : ''}</li>`).join('');

  if (!drawDone) {
    const canDraw = participants.length >= minPlayers;
    return `
<section class="card">
  <h1>¡Hola, ${esc(user.name)}!</h1>
  <p>Todavía no se hizo el sorteo. Cuando estén registradas todas, ${user.is_admin ? 'apretá el botón de abajo' : 'quien organiza va a hacer el sorteo'} y a cada una le llega un email con su amiga invisible.</p>
</section>
<section class="card">
  <h2>Participantes (${participants.length})</h2>
  <ul class="people">${list}</ul>
  ${user.is_admin ? `
  <form method="post" action="/sorteo" onsubmit="return confirm('¿Están todas registradas? El sorteo no se puede deshacer.')">
    <button class="btn big" ${canDraw ? '' : 'disabled'}>🎲 Hacer el sorteo</button>
  </form>
  ${canDraw ? '' : `<p class="muted">Hacen falta al menos ${minPlayers} participantes.</p>`}` : ''}
</section>`;
  }

  const sent = sentHints.length
    ? sentHints.map((h) => `<li><p>${nl2br(h.text)}</p><time>${fmtDate(h.created_at)}</time></li>`).join('')
    : '<li class="muted">Todavía no mandaste pistas.</li>';
  const received = receivedHints.length
    ? receivedHints.map((h) => `<li><p>${nl2br(h.text)}</p><time>${fmtDate(h.created_at)}</time></li>`).join('')
    : '<li class="muted">Todavía no te llegaron pistas.</li>';

  return `
<section class="card reveal">
  <p class="muted">Hola ${esc(user.name)}, te toca regalarle a</p>
  <p class="who">🎁 ${esc(receiver.name)}</p>
</section>
<section class="card">
  <h2>Mandale una pista anónima</h2>
  <p class="muted">${esc(receiver.name)} la recibe por email y en su panel, sin saber que sos vos.</p>
  <form method="post" action="/pistas" class="stack">
    <textarea name="text" required maxlength="500" rows="3" placeholder="Ej: Tu regalo es algo que vas a usar en verano ☀️"></textarea>
    <button class="btn">Enviar pista</button>
  </form>
  <h3>Pistas que mandaste</h3>
  <ul class="hints">${sent}</ul>
</section>
<section class="card">
  <h2>Pistas que te llegaron 🕵️</h2>
  <ul class="hints">${received}</ul>
</section>
<section class="card">
  <h2>Participantes</h2>
  <ul class="people">${list}</ul>
  ${user.is_admin ? `<form method="post" action="/reenviar" onsubmit="return confirm('¿Reenviar a todas el email con su amiga invisible?')"><button class="link" style="margin-top:12px">✉️ Reenviar emails del sorteo</button></form>` : ''}
</section>`;
}

module.exports = { layout, authPage, dashboard, esc };
