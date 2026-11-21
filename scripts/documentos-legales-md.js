// Genera DOCUMENTOS-LEGALES.md con el texto EXACTO de compartido/legal.js (para revisión del abogado o para leerlo
// fuera de la app). Uso: node scripts/documentos-legales-md.js
import fs from 'node:fs';
import { TERMINOS, PRIVACIDAD } from '../compartido/legal.js';

const md = (d) => [`# ${d.titulo}`, '', `Versión ${d.version} · Vigente desde: ${d.vigenteDesde}`, '',
    ...d.secciones.flatMap((s) => [`## ${s.titulo}`, '', ...s.bloques.flatMap((b) => (typeof b === 'string' ? [b, ''] : [...b.lista.map((t) => `- ${t}`), '']))])].join('\n');

const aviso = '> **Borrador para revisión de un abogado colombiano.** No garantiza por sí solo el cumplimiento legal. Los datos marcados `[PENDIENTE: …]` deben completarse en `compartido/legal.js` antes de publicar.\n';
fs.writeFileSync(new URL('../DOCUMENTOS-LEGALES.md', import.meta.url), `${aviso}\n${md(TERMINOS)}\n---\n\n${md(PRIVACIDAD)}`);
console.log('✔ DOCUMENTOS-LEGALES.md generado desde compartido/legal.js');
