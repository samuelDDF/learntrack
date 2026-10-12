// CATÁLOGOS ÚNICOS de LearnTrack (módulo ES puro). Los usan los modelos de MongoDB, la validación del servidor,
// el asistente y las pantallas del navegador (se sirve en /app/compartido/catalogos.js). Añadir un tipo o un
// estado aquí lo añade en todas partes.

/** Tipos de actividad y su nombre visible */
export const TIPOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
export const NOMBRE_TIPO = { estudio: 'Estudio', trabajo: 'Trabajo', ocio: 'Ocio', deporte: 'Deporte' };
/** Ocio y deporte "recargan" energía (exigencia -2) salvo que el usuario diga lo contrario */
export const TIPOS_RECARGA = ['ocio', 'deporte'];

/** Niveles de exigencia (puntos de carga por hora / 10). -2 = actividad de recarga */
export const EXIGENCIAS = [3, 2, 1, -2];
export const NOMBRE_EXIGENCIA = { 3: 'Alta', 2: 'Media', 1: 'Baja', '-2': 'Recarga' };

/** Estados de una actividad */
export const ESTADOS = ['pendiente', 'en_proceso', 'completado'];
export const NOMBRE_ESTADO = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado' };

/** Respuestas del check-in diario */
export const ANIMOS = ['alto', 'medio', 'bajo'];
export const SUENOS = ['bien', 'regular', 'mal'];
export const ENFOQUES = ['avanzar', 'mantener', 'descansar'];
