// Página de inicio (contenido migrado de la página de inicio original).
import { Link } from 'react-router';
import { BotonAcceso } from '../acceso.jsx';
import { useRevelar } from '../../comun/animaciones/hooks.js';

export function Inicio() {
    const revelar = useRevelar();
    return (
        <main id="contenido">
            <section className="hero" id="hero" aria-labelledby="hero-titulo">
                <div className="hero-content">
                    <h1 id="hero-titulo">Organiza tu vida, aprende mejor y mantén el equilibrio</h1>
                    <p>Planifica tus estudios, tareas y tiempo libre en un solo lugar, con un asistente que te acompaña cada día.</p>
                    <div className="hero-actions">
                        <a className="btn btn-header btn-header-sec" href="#servicios">Conocer las funciones</a>
                    </div>
                </div>
            </section>
            <section ref={revelar} data-revelar="arriba" id="que-es" aria-labelledby="que-es-titulo">
                <h2 id="que-es-titulo">¿Qué es LearnTrack?</h2>
                <p className="section-intro">Un planificador que no solo te dice qué hacer: te ayuda a saber cuándo es buen momento para estudiar y cuándo necesitas descansar.</p>
                <div className="pilares" ref={revelar} data-revelar-grupo="">
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Equilibrio real</h3>
                        <p>Estudio y trabajo conviven con ocio y deporte, que cuentan como recarga de energía.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Tu carga mental, a la vista</h3>
                        <p>Un porcentaje y un semáforo te muestran si tu día está equilibrado, cargado o saturado.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Asistente que te acompaña</h3>
                        <p>Consejos breves y personalizados con inteligencia artificial para decidir cómo seguir tu día.</p>
                    </article>
                </div>
            </section>
            <section ref={revelar} data-revelar="arriba" className="servicios" id="servicios" aria-labelledby="servicios-titulo">
                <h2 id="servicios-titulo">Productos y servicios</h2>
                <p className="section-intro">Dos herramientas pensadas para que estudies con orden y no descuides tu bienestar.</p>
                <div className="cards" ref={revelar} data-revelar-grupo="">
                    <Link className="btn-segundario" to="/planificador">
                        <article>
                            <img src="/recursos/imagenes/planificador.png" alt="Calendario semanal" width="1536" height="1024" loading="lazy" />
                            <h3>Planificador inteligente</h3>
                            <p>Organiza tu jornada con estudio, proyectos, ejercicio y descanso en el mismo lugar, y mide tu carga mental del día.</p>
                        </article>
                    </Link>
                    <Link className="btn-segundario" to="/asistente">
                        <article>
                            <img src="/recursos/imagenes/asistente.png" alt="Robot asistente" width="1536" height="1024" loading="lazy" />
                            <h3>Asistente con IA</h3>
                            <p>Recibe recomendaciones personalizadas y apoyo diario para cumplir tus actividades sin agobiarte.</p>
                        </article>
                    </Link>
                </div>
            </section>
            <section ref={revelar} data-revelar="escala" id="acceso" className="cta-final" aria-labelledby="acceso-titulo">
                <h2 id="acceso-titulo">Entra a tu espacio en LearnTrack</h2>
                <p>Crea tu cuenta gratis o inicia sesión para usar el planificador y el asistente con IA.</p>
                <div className="cta-botones">
                    <BotonAcceso>Iniciar sesión</BotonAcceso>
                </div>
            </section>
        </main>
    );
}
