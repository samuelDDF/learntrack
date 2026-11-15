// Puente con /tema-inicial.js (script clásico del <head> que aplica tema, paleta y fondo ANTES de pintar, sin
// destello). Ese script deja en window.LearnTrackTema: aplicar(apariencia, guardar?), olvidar(), usuario (promesa
// de /api/auth/me). Si no cargó (p. ej. en las pruebas), estas funciones no hacen nada.

const tema = () => (typeof window !== 'undefined' ? window.LearnTrackTema : undefined);

/** Aplica { temaSeleccionado, variablesTema, imagenFondoUrl } a toda la página (y lo recuerda en este navegador) */
export const aplicarApariencia = (apariencia, guardar) => tema()?.aplicar?.(apariencia, guardar);
/** Al cerrar sesión o cambiar de cuenta: la siguiente persona no hereda el tema de este navegador */
export const olvidarApariencia = () => tema()?.olvidar?.();
/** Promesa con el usuario que ya pidió tema-inicial.js (evita repetir /api/auth/me al arrancar) */
export const usuarioPrecargado = () => tema()?.usuario ?? null;
