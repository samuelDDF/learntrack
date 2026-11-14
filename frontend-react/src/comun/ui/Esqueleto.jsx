// Marcador de carga con forma de contenido (skeleton) y brillo sutil (v3.8).
// Solo se pinta MIENTRAS no hay datos (quien lo usa decide); anuncia el texto a los lectores de pantalla y aparece con
// un pequeño retraso en CSS para que una carga rápida no produzca un parpadeo.
//   variante: 'filas' (listas), 'tarjetas' (tarjetas de proyecto/repaso), 'texto' (párrafos) o 'mini' (cifras)
export function Esqueleto({ texto = 'Cargando…', filas = 3, variante = 'filas', className = '', id }) {
    return (
        <div id={id} className={`lt-esqueleto lt-esqueleto-${variante} ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
            <span className="solo-lectores">{texto}</span>
            {Array.from({ length: Math.max(1, filas) }, (_, i) => (
                <span key={i} className="lt-esqueleto-bloque" aria-hidden="true">
                    {variante === 'filas' || variante === 'tarjetas' ? <><span className="lt-esqueleto-linea" /><span className="lt-esqueleto-linea corta" /></> : null}
                </span>
            ))}
        </div>
    );
}
