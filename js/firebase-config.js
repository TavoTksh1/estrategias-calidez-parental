/* Configuración web de Firebase. Estos valores son públicos por diseño: la seguridad la dan las
   reglas de Firestore (firestore.rules), no el secreto de esta configuración. */
export const firebaseConfig = {
  apiKey: 'AIzaSyBHDWVqPGdwtuPFB7IvMMPZFtvibNhYX1A',
  authDomain: 'calidez-parental-unbosque.firebaseapp.com',
  projectId: 'calidez-parental-unbosque',
  appId: '1:22614699340:web:fcba3bba7d46ca50a8f3e9',
};

/* Correos con permisos de administración. Deben coincidir con la lista de firestore.rules.
   El correo debe estar verificado para que las reglas lo reconozcan como administrador. */
export const ADMIN_EMAILS = ['tavo.tkshi@gmail.com'];