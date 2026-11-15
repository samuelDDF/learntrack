// Mensaje de estado bajo un formulario o bloque (clases .mensaje / .ok / .error de los estilos originales)
export function Mensaje({ estado, id, className = 'mensaje' }) {
    const tipo = estado?.tipo ?? '';
    return (
        <p id={id} className={`${className}${tipo ? ` ${tipo}` : ''}`} role="status" aria-live="polite">{estado?.texto ?? ''}</p>
    );
}
/** Atajo: { texto, tipo: 'ok' | 'error' | '' } */
export const estadoMsg = (texto = '', tipo = '') => ({ texto, tipo });
