// Secciones de la cuenta, repartidas en dos páginas (v3.11):
//   /perfil         → Información básica · Privacidad y seguridad      (lo que es de la PERSONA)
//   /configuracion  → Voz de la IA · Estética · Cuentas vinculadas · Notificaciones   (cómo se comporta la APP)
// Las usan el menú del engranaje y las pestañas de las dos páginas. Cada sección es un ancla (#voz) de su página.
import { RUTA_CONFIGURACION, RUTA_PERFIL } from '../../../app/rutas.js';

export const SECCIONES_CUENTA = [
    { id: 'informacion', icono: '', texto: 'Información básica', ruta: RUTA_PERFIL },
    { id: 'voz', icono: '', texto: 'Voz de la IA', ruta: RUTA_CONFIGURACION },
    { id: 'estetica', icono: '', texto: 'Estética de la página', ruta: RUTA_CONFIGURACION },
    { id: 'cuentas', icono: '', texto: 'Cuentas vinculadas', ruta: RUTA_CONFIGURACION },
    { id: 'notificaciones', icono: '', texto: 'Notificaciones', ruta: RUTA_CONFIGURACION },
    { id: 'privacidad', icono: '', texto: 'Privacidad y seguridad', ruta: RUTA_PERFIL }
];

export const seccionesDe = (ruta) => SECCIONES_CUENTA.filter((s) => s.ruta === ruta);

/** Anclas antiguas (v3.1–v3.10) → { ruta, id } nuevos. /configuracion#informacion ahora vive en /perfil */
export const ANCLAS_ANTIGUAS = {
    perfil: 'informacion',
    apariencia: 'estetica',
    general: 'notificaciones'
};

/** Dirección completa de una sección (p. ej. «/configuracion#voz») a partir de un ancla nueva o antigua */
export function direccionDeSeccion(ancla) {
    const id = ANCLAS_ANTIGUAS[ancla] ?? ancla;
    const s = SECCIONES_CUENTA.find((x) => x.id === id);
    return s ? `${s.ruta}#${s.id}` : null;
}
