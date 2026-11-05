// Piezas comunes de la capa de datos: protección contra inyección NoSQL, identificadores, errores y transacciones.
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ErrorConEstado } from '../errores.js';

// Segunda capa contra inyección NoSQL: Mongoose envuelve en $eq cualquier objeto con claves "$" que llegue a un
// filtro. Los operadores que escribimos nosotros se marcan con confiable() (= mongoose.trusted).
mongoose.set('sanitizeFilter', true);
export const confiable = mongoose.trusted;

// Primera capa: todo valor externo que llega a un filtro debe ser una cadena simple.
// (Si fuera un objeto como { $ne: null }, se descarta aquí antes de llegar a Mongo.)
export const esTexto = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max;

export const nuevoId = () => crypto.randomBytes(12).toString('hex');           // 24 hex (id público)
export const nuevoIdAleatorio = () => crypto.randomBytes(16).toString('hex');  // 32 hex (propuestas)

/** Error de datos con código HTTP: el manejador de errores lo convierte en { error } con ese estado */
export class ErrorDatos extends ErrorConEstado {
    constructor(codigo, mensaje, estado = 409) { super(mensaje, estado); this.codigo = codigo; }
}

// ====== Transacciones ======
let soportaTransacciones = false;
export const transaccionesDisponibles = () => soportaTransacciones;

/** Pregunta al servidor si admite transacciones (réplica o clúster; Atlas sí, un MongoDB independiente no) */
export async function detectarTransacciones() {
    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        soportaTransacciones = Boolean(hello.setName || hello.msg === 'isdbgrid');
    } catch { soportaTransacciones = false; }
    return soportaTransacciones;
}

const esErrorSinTransacciones = (e) => e?.code === 20 || /Transaction numbers are only allowed|replica set/i.test(e?.message ?? '');

/**
 * Ejecuta fn(session) de forma atómica. Si el servidor no admite transacciones (MongoDB independiente),
 * ejecuta sin sesión y devuelve { degradado: true } para avisar al usuario. Atlas sí las admite.
 */
export async function conTransaccion(fn) {
    if (soportaTransacciones) {
        try {
            let resultado;
            await mongoose.connection.transaction(async (session) => { resultado = await fn(session); });
            return { resultado, degradado: false };
        } catch (e) {
            if (!esErrorSinTransacciones(e)) throw e;
            soportaTransacciones = false;
        }
    }
    return { resultado: await fn(null), degradado: true };
}
