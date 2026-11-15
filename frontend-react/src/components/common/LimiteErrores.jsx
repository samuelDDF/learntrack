// Si una pantalla falla al cargar (p. ej. tras publicar una versión nueva, o porque la sesión caducó y el código
// privado ya no se puede descargar), se muestra un aviso útil en lugar de una página en blanco.
import { Component } from 'react';

export class LimiteErrores extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { console.error('Error en la interfaz:', error?.message); }
    render() {
        if (!this.state.error) return this.props.children;
        const carga = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i.test(String(this.state.error?.message));
        return (
            <main className="error-limite" role="alert">
                <h1>{carga ? 'No se pudo cargar esta pantalla' : 'Algo salió mal'}</h1>
                <p>{carga
                    ? 'Puede que tu sesión haya terminado o que haya una versión nueva de LearnTrack. Recarga la página para continuar.'
                    : 'Ocurrió un error inesperado en la interfaz. Tus datos están a salvo en el servidor.'}</p>
                <div className="error-limite-acciones">
                    <button type="button" className="btn" onClick={() => window.location.reload()}>Recargar</button>
                    <a className="btn btn-volver" href={import.meta.env.BASE_URL}>Ir al inicio</a>
                </div>
            </main>
        );
    }
}
