// CAPA DE ACCESO A DATOS (MongoDB con Mongoose). Punto de entrada único: el resto del backend importa
// `import * as db from '../datos/index.js'` y no habla con los modelos directamente.
// Cada colección tiene su archivo: usuarios, sesiones, actividades (+ papelera y diario), bienestar
// (check-ins e historial), propuestas, mensajes y objetivos de estudio (v3.12).
import Usuario from '../modelos/Usuario.js';
import Avatar from '../modelos/Avatar.js';
import Fondo from '../modelos/Fondo.js';
import Sesion from '../modelos/Sesion.js';
import Actividad from '../modelos/Actividad.js';
import Historial from '../modelos/Historial.js';
import Mensaje from '../modelos/Mensaje.js';
import Checkin from '../modelos/Checkin.js';
import Propuesta from '../modelos/Propuesta.js';
import Operacion from '../modelos/Operacion.js';
import Objetivo from '../modelos/Objetivo.js';
import { detectarTransacciones } from './utilidades.js';
import { asegurarTtlPapelera, completarActividadesAntiguasBD, diasPapelera } from './actividades.js';
import { migrarTemaAntiguoBD } from './usuarios.js';

export * from './utilidades.js';
export * from './usuarios.js';
export * from './sesiones.js';
export * from './actividades.js';
export * from './bienestar.js';
export * from './propuestas.js';
export * from './mensajes.js';
export * from './repaso.js';
export * from './verificacion.js';
export * from './estudio.js';

export const modelos = { Usuario, Avatar, Fondo, Sesion, Actividad, Historial, Mensaje, Checkin, Propuesta, Operacion, Objetivo };

/**
 * Se ejecuta al arrancar, antes de atender peticiones: crea los índices (únicos y TTL) para que el control de
 * duplicados funcione, ajusta la caducidad de la papelera, completa actividades antiguas, migra el tema antiguo y
 * detecta transacciones.
 */
export async function prepararBaseDeDatos() {
    await Promise.all(Object.values(modelos).map((m) => m.init()));
    await asegurarTtlPapelera();
    await completarActividadesAntiguasBD();
    await migrarTemaAntiguoBD();
    const transacciones = await detectarTransacciones();
    return { transacciones, papeleraDias: diasPapelera() };
}
