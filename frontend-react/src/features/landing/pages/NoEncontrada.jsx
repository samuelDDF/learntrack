// Página 404 (el servidor responde con estado 404 y esta interfaz).
import { Link } from 'react-router';

export function NoEncontrada() {
    return (
        <main id="contenido" className="pagina-simple">
            <h1>Página no encontrada</h1>
            <p>La dirección que buscas no existe o fue movida.</p>
            <Link className="btn" to="/">Volver al inicio</Link>
        </main>
    );
}
