// Respuestas de "no encontrado" y manejador final de errores (sin registrar cuerpos de peticiones ni archivos).
import path from 'path';
import { ErrorConEstado } from '../errores.js';
import { ErrorIA } from '../servicios/asistente/cliente-ollama.js';

export const apiNoEncontrada = (req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' });

export const paginaNoEncontrada = (carpetaPublica) => (req, res) =>
    res.status(404).sendFile(path.join(carpetaPublica, 'error-404', 'error-404.html'));

// eslint-disable-next-line no-unused-vars
export function manejarErrores(err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
        return res.status(err.status || 400).json({ error: 'Cuerpo de la petición no válido.' });
    }
    if (err instanceof ErrorIA) {
        if (err.tipo === 'no_disponible') {
            return res.status(503).json({ error: 'El asistente de IA no está disponible ahora mismo (¿está corriendo «ollama serve» con el modelo descargado?). Puedes seguir creando actividades con «+ Nueva actividad».' });
        }
        return res.status(502).json({ error: 'La IA respondió con un formato no válido. Intenta reformular tu mensaje.' });
    }
    if (err instanceof ErrorConEstado) return res.status(err.estado).json({ error: err.message });
    if (err?.name === 'CastError' || err?.name === 'ValidationError') return res.status(400).json({ error: 'Datos no válidos.' });
    if (err?.status === 404) return res.status(404).json({ error: 'No encontrado.' });
    console.error('Error no controlado:', err?.message, err?.stack?.split('\n').slice(1, 4).join(' | '));
    res.status(500).json({ error: 'Error interno del servidor.' });
}
