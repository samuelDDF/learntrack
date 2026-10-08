// Ejecuta todas las pruebas (node:test) de forma secuencial. Funciona igual en Windows (sin depender de que la
// terminal expanda comodines). La prueba en navegador va aparte: npm run test:e2e
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
// --test-concurrency existe desde Node 20.10; en Node 18 los archivos se ejecutan igual (cada uno en su proceso)
const [mayor, menor] = process.versions.node.split('.').map(Number);
const banderas = mayor > 20 || (mayor === 20 && menor >= 10) ? ['--test-concurrency=1'] : [];
const r = spawnSync(process.execPath, ['--test', ...banderas, ...archivos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
