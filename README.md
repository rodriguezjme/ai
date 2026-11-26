# 🎁 Amigo Invisible

Sitio web (pensado para usar desde el celular) para que un grupo de amigas juegue al amigo invisible.

## Cómo funciona

1. El **administrador** entra a `/admin` con la contraseña `ADMIN_PASSWORD` y crea un juego con: **nombre**, **email para la invitación** y **cantidad de jugadoras**.
2. El nombre define la dirección del juego: "Navidad Amigas 2026" → `/navidad-amigas-2026`. Al email le llega una invitación con ese link para compartirlo con el grupo.
3. Cada participante se registra en ese link con **nombre, email y contraseña**. Cada juego es independiente: jugadoras, sorteo y pistas no se mezclan, y la misma persona puede estar en varios juegos.
4. Cuando se registra la última, **el sorteo se hace solo**: una ronda al azar donde cada una le regala a la siguiente (nadie se toca a sí misma, no hay parejas cruzadas). A cada una le llega un **email** con su asignación.
5. Cada una entra a su juego, ve **a quién le regala** y le manda **pistas anónimas**, que le llegan por email y aparecen en su panel.

Desde el panel, el administrador ve el estado de cada juego y puede reenviar la invitación, sortear antes de que se complete (con al menos 3), reenviar los emails del sorteo o borrar el juego.

Si la base tenía el juego de la primera versión, se migra solo a `/primer-juego` con sus jugadoras, sorteo y pistas.

## Web promocional y pedidos de juego

La portada (`/`) es la web promocional (`public/index.html`). Tiene un formulario de inicio de juego: descripción, cantidad de participantes y email del organizador. Al enviarlo, la app manda los datos por email al correo de `CONTACT_EMAIL` (el correo no aparece en la web; responder ese email le contesta directo al organizador). Con esos datos creás el juego en `/admin` usando el email del organizador para la invitación.

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
3. **Render**: New → Web Service → conectá el repo. Build command: `npm install`. Start command: `npm start`. En *Environment* cargá: `NODE_ENV=production`, `SESSION_SECRET` (una frase larga al azar), `SITE_URL` (la URL que te da Render), `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `BREVO_API_KEY`, `MAIL_FROM` (ej. `Amigo Invisible <tu email verificado en Brevo>`), `ADMIN_PASSWORD` (la contraseña del panel de administrador) y `CONTACT_EMAIL` (el correo donde llegan los pedidos del formulario de la portada).
4. Entrá a `/admin`, creá el juego y listo.

Nota: en el plan gratis de Render el sitio "se duerme" si nadie lo usa por 15 minutos; la primera visita después tarda unos 30–50 segundos en cargar. Los datos no se pierden porque están en Turso.

Por qué Brevo y no Gmail: el plan gratis de Render bloquea el envío por SMTP, así que los emails se mandan por la API HTTP de Brevo. En otro hosting también funciona SMTP (variables `SMTP_*`).

## Variables de entorno

Ver `.env.example`.
