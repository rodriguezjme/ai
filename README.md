# 🎁 Amigo Invisible

Sitio web (pensado para usar desde el celular) para que un grupo de amigas juegue al amigo invisible.

## Cómo funciona

1. Cada participante se registra con **nombre, email y contraseña**.
2. La **organizadora** (la primera en registrarse, o el email de `ADMIN_EMAIL`) ve el botón **🎲 Hacer el sorteo** cuando hay al menos 3 participantes.
3. El sorteo arma una ronda al azar: cada una le regala a la siguiente. Nadie se toca a sí misma y no hay parejas cruzadas. A cada una le llega un **email** con su asignación. Después del sorteo se cierra el registro.
4. Cada participante entra con su email y contraseña, ve **a quién le regala** y puede mandarle **pistas anónimas**. La destinataria recibe la pista por email y la ve en su panel, sin saber quién la mandó.

## Tecnología

- **Node.js + Express**, páginas generadas en el servidor (sin frameworks de frontend).
- **Base de datos SQLite** (archivo local) o **Turso** en producción (SQLite en la nube, gratis).
- **Emails por SMTP** (Gmail, Resend, Brevo, etc.) con nodemailer.
- Contraseñas guardadas con hash (bcrypt). Sesión en cookie firmada.

## Probar en tu compu

Necesitás Node.js 18 o superior.

```bash
npm install
cp .env.example .env   # opcional
npm start
```

Abrí http://localhost:3000. Si no configuraste SMTP, los emails aparecen en la consola.

## Publicarlo gratis (recomendado)

Necesitás 4 cuentas gratuitas:

| Para qué | Servicio | Qué sacás de ahí |
|---|---|---|
| Guardar el código | GitHub | Un repositorio con esta carpeta |
| Servir el sitio | Render (Web Service, plan Free) | La URL pública, ej. `https://amigo-invisible.onrender.com` |
| Base de datos | Turso (plan Free) | `DATABASE_URL` y `DATABASE_AUTH_TOKEN` |
| Mandar emails | Brevo (plan Free, 300 emails por día) | `BREVO_API_KEY` |

Pasos:

1. **Turso**: creá una base (`turso db create amigo-invisible`), y copiá la URL (`turso db show amigo-invisible --url`) y un token (`turso db tokens create amigo-invisible`). También se puede hacer desde la web de Turso.
2. **Brevo**: registrate en https://www.brevo.com. En *Senders, Domains & Dedicated IPs → Senders* agregá y verificá tu email (te llega un código). En *SMTP & API → API Keys* creá una clave: esa es tu `BREVO_API_KEY`.
3. **Render**: New → Web Service → conectá el repo. Build command: `npm install`. Start command: `npm start`. En *Environment* cargá: `NODE_ENV=production`, `SESSION_SECRET` (una frase larga al azar), `SITE_URL` (la URL que te da Render), `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `BREVO_API_KEY`, `MAIL_FROM` (ej. `Amigo Invisible <tu email verificado en Brevo>`) y, si querés, `GROUP_CODE`.
4. Pasales el link a tus amigas. La organizadora se registra primero.

Nota: en el plan gratis de Render el sitio "se duerme" si nadie lo usa por 15 minutos; la primera visita después tarda unos 30–50 segundos en cargar. Los datos no se pierden porque están en Turso.

Por qué Brevo y no Gmail: el plan gratis de Render bloquea el envío por SMTP, así que los emails se mandan por la API HTTP de Brevo. En otro hosting también funciona SMTP (variables `SMTP_*`).

Si los emails del sorteo no llegaron, la organizadora tiene un botón **✉️ Reenviar emails del sorteo** en su panel.

## Variables de entorno

Ver `.env.example`.
