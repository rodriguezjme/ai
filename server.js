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
const GROUP_CODE = process.env.GROUP_CODE || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const MIN_PLAYERS = 3;

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

// Helpers
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const takeFlash = (req) => { const f = req.session.flash; delete req.session.flash; return f; };
const drawDone = async () => !!(await one('SELECT 1 FROM assignments LIMIT 1'));
const currentUser = async (req) => req.session.uid ? one('SELECT id, name, email, is_admin FROM users WHERE id = ?', [req.session.uid]) : null;
const render = (req, res, { title, user, body }) => res.send(views.layout({ title, user, flash: takeFlash(req), body }));

function requireUser(handler) {
  return async (req, res, next) => {
    try {
      const user = await currentUser(req);
      if (!user) { req.session.uid = null; return res.redirect('/entrar'); }
      req.user = user;
      await handler(req, res, next);
    } catch (e) { next(e); }
  };
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Mezcla Fisher–Yates con aleatoriedad criptográfica
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Rutas ----------
app.get('/', requireUser(async (req, res) => {
  const participants = await all('SELECT id, name, is_admin FROM users ORDER BY created_at, id');
  const done = await drawDone();
  let receiver = null, sentHints = [], receivedHints = [];
  if (done) {
    receiver = await one('SELECT u.id, u.name FROM assignments a JOIN users u ON u.id = a.receiver_id WHERE a.giver_id = ?', [req.user.id]);
    sentHints = await all('SELECT text, created_at FROM hints WHERE from_id = ? ORDER BY id DESC', [req.user.id]);
    receivedHints = await all('SELECT text, created_at FROM hints WHERE to_id = ? ORDER BY id DESC', [req.user.id]);
  }
  // Alguien registrada después del sorteo no tiene asignación (no debería pasar: el registro se cierra)
  if (done && !receiver) {
    return render(req, res, { title: 'Inicio', user: req.user, body: `<section class="card"><h1>Hola ${views.esc(req.user.name)}</h1><p>El sorteo se hizo antes de que te registraras, así que no tenés asignación.</p></section>` });
  }
  render(req, res, { title: 'Inicio', user: req.user, body: views.dashboard({ user: req.user, participants, drawDone: done, receiver, sentHints, receivedHints, minPlayers: MIN_PLAYERS }) });
}));

app.get('/registro', wrap(async (req, res) => {
  if (req.session.uid) return res.redirect('/');
  render(req, res, { title: 'Crear cuenta', body: views.authPage({ mode: 'registro', needsCode: !!GROUP_CODE, drawDone: await drawDone() }) });
}));

app.post('/registro', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const code = String(req.body.code || '').trim();
  const again = (msg) => {
    flash(req, 'error', msg);
    render(req, res, { title: 'Crear cuenta', body: views.authPage({ mode: 'registro', values: { name, email, code }, needsCode: !!GROUP_CODE }) });
  };

  if (await drawDone()) return again('El sorteo ya se hizo, no se pueden sumar participantes.');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return again('Revisá el nombre y el email.');
  if (password.length < 6) return again('La contraseña tiene que tener al menos 6 caracteres.');
  if (GROUP_CODE && code !== GROUP_CODE) return again('El código del grupo no es correcto.');
  if (await one('SELECT 1 FROM users WHERE email = ?', [email])) return again('Ya hay una cuenta con ese email. Probá entrar.');

  const hash = await bcrypt.hash(password, 10);
  const count = (await one('SELECT COUNT(*) AS n FROM users')).n;
  const isAdmin = ADMIN_EMAIL ? email === ADMIN_EMAIL : Number(count) === 0; // la primera en registrarse organiza
  const r = await run('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)', [name, email, hash, isAdmin ? 1 : 0]);
  req.session.uid = Number(r.lastInsertRowid);
  flash(req, 'ok', `¡Listo, ${name}! Ya estás registrada.`);
  res.redirect('/');
}));

app.get('/entrar', wrap(async (req, res) => {
  if (req.session.uid) return res.redirect('/');
  render(req, res, { title: 'Entrar', body: views.authPage({ mode: 'entrar' }) });
}));

app.post('/entrar', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const u = await one('SELECT id, password_hash FROM users WHERE email = ?', [email]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    flash(req, 'error', 'Email o contraseña incorrectos.');
    return render(req, res, { title: 'Entrar', body: views.authPage({ mode: 'entrar', values: { email } }) });
  }
  req.session.uid = Number(u.id);
  res.redirect('/');
}));

app.post('/salir', (req, res) => { req.session = null; res.redirect('/entrar'); });

app.post('/sorteo', requireUser(async (req, res) => {
  if (!req.user.is_admin) { flash(req, 'error', 'Solo quien organiza puede hacer el sorteo.'); return res.redirect('/'); }
  if (await drawDone()) { flash(req, 'error', 'El sorteo ya estaba hecho.'); return res.redirect('/'); }
  const people = await all('SELECT id, name, email FROM users');
  if (people.length < MIN_PLAYERS) { flash(req, 'error', `Hacen falta al menos ${MIN_PLAYERS} participantes.`); return res.redirect('/'); }

  // Ronda única: cada una le regala a la siguiente. Nadie se toca a sí misma ni hay parejas cruzadas.
  const order = shuffle(people);
  const pairs = order.map((giver, i) => ({ giver, receiver: order[(i + 1) % order.length] }));
  try {
    await db.batch(pairs.map((p) => ({ sql: 'INSERT INTO assignments (giver_id, receiver_id) VALUES (?, ?)', args: [p.giver.id, p.receiver.id] })), 'write');
  } catch (e) {
    flash(req, 'error', 'El sorteo ya se estaba haciendo. Recargá la página.');
    return res.redirect('/');
  }

  const results = await Promise.allSettled(pairs.map(({ giver, receiver }) => sendMail({
    to: giver.email,
    subject: '🎁 Tu amiga invisible',
    text: `Hola ${giver.name}!\n\nYa se hizo el sorteo del amigo invisible. Te toca regalarle a: ${receiver.name}\n\nEntrá a ${SITE_URL} para verlo cuando quieras y mandarle pistas anónimas.\n\n¡Shh, es secreto!`,
    html: `<p>Hola ${views.esc(giver.name)}!</p><p>Ya se hizo el sorteo del amigo invisible. Te toca regalarle a:</p><p style="font-size:24px;font-weight:bold;color:#b3261e">🎁 ${views.esc(receiver.name)}</p><p>Entrá a <a href="${SITE_URL}">${SITE_URL}</a> para verlo cuando quieras y mandarle pistas anónimas.</p><p>¡Shh, es secreto!</p>`,
  })));
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.error('Error enviando email:', r.reason));
  flash(req, failed.length ? 'error' : 'ok', failed.length
    ? `Sorteo hecho, pero ${failed.length} email(s) no se pudieron enviar. Igual cada una puede ver su asignación entrando al sitio.`
    : '¡Sorteo hecho! A cada una le llegó un email con su amiga invisible.');
  res.redirect('/');
}));

app.post('/pistas', requireUser(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  const a = await one('SELECT a.receiver_id, u.name, u.email FROM assignments a JOIN users u ON u.id = a.receiver_id WHERE a.giver_id = ?', [req.user.id]);
  if (!a) { flash(req, 'error', 'Todavía no se hizo el sorteo.'); return res.redirect('/'); }
  if (!text) { flash(req, 'error', 'Escribí una pista.'); return res.redirect('/'); }

  await run('INSERT INTO hints (from_id, to_id, text) VALUES (?, ?, ?)', [req.user.id, a.receiver_id, text]);
  try {
    await sendMail({
      to: a.email,
      subject: '🕵️ Tenés una pista nueva de tu amigo invisible',
      text: `Hola ${a.name}!\n\nTu amigo invisible te mandó una pista:\n\n"${text}"\n\nMirá todas tus pistas en ${SITE_URL}`,
      html: `<p>Hola ${views.esc(a.name)}!</p><p>Tu amigo invisible te mandó una pista:</p><blockquote style="font-size:18px;border-left:4px solid #b3261e;padding-left:12px">${views.esc(text).replace(/\n/g, '<br>')}</blockquote><p>Mirá todas tus pistas en <a href="${SITE_URL}">${SITE_URL}</a></p>`,
    });
    flash(req, 'ok', `Pista enviada a ${a.name} 🤫`);
  } catch (e) {
    console.error('Error enviando pista:', e);
    flash(req, 'ok', `Pista guardada. ${a.name} la va a ver al entrar (el email no se pudo enviar).`);
  }
  res.redirect('/');
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(views.layout({ title: 'Error', body: '<section class="card"><h1>Uy, algo falló</h1><p>Probá de nuevo en un rato.</p><a class="btn" href="/">Volver</a></section>' }));
});

init().then(() => app.listen(PORT, () => console.log(`Amigo Invisible en ${SITE_URL}`)));
