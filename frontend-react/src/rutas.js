// Rutas de páginas del frontend React. Express tiene su propia lista (backend/rutas/paginas-react.rutas.js) y una
// prueba comprueba que coincidan: las privadas exigen sesión en el servidor.
export const RUTAS_PUBLICAS = ['/', '/planificador', '/asistente'];
export const RUTAS_PRIVADAS = ['/panel', '/calendario', '/proyectos', '/repaso', '/configuracion'];
export const RUTA_PANEL = '/panel';
