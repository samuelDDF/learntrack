// Backfill idempotente de fecha_inicio / fecha_fin (y campos opcionales) para actividades antiguas que solo
// tienen `fecha` (p. ej. importadas de data_store.json con una versión anterior). El servidor ya lo ejecuta al
// arrancar (prepararIndices); este script sirve para hacerlo a mano:   npm run migrar:fechas
import '../src/entorno.js';
import mongoose from 'mongoose';
import { backfillActividadesBD } from '../src/database.js';

if (!process.env.MONGO_URI) { console.error('Falta MONGO_URI en el .env'); process.exit(1); }
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
const { actualizadas } = await backfillActividadesBD();
console.log(`Actividades completadas: ${actualizadas} (si vuelves a ejecutarlo, debería decir 0).`);
await mongoose.connection.close();
