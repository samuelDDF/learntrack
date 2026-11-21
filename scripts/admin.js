// Administrador ÚNICO de LearnTrack (v3.13). Se ejecuta en TU equipo (o en el servidor), nunca desde la web:
//
//   npm run admin:crear        crea el administrador (si ya existe uno, no hace nada)
//   npm run admin:verificar    comprueba que existe exactamente un administrador y el índice que lo garantiza
//   npm run admin:restablecer  nueva contraseña para el administrador (si la perdiste); cierra sus sesiones
//
// Necesita: MONGO_URI (la base de datos) y ADMIN_EMAIL (el correo del administrador). ADMIN_NOMBRE es opcional.
// La CONTRASEÑA se escribe en la consola, oculta y dos veces: nunca como argumento ni variable de entorno (no queda
// en el historial de la terminal, en .env ni en Railway). En la base de datos solo se guarda su hash (scrypt).
// Si la entrada no es una terminal (p. ej. una prueba automática), lee dos líneas de la entrada estándar.
import '../backend/config/entorno.js';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { hashPassword } from '../backend/servicios/cuenta/contrasenas.js';
import { normalizarEmail, esEmail, limpiarTexto, errorPasswordAdmin } from '../backend/validacion/index.js';
import { crearAdminBD, restablecerAdminBD, comprobarIntegridadAdminBD, obtenerAdminBD } from '../backend/datos/index.js';
import Usuario from '../backend/modelos/Usuario.js';

const ocultar = (email) => email.replace(/^(.).*?(@.).*?(\.[^.]+)$/, '$1***$2***$3');
const salir = async (codigo, mensaje) => {
    if (mensaje) (codigo ? console.error : console.log)(mensaje);
    await mongoose.disconnect().catch(() => {});
    process.exit(codigo);
};

let lineasEntrada = null;
async function leerOculto(pregunta) {
    if (!process.stdin.isTTY) {
        // Entrada no interactiva: dos líneas (contraseña y confirmación). Sin eco: no se imprime nada.
        if (!lineasEntrada) {
            let texto = '';
            for await (const trozo of process.stdin) texto += trozo;
            lineasEntrada = texto.split(/\r?\n/);
        }
        return lineasEntrada.shift() ?? '';
    }
    return new Promise((ok) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        // Se muestra la pregunta, pero NO lo que se escribe
        rl._writeToOutput = (texto) => { if (texto.includes(pregunta)) process.stdout.write(pregunta); };
        rl.question(pregunta, (respuesta) => { rl.close(); process.stdout.write('\n'); ok(respuesta); });
    });
}

async function pedirContrasena(email) {
    for (let intento = 1; intento <= 3; intento++) {
        const p1 = await leerOculto('Contraseña del administrador (no se mostrará): ');
        const error = errorPasswordAdmin(p1, email);
        if (error) { console.error(`✖ ${error}`); if (!process.stdin.isTTY) break; continue; }
        const p2 = await leerOculto('Repite la contraseña: ');
        if (p1 !== p2) { console.error('✖ Las contraseñas no coinciden.'); if (!process.stdin.isTTY) break; continue; }
        return p1;
    }
    return null;
}

function correoConfigurado() {
    const email = normalizarEmail(process.env.ADMIN_EMAIL ?? '');
    return esEmail(email) ? email : null;
}

async function crear() {
    const email = correoConfigurado();
    if (!email) return salir(1, '✖ Falta ADMIN_EMAIL (el correo del administrador) en el .env o en la terminal.');
    const nombre = limpiarTexto(process.env.ADMIN_NOMBRE || 'Administración', 60) || 'Administración';
    if (await Usuario.exists({ rol: 'admin' })) {
        return salir(2, '✖ Ya existe un administrador. LearnTrack solo admite uno: no se creó nada.\n  Si perdiste la contraseña, usa «npm run admin:restablecer».');
    }
    if (await Usuario.exists({ email })) {
        return salir(1, '✖ Ese correo ya pertenece a una cuenta normal. El administrador debe usar un correo propio y distinto.');
    }
    console.log(`Se creará el administrador ${ocultar(email)} (${nombre}).`);
    const password = await pedirContrasena(email);
    if (!password) return salir(1, '✖ No se creó el administrador.');
    const r = await crearAdminBD({ nombre, email, passwordHash: await hashPassword(password) });
    if (r.error === 'ya_existe') return salir(2, '✖ Ya existe un administrador (lo creó otra ejecución al mismo tiempo). No se creó nada.');
    if (r.error) return salir(1, '✖ Ese correo ya está en uso. No se creó nada.');
    const integridad = await comprobarIntegridadAdminBD();
    return salir(0, `✔ Administrador creado: ${ocultar(email)}.\n  Integridad: ${integridad.administradores} administrador(es), índice único ${integridad.indiceUnico ? 'activo' : 'NO encontrado'}.\n  Inicia sesión en la página de LearnTrack con ese correo y entra en /admin.`);
}

async function verificar() {
    const integridad = await comprobarIntegridadAdminBD();
    const admin = await obtenerAdminBD();
    console.log(`Administradores encontrados: ${integridad.administradores}`);
    if (admin) console.log(`  · ${ocultar(admin.email)} · creado ${new Date(admin.creado).toISOString().slice(0, 10)} · último acceso ${admin.ultimoAcceso ? new Date(admin.ultimoAcceso).toISOString().slice(0, 16).replace('T', ' ') : 'nunca'}`);
    console.log(`Índice único «administrador_unico»: ${integridad.indiceUnico ? 'activo' : 'NO encontrado'}`);
    if (integridad.unico && integridad.indiceUnico) return salir(0, '✔ Todo correcto: hay exactamente un administrador y MongoDB impide crear otro.');
    return salir(2, integridad.administradores === 0 ? '✖ No hay administrador. Créalo con «npm run admin:crear».' : '✖ Revisa la base de datos: la integridad no es la esperada.');
}

async function restablecer() {
    const email = correoConfigurado();
    if (!email) return salir(1, '✖ Falta ADMIN_EMAIL (el correo del administrador).');
    const admin = await obtenerAdminBD();
    if (!admin || admin.email !== email) return salir(1, '✖ ADMIN_EMAIL no coincide con el administrador existente. No se cambió nada.');
    console.log(`Nueva contraseña para ${ocultar(email)}. Se cerrarán todas sus sesiones.`);
    const password = await pedirContrasena(email);
    if (!password) return salir(1, '✖ No se cambió la contraseña.');
    await restablecerAdminBD({ email, passwordHash: await hashPassword(password) });
    return salir(0, '✔ Contraseña restablecida y sesiones del administrador cerradas.');
}

const ACCIONES = { crear, verificar, restablecer };
const accion = ACCIONES[process.argv[2]];
if (!accion) await salir(1, 'Uso: node scripts/admin.js crear | verificar | restablecer');
if (!process.env.MONGO_URI) await salir(1, '✖ Falta MONGO_URI (la cadena de conexión de MongoDB).');
try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    await Usuario.init();         // crea el índice único si la base de datos aún no lo tiene
    await accion();
} catch (e) {
    await salir(1, `✖ Error: ${e.message}`);
}
