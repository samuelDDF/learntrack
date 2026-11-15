// Construye URLs de recursos estáticos respetando BASE_URL de Vite (GitHub Pages usa /LearnTrack/).
export const recurso = (ruta) => `${import.meta.env.BASE_URL}${String(ruta).replace(/^\/+/, '')}`;
