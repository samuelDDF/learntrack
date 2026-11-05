// Servidor Ollama SIMULADO (compatible con la API de OpenAI: POST /v1/chat/completions).
// Detecta la tarea por el prompt del sistema y responde con reglas simples o con respuestas programadas por la
// prueba. Permite simularlo caído (conexión rechazada / HTTP 500) o devolviendo JSON inválido.
import http from 'node:http';

export function tareaDe(sistema) {
    if (sistema.includes('clasificador de la agenda')) return 'clasificar';
    if (sistema.includes('extractor de actividades')) return sistema.includes('quiere CAMBIAR') ? 'editar' : 'crear';
    if (sistema.includes('planificador de proyectos')) return 'desglosar';
    if (sistema.includes('lector de documentos')) return 'archivo';
    if (sistema.includes('Redacta una respuesta')) return 'redactar';
    if (sistema.includes('asistente virtual de la app')) return 'consejo';
    return 'desconocida';
}

// Respuestas por defecto (lo que haría un modelo razonable)
function porDefecto(tarea, usuario, sistema) {
    const t = usuario.toLowerCase();
    switch (tarea) {
        case 'clasificar': {
            let intencion = 'charla';
            if (/organiza|tengo demasiado/.test(t)) intencion = 'reorganizar';
            else if (/libera|no puedo|todo lo del/.test(t)) intencion = 'liberar_dia';
            else if (/proyecto/.test(t) && /para el|tengo que/.test(t)) intencion = 'planificar_proyecto';
            else if (/recupera|restaura/.test(t)) intencion = 'restaurar';
            else if (/mueve|pasa .* al|muével/.test(t)) intencion = 'mover';
            else if (/borra|elimina/.test(t)) intencion = 'eliminar';
            else if (/ponle|cámbiale|cambia|ya lo terminé|que dure/.test(t)) intencion = 'editar';
            else if (/importa/.test(t)) intencion = 'importar';
            else if (/\?|qué tengo/.test(t)) intencion = 'preguntar';
            else if (/tengo|estudio|jugué|entreno|mañana|hoy|reunión|parcial/.test(t)) intencion = 'crear';
            return { intencion, ids: [], referencia: usuario.slice(0, 60), proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: /elimina|borra/.test(t) ? 'eliminar' : 'ninguno' };
        }
        case 'crear': {
            const titulo = usuario.replace(/^(mañana|hoy|el \w+)\s+(tengo\s+)?/i, '').split(/ de \d| a las| \d+ hora/)[0].slice(0, 40) || 'Actividad';
            const deporte = /fútbol|futbol|entren|gimnasio|correr/.test(t);
            return { actividades: [{ titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), tipo: deporte ? 'deporte' : 'estudio', exigencia: deporte ? -2 : (/parcial|examen/.test(t) ? 3 : 2), horas: 1, fecha_inicio: '', fecha_fin: '', hora_inicio: null, hora_fin: null, estado: 'pendiente', proyecto: '' }] };
        }
        case 'editar': {
            // Un modelo pequeño "despistado": devuelve el registro ENTERO con valores por defecto (caso del defecto 2-a)
            const actual = JSON.parse(sistema.match(/CAMBIAR esta actividad: (\{.*\})/)[1]);
            const cambios = { ...actual, tipo: 'estudio', exigencia: 2, estado: 'pendiente', proyecto: '', hora_inicio: null, hora_fin: null };
            if (/exigencia alta/.test(t)) cambios.exigencia = 3;
            if (/nombre a (.+)$/.test(usuario)) cambios.titulo = usuario.match(/nombre a (.+)$/)[1];
            return { cambios };
        }
        case 'desglosar':
            return { proyecto: 'Proyecto de prueba', tareas: [
                { titulo: 'Investigar', tipo: 'estudio', exigencia: 1, horas: 2, orden: 1, hito: false },
                { titulo: 'Diseñar', tipo: 'estudio', exigencia: 2, horas: 3, orden: 2, hito: false },
                { titulo: 'Construir', tipo: 'estudio', exigencia: 2, horas: 4, orden: 3, hito: false },
                { titulo: 'Entrega final', tipo: 'estudio', exigencia: 3, horas: 1, orden: 4, hito: true }
            ] };
        case 'archivo': {
            const doc = usuario.split('<<<DOCUMENTO_DEL_USUARIO>>>')[1] ?? '';
            const candidatos = [];
            for (const m of doc.matchAll(/(Parcial[^.\n]*|Entrega[^.\n]*|Quiz[^.\n]*) el (\d{1,2} de \w+)/gi)) {
                candidatos.push({ titulo: m[1].trim(), categoria: /entrega/i.test(m[1]) ? 'entrega' : 'examen', fecha: m[2], hora_inicio: null, hora_fin: null, cita: m[0].trim() });
            }
            return { candidatos };
        }
        case 'redactar': return { respuesta: 'Respuesta redactada por el modelo simulado.' };
        case 'consejo': return { consejo: 'Consejo simulado: descansa un poco.' };
        default: return {};
    }
}

export async function iniciarOllamaFalso() {
    const estado = { modo: 'normal', peticiones: [], programadas: new Map() };
    const servidor = http.createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (c) => { cuerpo += c; });
        req.on('end', () => {
            if (estado.modo === 'caido') { res.destroy(); return; }
            if (estado.modo === 'error500') { res.writeHead(500); res.end('error'); return; }
            if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
            const body = JSON.parse(cuerpo);
            const sistema = body.messages[0]?.content ?? '';
            const ultimo = body.messages.at(-1);
            const usuario = typeof ultimo.content === 'string' ? ultimo.content : ultimo.content.map((p) => p.text ?? '').join(' ');
            const tarea = tareaDe(sistema);
            estado.peticiones.push({ tarea, sistema, usuario, body });
            let contenido;
            if (estado.modo === 'json_invalido') contenido = 'Claro, aquí tienes: {intencion: crear, sin comillas';
            else {
                const cola = estado.programadas.get(tarea);
                const programada = cola?.length ? cola.shift() : null;
                const valor = programada ? (typeof programada === 'function' ? programada(usuario, sistema, body) : programada) : porDefecto(tarea, usuario, sistema);
                contenido = typeof valor === 'string' ? valor : JSON.stringify(valor);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: contenido } }] }));
        });
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    return {
        base: `http://127.0.0.1:${servidor.address().port}/v1`,
        estado,
        /** Programa la(s) próxima(s) respuesta(s) para una tarea (objeto, texto o función) */
        responder(tarea, ...respuestas) { if (!estado.programadas.has(tarea)) estado.programadas.set(tarea, []); estado.programadas.get(tarea).push(...respuestas); },
        modo(m) { estado.modo = m; },
        reiniciar() { estado.modo = 'normal'; estado.peticiones.length = 0; estado.programadas.clear(); },
        peticionesDe(tarea) { return estado.peticiones.filter((p) => p.tarea === tarea); },
        cerrar: () => new Promise((ok) => servidor.close(() => ok()))
    };
}
