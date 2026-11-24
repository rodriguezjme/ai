require('./env');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { db, init, one, all, run } = require('./db');
const { sendMail } = require('./mail');
const views = require('./views');

const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MIN_PLAYERS = 3;
const RESERVED = new Set(['admin', 'api', 'static', 'style', 'favicon', 'robots', 'entrar', 'registro', 'salir']);

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('Falta SESSION_SECRET'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.use(cookieSession({
  name: 'ai_sess',
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiar',
  maxAge: 1000 * 60 * 60 * 24 * 60, // 60 días
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));

// ---------- Helpers ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const render = (req, res, opts) => { const f = req.session.flash; delete req.session.flash; res.send(views.layout({ ...opts, flash: f })); };
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const gameUrl = (g) => `${SITE_URL}/${g.slug}`;

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function loadGame(slug) {
  const g = await one('SELECT * FROM games WHERE slug = ?', [String(slug).toLowerCase()]);
  if (g) g.url = gameUrl(g);
  return g;
}
const countPlayers = async (gameId) => Number((await one('SELECT COUNT(*) AS n FROM players WHERE game_id = ?', [gameId])).n);
const isDrawn = async (gameId) => !!(await one('SELECT 1 FROM matches WHERE game_id = ? LIMIT 1', [gameId]));

async function sendAll(messages) {
  const results = await Promise.allSettled(messages.map(sendMail));
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.error('Error enviando email:', r.reason));
  return failed.length;
}

function inviteEmail(game) {
  return {
    to: game.invite_email,
    subject: `🎁 Te invitaron al amigo invisible "${game.name}"`,
    text: `¡Hola!\n\nSe creó el amigo invisible "${game.name}" para ${game.max_players} participantes.\n\nCompartí este link con el grupo para que cada una se registre:\n${game.url}/registro\n\nCuando se registren las ${game.max_players}, el sorteo se hace solo y a cada una le llega un email con su amiga invisible.`,
    html: `<p>¡Hola!</p><p>Se creó el amigo invisible <b>${views.esc(game.name)}</b> para ${game.max_players} participantes.</p><p>Compartí este link con el grupo para que cada una se registre:</p><p style="font-size:18px"><a href="${game.url}/registro">${game.url}/registro</a></p><p>Cuando se registren las ${game.max_players}, el sorteo se hace solo y a cada una le llega un email con su amiga invisible.</p>`,
  };
}

function assignmentEmail(game, giver, receiver) {
  return {
    to: giver.email,
    subject: `🎁 Tu amiga invisible en "${game.name}"`,
    text: `Hola ${giver.name}!\n\nYa se hizo el sorteo de "${game.name}". Te toca regalarle a: ${receiver.name}\n\nEntrá a ${game.url} para verlo cuando quieras y mandarle pistas anónimas.\n\n¡Shh, es secreto!`,
    html: `<p>Hola ${views.esc(giver.name)}!</p><p>Ya se hizo el sorteo de <b>${views.esc(game.name)}</b>. Te toca regalarle a:</p><p style="font-size:24px;font-weight:bold;color:#b3261e">🎁 ${views.esc(receiver.name)}</p><p>Entrá a <a href="${game.url}">${game.url}</a> para verlo cuando quieras y mandarle pistas anónimas.</p><p>¡Shh, es secreto!</p>`,
  };
}

// Sorteo: una ronda al azar, cada una le regala a la siguiente (nadie se toca a sí misma ni hay parejas cruzadas).
// Devuelve null si no se pudo, o la cantidad de emails que fallaron.
async function drawGame(game) {
  if (await isDrawn(game.id)) return null;
  const people = await all('SELECT id, name, email FROM players WHERE game_id = ?', [game.id]);
  if (people.length < MIN_PLAYERS) return null;
  const order = shuffle(people);
  const pairs = order.map((giver, i) => ({ giver, receiver: order[(i + 1) % order.length] }));
  try {
    await db.batch(pairs.map((p) => ({ sql: 'INSERT INTO matches (game_id, giver_id, receiver_id) VALUES (?, ?, ?)', args: [game.id, p.giver.id, p.receiver.id] })), 'write');
  } catch (e) {
    return null; // otro pedido ya hizo el sorteo
  }
  return sendAll(pairs.map((p) => assignmentEmail(game, p.giver, p.receiver)));
}

async function resendAssignments(game) {
  const rows = await all(`SELECT g.name AS gname, g.email AS gemail, r.name AS rname FROM matches m
    JOIN players g ON g.id = m.giver_id JOIN players r ON r.id = m.receiver_id WHERE m.game_id = ?`, [game.id]);
  return sendAll(rows.map((x) => assignmentEmail(game, { name: x.gname, email: x.gemail }, { name: x.rname })));
}

// ---------- Inicio ----------
app.get('/', (req, res) => render(req, res, { title: 'Inicio', body: views.home() }));

// ---------- Administrador ----------
const adminOnly = (fn) => wrap(async (req, res, next) => {
  if (!ADMIN_PASSWORD || !req.session.admin) return res.redirect('/admin/entrar');
  return fn(req, res, next);
});
const adminRender = (req, res, body) => render(req, res, { title: 'Administrador', body, brand: { href: '/admin', label: 'Administrador' }, logout: '/admin/salir' });

async function adminGames() {
  const games = await all(`SELECT g.*, (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS count,
    EXISTS(SELECT 1 FROM matches m WHERE m.game_id = g.id) AS drawn FROM games g ORDER BY g.id DESC`);
  const players = await all('SELECT game_id, name FROM players ORDER BY id');
  return games.map((g) => ({ ...g, count: Number(g.count), drawn: !!Number(g.drawn), url: gameUrl(g), players: players.filter((p) => p.game_id === g.id) }));
}

app.get('/admin/entrar', (req, res) => {
  if (ADMIN_PASSWORD && req.session.admin) return res.redirect('/admin');
  render(req, res, { title: 'Administrador', body: views.adminLogin({ configured: !!ADMIN_PASSWORD }) });
});

app.post('/admin/entrar', (req, res) => {
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (ADMIN_PASSWORD && crypto.timingSafeEqual(a, b)) { req.session.admin = true; return res.redirect('/admin'); }
  flash(req, 'error', 'Contraseña incorrecta.');
  res.redirect('/admin/entrar');
});

app.post('/admin/salir', (req, res) => { req.session.admin = null; res.redirect('/admin/entrar'); });

app.get('/admin', adminOnly(async (req, res) => adminRender(req, res, views.adminPanel({ games: await adminGames() }))));

app.post('/admin/juegos', adminOnly(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const invite = String(req.body.invite_email || '').trim().toLowerCase();
  const max = Number(req.body.max_players);
  const slug = slugify(name);
  const again = (msg) => { flash(req, 'error', msg); return adminGames().then((games) => adminRender(req, res, views.adminPanel({ games, values: req.body }))); };

  if (!name || !slug) return again('Poné un nombre para el juego (con letras o números).');
  if (RESERVED.has(slug)) return again('Ese nombre está reservado, probá con otro.');
  if (!isEmail(invite)) return again('El email de la invitación no es válido.');
  if (!Number.isInteger(max) || max < MIN_PLAYERS || max > 100) return again(`La cantidad de jugadoras tiene que ser entre ${MIN_PLAYERS} y 100.`);
  if (await one('SELECT 1 FROM games WHERE slug = ?', [slug])) return again(`Ya existe un juego con la dirección /${slug}. Elegí otro nombre.`);

  await run('INSERT INTO games (slug, name, invite_email, max_players) VALUES (?, ?, ?, ?)', [slug, name, invite, max]);
  const game = await loadGame(slug);
  const failed = await sendAll([inviteEmail(game)]);
  flash(req, failed ? 'error' : 'ok', failed ? `Juego creado en ${game.url}, pero no se pudo enviar la invitación.` : `Juego creado en ${game.url}. Invitación enviada a ${invite} ✉️`);
  res.redirect('/admin');
}));

async function adminGameAction(req, res, action) {
  const game = await one('SELECT * FROM games WHERE id = ?', [Number(req.params.id)]);
  if (!game) { flash(req, 'error', 'Ese juego no existe.'); return res.redirect('/admin'); }
  game.url = gameUrl(game);
  await action(game);
  res.redirect('/admin');
}

app.post('/admin/juegos/:id/invitar', adminOnly((req, res) => adminGameAction(req, res, async (game) => {
  const failed = await sendAll([inviteEmail(game)]);
  flash(req, failed ? 'error' : 'ok', failed ? 'No se pudo enviar la invitación.' : `Invitación reenviada a ${game.invite_email}`);
})));

app.post('/admin/juegos/:id/sortear', adminOnly((req, res) => adminGameAction(req, res, async (game) => {
  const failed = await drawGame(game);
  if (failed === null) return flash(req, 'error', `No se pudo sortear "${game.name}": ya estaba hecho o hay menos de ${MIN_PLAYERS} jugadoras.`);
  flash(req, failed ? 'error' : 'ok', failed ? `Sorteo hecho, pero fallaron ${failed} email(s).` : `Sorteo de "${game.name}" hecho y emails enviados 🎲`);
})));

app.post('/admin/juegos/:id/reenviar', adminOnly((req, res) => adminGameAction(req, res, async (game) => {
  const failed = await resendAssignments(game);
  flash(req, failed ? 'error' : 'ok', failed ? `Fallaron ${failed} email(s). Revisá los logs.` : `Emails del sorteo de "${game.name}" reenviados ✉️`);
})));

app.post('/admin/juegos/:id/borrar', adminOnly((req, res) => adminGameAction(req, res, async (game) => {
  await db.batch([
    { sql: 'DELETE FROM clues WHERE game_id = ?', args: [game.id] },
    { sql: 'DELETE FROM matches WHERE game_id = ?', args: [game.id] },
    { sql: 'DELETE FROM players WHERE game_id = ?', args: [game.id] },
    { sql: 'DELETE FROM games WHERE id = ?', args: [game.id] },
  ], 'write');
  flash(req, 'ok', `Juego "${game.name}" borrado.`);
})));

// ---------- Juegos (cada uno en /su-nombre) ----------
const slugRe = '/:slug';

// Carga el juego de la URL y la jugadora con sesión en ese juego (si hay)
const withGame = (fn) => wrap(async (req, res, next) => {
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/i.test(req.params.slug)) return next();
  const game = await loadGame(req.params.slug);
  if (!game) return next();
  req.game = game;
  const pid = (req.session.p || {})[game.slug];
  req.me = pid ? await one('SELECT id, name, email FROM players WHERE id = ? AND game_id = ?', [pid, game.id]) : null;
  return fn(req, res, next);
});
const gameRender = (req, res, title, body) => render(req, res, { title: `${title} · ${req.game.name}`, body, brand: { href: `/${req.game.slug}`, label: req.game.name }, logout: req.me ? `/${req.game.slug}/salir` : null });
const login = (req, game, id) => { req.session.p = { ...(req.session.p || {}), [game.slug]: Number(id) }; };

app.get(slugRe, withGame(async (req, res) => {
  const { game, me } = req;
  if (!me) return res.redirect(`/${game.slug}/${(await isDrawn(game.id)) ? 'entrar' : 'registro'}`);
  const players = await all('SELECT id, name FROM players WHERE game_id = ? ORDER BY id', [game.id]);
  const receiver = await one('SELECT p.name FROM matches m JOIN players p ON p.id = m.receiver_id WHERE m.giver_id = ?', [me.id]);
  const drawn = await isDrawn(game.id);
  if (drawn && !receiver) return gameRender(req, res, 'Inicio', `<section class="card"><h1>Hola ${views.esc(me.name)}</h1><p>El sorteo se hizo antes de que te registraras, así que no tenés asignación.</p></section>`);
  const sent = drawn ? await all('SELECT text, created_at FROM clues WHERE from_id = ? ORDER BY id DESC', [me.id]) : [];
  const received = drawn ? await all('SELECT text, created_at FROM clues WHERE to_id = ? ORDER BY id DESC', [me.id]) : [];
  gameRender(req, res, 'Inicio', views.gameDashboard({ game, me, players, drawn, receiver, sent, received }));
}));

app.get(`${slugRe}/registro`, withGame(async (req, res) => {
  if (req.me) return res.redirect(`/${req.game.slug}`);
  gameRender(req, res, 'Crear cuenta', views.gameAuth({ game: req.game, mode: 'registro', count: await countPlayers(req.game.id), drawn: await isDrawn(req.game.id) }));
}));

app.post(`${slugRe}/registro`, withGame(async (req, res) => {
  const { game } = req;
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const count = await countPlayers(game.id);
  const drawn = await isDrawn(game.id);
  const again = (msg) => { flash(req, 'error', msg); gameRender(req, res, 'Crear cuenta', views.gameAuth({ game, mode: 'registro', values: { name, email }, count, drawn })); };

  if (drawn || count >= game.max_players) return again('El grupo ya está completo.');
  if (!name || !isEmail(email)) return again('Revisá el nombre y el email.');
  if (password.length < 6) return again('La contraseña tiene que tener al menos 6 caracteres.');
  if (await one('SELECT 1 FROM players WHERE game_id = ? AND email = ?', [game.id, email])) return again('Ya hay una cuenta con ese email en este juego. Probá entrar.');

  // Inserta solo si todavía hay lugar (evita pasarse del límite si se registran dos a la vez)
  const r = await run(`INSERT INTO players (game_id, name, email, password_hash)
    SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM players WHERE game_id = ?) < ?`,
    [game.id, name, email, await bcrypt.hash(password, 10), game.id, game.max_players]);
  if (!r.rowsAffected) return again('El grupo se completó recién.');
  login(req, game, r.lastInsertRowid);

  if (count + 1 >= game.max_players) {
    const failed = await drawGame(game);
    flash(req, 'ok', failed ? `¡Listo, ${name}! Eras la última: ya se hizo el sorteo (algunos emails fallaron, pero acá ves el tuyo).` : `¡Listo, ${name}! Eras la última: ya se hizo el sorteo y a todas les llegó un email 🎲`);
  } else {
    flash(req, 'ok', `¡Listo, ${name}! Ya estás registrada.`);
  }
  res.redirect(`/${game.slug}`);
}));

app.get(`${slugRe}/entrar`, withGame(async (req, res) => {
  if (req.me) return res.redirect(`/${req.game.slug}`);
  gameRender(req, res, 'Entrar', views.gameAuth({ game: req.game, mode: 'entrar' }));
}));

app.post(`${slugRe}/entrar`, withGame(async (req, res) => {
  const { game } = req;
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await one('SELECT id, password_hash FROM players WHERE game_id = ? AND email = ?', [game.id, email]);
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
    flash(req, 'error', 'Email o contraseña incorrectos.');
    return gameRender(req, res, 'Entrar', views.gameAuth({ game, mode: 'entrar', values: { email } }));
  }
  login(req, game, u.id);
  res.redirect(`/${game.slug}`);
}));

app.post(`${slugRe}/salir`, withGame(async (req, res) => {
  const p = { ...(req.session.p || {}) }; delete p[req.game.slug]; req.session.p = p;
  res.redirect(`/${req.game.slug}/entrar`);
}));

app.post(`${slugRe}/pistas`, withGame(async (req, res) => {
  const { game, me } = req;
  if (!me) return res.redirect(`/${game.slug}/entrar`);
  const text = String(req.body.text || '').trim().slice(0, 500);
  const a = await one('SELECT m.receiver_id, p.name, p.email FROM matches m JOIN players p ON p.id = m.receiver_id WHERE m.giver_id = ?', [me.id]);
  if (!a) { flash(req, 'error', 'Todavía no se hizo el sorteo.'); return res.redirect(`/${game.slug}`); }
  if (!text) { flash(req, 'error', 'Escribí una pista.'); return res.redirect(`/${game.slug}`); }
  await run('INSERT INTO clues (game_id, from_id, to_id, text) VALUES (?, ?, ?, ?)', [game.id, me.id, a.receiver_id, text]);
  const failed = await sendAll([{
    to: a.email,
    subject: `🕵️ Pista nueva de tu amigo invisible (${game.name})`,
    text: `Hola ${a.name}!\n\nTu amigo invisible te mandó una pista:\n\n"${text}"\n\nMirá todas tus pistas en ${game.url}`,
    html: `<p>Hola ${views.esc(a.name)}!</p><p>Tu amigo invisible te mandó una pista:</p><blockquote style="font-size:18px;border-left:4px solid #b3261e;padding-left:12px">${views.esc(text).replace(/\n/g, '<br>')}</blockquote><p>Mirá todas tus pistas en <a href="${game.url}">${game.url}</a></p>`,
  }]);
  flash(req, 'ok', failed ? `Pista guardada. ${a.name} la va a ver al entrar (el email no se pudo enviar).` : `Pista enviada a ${a.name} 🤫`);
  res.redirect(`/${game.slug}`);
}));

app.use((req, res) => res.status(404).send(views.layout({ title: 'No encontrado', body: '<section class="card center"><h1>No encontramos ese juego</h1><p>Revisá el link que te pasaron.</p></section>' })));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(views.layout({ title: 'Error', body: '<section class="card"><h1>Uy, algo falló</h1><p>Probá de nuevo en un rato.</p><a class="btn" href="/">Volver</a></section>' }));
});

init().then(() => app.listen(PORT, () => console.log(`Amigo Invisible en ${SITE_URL}`)));
