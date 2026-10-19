# Estrategias de calidez parental

Plataforma de videos con calificaciones (1-5 estrellas) y comentarios, de la Universidad El Bosque.

**Tecnología:** HTML, CSS y JavaScript sin paso de compilación, con Firebase (Authentication, Firestore y Hosting) en el plan gratuito.

- **Videos por enlace:** YouTube (público o "no listado"), Vimeo o un `.mp4` con https. No se suben archivos porque Cloud Storage requiere el plan de pago.
- **Sin cuenta:** cualquiera puede calificar y comentar. Cada navegador recibe una identidad anónima de Firebase (Authentication anónimo), de modo que hay una calificación por navegador y video. El nombre al comentar es opcional y por defecto es "Anónimo".
- **Administración (con cuenta):** los correos listados en `js/firebase-config.js` y `firestore.rules` (con el correo verificado) pueden publicar videos y moderar comentarios.
- **Seguridad:** toda la lógica de permisos está en `firestore.rules`.

## Desarrollo local

```
npm install -g firebase-tools
firebase emulators:start --project demo-calidez --only auth,firestore,hosting
```

Abrir http://127.0.0.1:5000. En local la página usa los emuladores, nunca el proyecto real.

## Publicar

```
firebase login
firebase deploy --only firestore:rules,hosting
```

La paleta institucional está en `css/style.css`: Roble `#404827`, Acacia `#81bb26`, Eucalipto `#008776`, Naranja `#f08013` y Amarillo `#f2a900`.
