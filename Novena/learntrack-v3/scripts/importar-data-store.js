// Importación ÚNICA de los datos antiguos (data_store.json) a MongoDB. NO forma parte del servidor:
//   npm run migrar:datos                      (usa ./data_store.json)
//   npm run migrar:datos -- ruta/al/archivo.json
// Es idempotente: puedes ejecutarlo varias veces sin duplicar datos. Las sesiones no se importan
// (los usuarios solo tendrán que iniciar sesión de nuevo). Después puedes borrar data_store.json.
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Usuario from '../models/Usuario.js';
import Actividad from '../models/Actividad.js';
import Historial from '../models/Historial.js';
import Mensaje from '../models/Mensaje.js';
import { normalizarActividad } from '../compartido/carga.js';
import { backfillActividadesBD } from '../src/database.js';

dotenv.config({ quiet: true });
if (!process.env.MONGO_URI) { console.error('Falta MONGO_URI en el .env'); process.exit(1); }

const archivo = path.resolve(process.argv[2] ?? 'data_store.json');
if (!fs.existsSync(archivo)) { console.error(`No existe ${archivo}`); process.exit(1); }
const datos = JSON.parse(fs.readFileSync(archivo, 'utf-8'));

const lista = (x) => (Array.isArray(x) ? x : []);
const fechaONull = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? new Date() : d; };

// Cada documento se inserta solo si no existe (clave natural) → idempotente
const insertarSiNoExiste = (clave, doc) => ({ updateOne: { filter: clave, update: { $setOnInsert: doc }, upsert: true } });

const operaciones = [
    [Usuario, 'usuarios', lista(datos.usuarios).map(u => insertarSiNoExiste({ id: u.id }, { ...u, creado: fechaONull(u.creado) }))],
    // Las actividades antiguas solo tienen `fecha`: se completan fecha_inicio/fecha_fin y los campos opcionales
    [Actividad, 'actividades', lista(datos.actividades).map(a => {
        const { eliminadaEn, ...n } = normalizarActividad(a);
        return insertarSiNoExiste({ id: a.id }, { ...n, eliminadaEn: null });
    })],
    // Historial: de { [userId]: { fecha: porcentaje } } a filas planas { userId, fecha, porcentaje }
    [Historial, 'historial', Object.entries(datos.historial ?? {}).flatMap(([userId, dias]) =>
        Object.entries(dias ?? {}).map(([fecha, porcentaje]) => insertarSiNoExiste({ userId, fecha }, { userId, fecha, porcentaje })))],
    [Mensaje, 'mensajes', lista(datos.mensajes).map(m => insertarSiNoExiste({ id: m.id }, { ...m, fecha: fechaONull(m.fecha) }))]
];

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
for (const [Modelo] of operaciones) await Modelo.init();

for (const [Modelo, nombre, ops] of operaciones) {
    if (ops.length === 0) { console.log(`${nombre}: nada que importar`); continue; }
    try {
        const r = await Modelo.bulkWrite(ops, { ordered: false });
        console.log(`${nombre}: ${r.upsertedCount} nuevos, ${ops.length - r.upsertedCount} ya existían`);
    } catch (e) {
        console.error(`${nombre}: errores durante la importación →`, e.writeErrors?.map(w => w.errmsg).join('; ') ?? e.message);
    }
}
// Por si ya había actividades importadas con una versión anterior (solo `fecha`): backfill idempotente
const { actualizadas } = await backfillActividadesBD();
console.log(`backfill de fechas: ${actualizadas} actividades completadas`);
await mongoose.connection.close();
