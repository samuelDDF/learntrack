// Mapa ÚNICO de direcciones del frontend (SPA). Lo usan el enrutador (app/router.jsx), las cabeceras y los guardias.
// Express tiene su propia lista (backend/rutas/paginas-react.rutas.js) y una prueba comprueba que coincidan: las
// privadas exigen sesión EN EL SERVIDOR (sin sesión, 302 a /login); los guardias de React solo evitan pintar.
// Este archivo no contiene secretos ni importa código privado: solo nombres de rutas y títulos.

export const RUTA_INICIO = '/';
export const RUTA_PANEL = '/panel';
export const RUTA_LOGIN = '/login';
export const RUTA_REGISTRO = '/registro';
export const RUTA_VERIFICAR = '/verificar-correo';
export const RUTA_PAPELERA = '/papelera';
export const RUTA_PERFIL = '/perfil';
export const RUTA_CONFIGURACION = '/configuracion';

/** Páginas públicas (sin sesión) */
export const PAGINAS_PUBLICAS = {
    '/': { titulo: 'LearnTrack | Organiza tu vida y aprende mejor' },
    '/planificador': { titulo: 'Planificador inteligente | LearnTrack' },
    '/asistente': { titulo: 'Asistente con IA Local | LearnTrack' }
};

/** Ventana de acceso: cada paso tiene su dirección y se abre ENCIMA de la página pública (sin recargar) */
export const PAGINAS_ACCESO = {
    [RUTA_LOGIN]: { pestana: 'login', titulo: 'Iniciar sesión | LearnTrack' },
    [RUTA_REGISTRO]: { pestana: 'registro', titulo: 'Crear cuenta | LearnTrack' },
    [RUTA_VERIFICAR]: { pestana: 'verificar', titulo: 'Verifica tu correo | LearnTrack' }
};
export const RUTA_DE_PESTANA = { login: RUTA_LOGIN, registro: RUTA_REGISTRO, verificar: RUTA_VERIFICAR };

/** Páginas privadas (exigen sesión). clase = clase extra del <body> que usan los estilos de esa pantalla */
export const PAGINAS_PRIVADAS = {
    '/panel': { titulo: 'Mi panel', clase: '' },
    '/calendario': { titulo: 'Mi agenda', clase: 'pagina-cal' },
    '/proyectos': { titulo: 'Proyectos', clase: 'pagina-proyectos' },
    '/repaso': { titulo: 'Repaso', clase: 'pagina-repaso' },
    '/bienestar': { titulo: 'Bienestar', clase: 'pagina-bienestar' },
    '/papelera': { titulo: 'Papelera', clase: 'pagina-papelera' },
    '/perfil': { titulo: 'Mi perfil', clase: 'pagina-configuracion' },
    '/configuracion': { titulo: 'Configuración', clase: 'pagina-configuracion' }
};

export const RUTAS_PUBLICAS = [...Object.keys(PAGINAS_PUBLICAS), ...Object.keys(PAGINAS_ACCESO)];
export const RUTAS_PRIVADAS = Object.keys(PAGINAS_PRIVADAS);

/** Menú principal de cada zona */
export const NAVEGACION_PUBLICA = [
    { a: '/', texto: 'Inicio' },
    { a: '/planificador', texto: 'Planificador' },
    { a: '/asistente', texto: 'Asistente IA' }
];
export const NAVEGACION_PRIVADA = [
    { a: '/panel', texto: 'Mi panel' },
    { a: '/calendario', texto: 'Mi agenda' },
    { a: '/proyectos', texto: 'Proyectos' },
    { a: '/repaso', texto: 'Repaso' },
    { a: '/bienestar', texto: 'Bienestar' }
];

/**
 * Destino tras iniciar sesión: la página privada que se quería ver (la guarda RutaPrivada en el estado del
 * historial) o el panel. Solo se acepta una ruta privada CONOCIDA: nunca una dirección externa ni arbitraria.
 */
export function destinoTrasEntrar(desde) {
    const ruta = typeof desde?.pathname === 'string' ? desde.pathname : '';
    if (!RUTAS_PRIVADAS.includes(ruta)) return RUTA_PANEL;
    const hash = typeof desde.hash === 'string' && /^#[\w-]{0,40}$/.test(desde.hash) ? desde.hash : '';
    return ruta + hash;
}
