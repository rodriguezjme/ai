// Envío de emails por SMTP (Gmail, Resend, Brevo...). Sin configurar, los muestra en consola.
const nodemailer = require('nodemailer');

const configured = !!process.env.SMTP_HOST;
const transporter = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Amigo Invisible <no-reply@example.com>';

async function sendMail({ to, subject, text, html }) {
  if (!configured) {
    console.log(`\n--- EMAIL (modo prueba, SMTP sin configurar) ---\nPara: ${to}\nAsunto: ${subject}\n${text}\n------------------------------------------------\n`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, text, html });
}

module.exports = { sendMail, mailConfigured: configured };
