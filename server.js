// server.js — punto de entrada (npm start). Carga el .env, conecta a MongoDB, prepara índices, TTL y
// migraciones idempotentes (backend/datos/index.js), programa la limpieza automática (node-cron) y solo entonces
// empieza a escuchar. Cierre ordenado con SIGINT/SIGTERM.
import './backend/config/entorno.js';          // primero: el .env debe estar cargado antes que los modelos
import mongoose from 'mongoose';
import { prepararBaseDeDatos } from './backend/datos/index.js';
import { crearApp } from './backend/app.js';
import { iniciarLimpiezaAutomatica } from './backend/servicios/tareas/limpieza.js';
import { describirCorreo, comprobarCorreo } from './backend/servicios/cuenta/correo.js';
import { configVerificacion } from './backend/servicios/cuenta/verificacion-correo.js';

if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI en el archivo .env (cadena de conexión de MongoDB Atlas).');
    process.exit(1);
}

let estado, limpieza = null;
try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    estado = await prepararBaseDeDatos();
    console.log(`🍃 Conectado a MongoDB (base de datos: ${mongoose.connection.name})`);
    console.log(estado.transacciones
        ? '🔒 Transacciones multi-documento disponibles: las propuestas se aplican de forma atómica.'
        : '⚠️  Este MongoDB no admite transacciones (servidor independiente): las propuestas se aplicarán sin atomicidad. Atlas sí las admite.');
    console.log(`🗑  Papelera: ${estado.papeleraDias} días (PAPELERA_DIAS).`);
    limpieza = iniciarLimpiezaAutomatica();      // node-cron: archiva cada noche las completadas ya vencidas
} catch (error) {
    console.error('No se pudo conectar a MongoDB:', error.message);
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const app = crearApp({ puerto: PORT });

const servidor = app.listen(PORT, () => {
    console.log(`🛡 Servidor ciberseguro LearnTrack ejecutándose en http://localhost:${PORT}`);
    console.log('⚛️  Frontend único: React + PWA (frontend-react/dist).');
    console.log(`🤖 Asistente configurado con Ollama local (${process.env.OLLAMA_MODEL || 'llama3.2'})${process.env.OLLAMA_VISION_MODEL ? ` + visión (${process.env.OLLAMA_VISION_MODEL})` : ''}`);
    const v = configVerificacion();
    console.log(`✉️  Correo de verificación: ${describirCorreo()}. Código de 6 dígitos válido ${v.minutos} min, ${v.maxIntentos} intentos; cuentas anteriores a la v3.10: ${v.cuentasAntiguas}.`);
    // Comprobación de la conexión SMTP sin bloquear el arranque (solo avisa; no muestra credenciales)
    comprobarCorreo().then((r) => { if (r !== null && r !== true) console.warn(`⚠️  No se pudo conectar con el servidor SMTP (${r}). Revisa SMTP_HOST, SMTP_PORT, SMTP_SECURE y las credenciales.`); });
});

// Cierre ordenado: deja de aceptar peticiones y cierra la conexión con MongoDB
for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => {
        limpieza?.stop();
        servidor.close(async () => { await mongoose.connection.close(); process.exit(0); });
    });
}
