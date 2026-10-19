/* Configuración web de Firebase. Estos valores son públicos por diseño: la seguridad la dan las
   reglas de Firestore (firestore.rules), no el secreto de esta configuración. */
export const firebaseConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-calidez.firebaseapp.com',
  projectId: 'demo-calidez',
  appId: 'demo-app',
};

/* Correos con permisos de administración. Deben coincidir con la lista de firestore.rules.
   El correo debe estar verificado para que las reglas lo reconozcan como administrador. */
export const ADMIN_EMAILS = ['tavo.tkshi@gmail.com'];
