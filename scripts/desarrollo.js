// npm run dev — desarrollo del frontend React con recarga en caliente:
//   · API (Express, server.js) en http://localhost:3000  (necesita .env con MONGO_URI)
//   · Vite en http://localhost:5173 → abre ESTA dirección. Vite reenvía /api a Express sin cambiar Host ni Origin,
//     así la cookie de sesión (SameSite=Strict) y la comprobación de Origin (CSRF) siguen funcionando.
// Ojo: en desarrollo Vite entrega la página a cualquiera (la API sí exige sesión). La protección de las páginas
// privadas y de r/privado es la del servidor en producción: «npm run build» y «npm start».
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(raiz, 'node_modules', 'vite', 'bin', 'vite.js');
const procesos = [
    spawn(process.execPath, ['server.js'], { cwd: raiz, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' } }),
    spawn(process.execPath, [vite, '--config', 'frontend-react/vite.config.js'], { cwd: raiz, stdio: 'inherit' })
];
const terminar = (codigo = 0) => { for (const p of procesos) if (!p.killed) p.kill(); process.exit(codigo); };
for (const p of procesos) p.on('exit', (codigo) => terminar(codigo ?? 0));
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => terminar(0));
