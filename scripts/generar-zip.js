// generar-zip.js — Empaqueta LearnTrack en un .zip listo para entregar o subir (usa la librería `archiver`).
//   npm run zip                      → learntrack-v<versión>.zip en la carpeta del proyecto
//   node scripts/generar-zip.js ruta/salida.zip
// Incluye todo el proyecto con su estructura de carpetas, EXCEPTO lo que no debe viajar:
//   node_modules (se reinstala con npm install), .env (tiene secretos: usa .env.example), la compilación de React
//   (frontend-react/dist: se genera con «npm run build»), capturas de las pruebas en navegador, los .zip anteriores y
//   archivos del sistema (.DS_Store, Thumbs.db) o de control de versiones (.git).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const carpeta = `learntrack-v${version}`;
const destino = path.resolve(process.argv[2] ?? path.join(raiz, `${carpeta}.zip`));

let archiver;
try { archiver = (await import('archiver')).default; } catch {
    console.error('Falta la librería "archiver": instálala con  npm install --save-dev archiver');
    process.exit(1);
}

const EXCLUIR = [
    'node_modules/**', '**/node_modules/**', '.env', '.env.*.local', '**/.env', '.git/**', '*.zip',
    'tests/navegador/capturas/**', 'tests/navegador/capturas-react/**', 'tests/.tmp-*/**',
    'frontend-react/dist/**',                       // se genera con «npm run build»
    '**/.DS_Store', '**/Thumbs.db', '**/*.log', 'coverage/**', '.vite/**', '**/.vite/**'
];

const salida = fs.createWriteStream(destino);
const zip = archiver('zip', { zlib: { level: 9 } });
const terminado = new Promise((ok, mal) => { salida.on('close', ok); salida.on('error', mal); zip.on('error', mal); });
zip.on('warning', (e) => { if (e.code === 'ENOENT') console.warn('Aviso:', e.message); else throw e; });
zip.pipe(salida);
// Todo dentro de una carpeta learntrack-vX.Y.Z/ (al descomprimir no se mezcla con otros archivos)
zip.glob('**/*', { cwd: raiz, dot: true, ignore: EXCLUIR, nodir: true }, { prefix: carpeta });
await zip.finalize();
await terminado;

const kb = (zip.pointer() / 1024).toFixed(0);
console.log(`✅ ${path.relative(process.cwd(), destino) || destino} (${kb} KB). Para usarlo: descomprímelo, entra en ${carpeta}/, ` +
    'ejecuta "npm install", copia .env.example a .env con tu MONGO_URI, "npm run build" y "npm start".');
