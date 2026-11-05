// Indicador de carga accesible (anuncia el texto a los lectores de pantalla)
export function Cargando({ texto = 'Cargando…', pantalla = false }) {
    return (
        <div className={pantalla ? 'cargando cargando-pantalla' : 'cargando'} role="status" aria-live="polite">
            <span className="cargando-rueda" aria-hidden="true" />
            <span>{texto}</span>
        </div>
    );
}
