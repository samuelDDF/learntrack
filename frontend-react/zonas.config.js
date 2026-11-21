// Carpetas de src/ cuyo código es PRIVADO: Vite las compila en dist/r/privado/ y Express solo entrega esos archivos
// con sesión (401 sin ella). Todo lo demás (app, components, contexts, hooks, services, styles, utils y las
// funcionalidades públicas landing y auth) va a dist/r/publico/.
// La usan vite.config.js y tests/integracion/frontend-react.test.js: una sola lista para las dos.
export const ZONA_PRIVADA = [
    'features/dashboard',
    'features/calendar',
    'features/activities',
    'features/trash',
    'features/projects',
    'features/review',
    'features/ai-assistant',
    'features/wellness',
    'features/profile',
    'features/settings',
    'features/admin',
    'components/layout/privado',
    'styles/privado'
];
