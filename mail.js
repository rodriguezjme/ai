// Envío de emails.
// 1) Brevo por API HTTP (BREVO_API_KEY): funciona en hostings que bloquean SMTP, como Render gratis.
// 2) SMTP (SMTP_HOST): Gmail, etc.
// 3) Sin configurar: los muestra en consola (modo prueba).
const nodemailer = require('nodemailer');

const BREVO_KEY = process.env.BREVO_API_KEY || '';
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Amigo Invisible <no-reply@example.com>';

function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'Amigo Invisible', email: m[2] } : { name: 'Amigo Invisible', email: String(from).trim() };
}

const smtp = !BREVO_KEY && process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    })
  : null;

async function sendMail({ to, subject, text, html }) {
  if (BREVO_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseFrom(FROM), to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${await res.text()}`);
    return;
  }
  if (smtp) {
    await smtp.sendMail({ from: FROM, to, subject, text, html });
    return;
  }
  console.log(`\n--- EMAIL (modo prueba, email sin configurar) ---\nPara: ${to}\nAsunto: ${subject}\n${text}\n------------------------------------------------\n`);
}

module.exports = { sendMail, mailConfigured: !!(BREVO_KEY || smtp) };

// Al arrancar, avisa en los logs qué método de envío se usa.
console.log(BREVO_KEY ? 'Email: Brevo (API)' : smtp ? `Email: SMTP ${process.env.SMTP_HOST}` : 'Email: modo prueba (consola)');
