// <dialog> nativo controlado por React: modal accesible (foco atrapado, Escape, devuelve el foco al cerrar).
//  · abierto: true/false. · alCerrar(): se llama al cerrarse por cualquier vía (Escape, fondo, botón).
//  · obligatorio: no se puede cerrar con Escape ni con el fondo (p. ej. el primer check-in del día).
import { useEffect, useRef } from 'react';

export function Dialogo({ abierto, alCerrar, obligatorio = false, className = 'dialogo', children, ...resto }) {
    const ref = useRef(null);
    useEffect(() => {
        const d = ref.current;
        if (!d) return;
        if (abierto && !d.open) {
            if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
        } else if (!abierto && d.open) d.close();
    }, [abierto]);
    return (
        <dialog
            ref={ref}
            className={className}
            // React propaga «cancel» y «close» a los diálogos ANTERIORES del árbol: con un diálogo dentro de otro (la
            // confirmación dentro de la papelera), cerrar el de dentro cerraba también el de fuera. Solo los propios.
            onCancel={(e) => { if (e.target !== ref.current) return; if (obligatorio) e.preventDefault(); }}
            onClose={(e) => { if (e.target === ref.current) alCerrar?.(); }}
            onClick={(e) => { if (!obligatorio && e.target === ref.current) ref.current.close(); }}
            {...resto}
        >
            {abierto ? children : null}
        </dialog>
    );
}
