// Hooks reutilizables del sistema de animaciones (v3.8). Ver revelar.js.
import { useCallback, useEffect, useRef } from 'react';
import { animarCambio, dejarDeObservar, observar } from '../utils/animaciones.js';

/**
 * Animación de entrada al aparecer en pantalla.
 *   const revelar = useRevelar();
 *   <section ref={revelar} data-revelar="arriba">…</section>          (arriba | izquierda | derecha | escala | aparecer)
 *   <ul ref={revelar} data-revelar-grupo>…</ul>                          (los hijos entran escalonados)
 * La referencia es estable (no se vuelve a observar en cada render) y React 19 ejecuta la limpieza al desmontar.
 */
export function useRevelar() {
    return useCallback((el) => {
        if (!el) return undefined;
        observar(el);
        return () => dejarDeObservar(el);
    }, []);
}

/**
 * Anima el elemento cuando cambia `clave` (no en el primer render). `tipo` puede ser un texto
 * ('adelante', 'atras', 'aparecer', 'destello') o una función (claveAnterior, claveNueva) => texto.
 * Uso: cambio de mes/semana/día en la agenda, cambio de modo en Proyectos.
 */
export function useAnimarCambio(clave, tipo = 'aparecer', opciones) {
    const ref = useRef(null);
    const anterior = useRef(clave);
    const tipoRef = useRef(tipo);
    tipoRef.current = tipo;
    useEffect(() => {
        if (anterior.current === clave) return undefined;
        const previa = anterior.current;
        anterior.current = clave;
        const t = typeof tipoRef.current === 'function' ? tipoRef.current(previa, clave) : tipoRef.current;
        const animacion = animarCambio(ref.current, t, opciones);
        return () => animacion?.cancel();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave]);
    return ref;
}

/** Destello breve cuando cambian los datos de un elemento que ya estaba en pantalla (p. ej., al editar una actividad) */
export function useDestello(firma) {
    return useAnimarCambio(firma, 'destello', { duracion: 420 });
}
