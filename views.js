// Plantillas HTML simples (sin dependencias).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

function fmtDate(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ_DISPLAY || 'America/Argentina/Buenos_Aires' });
}

function layout({ title, flash, body, brand = { href: '/', label: 'Amigo Invisible' }, logout = null }) {
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
  <a class="brand" href="${esc(brand.href)}">🎁 ${esc(brand.label)}</a>
  ${logout ? `<form method="post" action="${esc(logout)}"><button class="link">Salir</button></form>` : ''}
</header>
<main>
  ${flash ? `<div class="flash ${esc(flash.type)}">${esc(flash.msg)}</div>` : ''}
  ${body}
</main>
</body>
</html>`;
}

function home() {
  return `
<section class="card center">
  <h1>🎁 Amigo Invisible</h1>
  <p>Para jugar, entrá con el link que te pasaron para tu grupo.</p>
  <p class="muted"><a href="/admin">Soy administrador</a></p>
</section>`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Juego ----------
function gameAuth({ game, mode, values = {}, count, drawn }) {
  const base = `/${game.slug}`;
  const isReg = mode === 'registro';
  const full = count >= game.max_players;
  if (isReg && (drawn || full)) {
    return `<section class="card center"><h1>${drawn ? 'El sorteo ya se hizo' : 'El grupo está completo'}</h1><p>Ya no se pueden sumar participantes a <b>${esc(game.name)}</b>.</p><a class="btn" href="${base}/entrar">Entrar</a></section>`;
  }
  return `
<section class="card narrow">
  <p class="muted eyebrow">${esc(game.name)}</p>
  <h1>${isReg ? 'Crear cuenta' : 'Entrar'}</h1>
  ${isReg ? `<p class="muted">Van ${count} de ${game.max_players} participantes. Cuando se complete el grupo se hace el sorteo y a cada una le llega un email.</p>` : ''}
  <form method="post" action="${base}/${mode}" class="stack">
    ${isReg ? `<label>Nombre<input name="name" required maxlength="60" autocomplete="name" value="${esc(values.name)}"></label>` : ''}
    <label>Email<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(values.email)}"></label>
    <label>Contraseña<input name="password" type="password" required minlength="${isReg ? 6 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>
    <button class="btn">${isReg ? 'Registrarme' : 'Entrar'}</button>
  </form>
  <p class="muted">${isReg ? `¿Ya tenés cuenta? <a href="${base}/entrar">Entrá acá</a>` : `¿Primera vez? <a href="${base}/registro">Creá tu cuenta</a>`}</p>
</section>`;
}

function gameDashboard({ game, me, players, drawn, receiver, sent, received }) {
  const list = players.map((p) => `<li>${esc(p.name)}</li>`).join('');
  if (!drawn) {
    const missing = game.max_players - players.length;
    return `
<section class="card">
  <h1>¡Hola, ${esc(me.name)}!</h1>
  <p>Todavía no se hizo el sorteo. ${missing > 0 ? `Faltan <b>${plural(missing, 'participante', 'participantes')}</b>. Cuando se complete el grupo, el sorteo se hace solo y a cada una le llega un email con su amiga invisible.` : 'En breve se hace el sorteo.'}</p>
  <p class="muted">Link para compartir: <a href="/${esc(game.slug)}/registro">${esc(game.url)}/registro</a></p>
</section>
<section class="card">
  <h2>Participantes (${players.length} de ${game.max_players})</h2>
  <ul class="people">${list}</ul>
</section>`;
  }
  const items = (rows, empty) => rows.length
    ? rows.map((h) => `<li><p>${nl2br(h.text)}</p><time>${fmtDate(h.created_at)}</time></li>`).join('')
    : `<li class="muted">${empty}</li>`;
  return `
<section class="card reveal">
  <p class="muted">Hola ${esc(me.name)}, te toca regalarle a</p>
  <p class="who">🎁 ${esc(receiver.name)}</p>
</section>
<section class="card">
  <h2>Mandale una pista anónima</h2>
  <p class="muted">${esc(receiver.name)} la recibe por email y en su panel, sin saber que sos vos.</p>
  <form method="post" action="/${esc(game.slug)}/pistas" class="stack">
    <textarea name="text" required maxlength="500" rows="3" placeholder="Ej: Tu regalo es algo que vas a usar en verano ☀️"></textarea>
    <button class="btn">Enviar pista</button>
  </form>
  <h3>Pistas que mandaste</h3>
  <ul class="hints">${items(sent, 'Todavía no mandaste pistas.')}</ul>
</section>
<section class="card">
  <h2>Pistas que te llegaron 🕵️</h2>
  <ul class="hints">${items(received, 'Todavía no te llegaron pistas.')}</ul>
</section>
<section class="card">
  <h2>Participantes</h2>
  <ul class="people">${list}</ul>
</section>`;
}

// ---------- Administrador ----------
function adminLogin({ configured }) {
  if (!configured) {
    return `<section class="card narrow"><h1>Administrador</h1><p>Para activar el panel, cargá la variable <code>ADMIN_PASSWORD</code> en Render (Environment) y volvé a entrar.</p></section>`;
  }
  return `
<section class="card narrow">
  <h1>Administrador</h1>
  <form method="post" action="/admin/entrar" class="stack">
    <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn">Entrar</button>
  </form>
</section>`;
}

function adminPanel({ games, values = {} }) {
  const rows = games.map((g) => {
    const status = g.drawn ? '✅ Sorteo hecho' : g.count >= g.max_players ? '⏳ Completo' : `📝 ${g.count} de ${g.max_players} registradas`;
    return `
<li class="game">
  <div class="game-head">
    <div><b>${esc(g.name)}</b><br><a href="/${esc(g.slug)}">${esc(g.url)}</a></div>
    <span class="tag">${status}</span>
  </div>
  <p class="muted small">Invitación a ${esc(g.invite_email)} · ${plural(g.max_players, 'jugadora', 'jugadoras')}${g.players.length ? ` · ${g.players.map((p) => esc(p.name)).join(', ')}` : ''}</p>
  <div class="actions">
    <form method="post" action="/admin/juegos/${g.id}/invitar"><button class="chip">✉️ Reenviar invitación</button></form>
    ${!g.drawn && g.count >= 3 ? `<form method="post" action="/admin/juegos/${g.id}/sortear" onsubmit="return confirm('¿Sortear ahora con las ${g.count} registradas? No se puede deshacer.')"><button class="chip">🎲 Sortear ahora</button></form>` : ''}
    ${g.drawn ? `<form method="post" action="/admin/juegos/${g.id}/reenviar" onsubmit="return confirm('¿Reenviar a todas el email con su amiga invisible?')"><button class="chip">✉️ Reenviar sorteo</button></form>` : ''}
    <form method="post" action="/admin/juegos/${g.id}/borrar" onsubmit="return confirm('¿Borrar el juego ${esc(g.name).replace(/'/g, '')} con todas sus jugadoras y pistas? No se puede deshacer.')"><button class="chip danger">🗑️ Borrar</button></form>
  </div>
</li>`;
  }).join('');
  return `
<section class="card">
  <h1>Nuevo juego</h1>
  <form method="post" action="/admin/juegos" class="stack">
    <label>Nombre del juego<input name="name" required maxlength="60" placeholder="Ej: Navidad Amigas 2026" value="${esc(values.name)}"><small>Define la dirección: se convierte en algo como /navidad-amigas-2026</small></label>
    <label>Email para la invitación<input name="invite_email" type="email" required inputmode="email" value="${esc(values.invite_email)}"><small>Le llega el link del juego para que lo comparta con el grupo.</small></label>
    <label>Cantidad de jugadoras<input name="max_players" type="number" min="3" max="100" required value="${esc(values.max_players || 4)}"><small>Cuando se registran todas, el sorteo se hace solo.</small></label>
    <button class="btn">Crear juego y enviar invitación</button>
  </form>
</section>
<section class="card">
  <h2>Juegos (${games.length})</h2>
  ${games.length ? `<ul class="games">${rows}</ul>` : '<p class="muted">Todavía no hay juegos.</p>'}
</section>`;
}

module.exports = { layout, home, gameAuth, gameDashboard, adminLogin, adminPanel, esc };
