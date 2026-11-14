// Página informativa del Asistente (contenido migrado de la página informativa original).
import { Link } from 'react-router';
import { BotonAcceso } from '../acceso.jsx';
import { useRevelar } from '../../comun/animaciones/hooks.js';

export function InfoAsistente() {
    const revelar = useRevelar();
    return (
        <main id="contenido">
            <section className="info-hero" aria-labelledby="titulo-pagina">
                <h1 id="titulo-pagina">Asistente con IA Local</h1>
                <p>Un consejo breve y a tu medida cada vez que organizas tu día: seguir, descansar o recargar energía de forma privada.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="que-es">
                <h2 id="que-es">¿Qué es?</h2>
                <p>El Asistente con IA lee tu situación del día —cómo te sientes, tu porcentaje de carga mental y tus actividades— y te responde con un consejo empático y directo, de máximo dos frases.</p>
                <p>Funciona con <strong>Ollama y Llama 3.2</strong>, un modelo de lenguaje de código abierto que se ejecuta en el propio servidor de LearnTrack: tus mensajes no se envían a servicios de IA de terceros ni dependes de suscripciones externas.</p>
                <p>Además del consejo, el asistente conversa contigo en «Mi panel» y «Mi agenda»: agenda actividades, libera un día aplazando lo que no cabe, reorganiza tu semana, divide un proyecto en tareas antes de su fecha límite, lee tu cronograma (PDF, DOCX, TXT o ICS) y recupera lo que borraste. La IA solo interpreta lo que escribes; las fechas y la carga las calcula el sistema, y los cambios grandes siempre te los muestra antes de aplicarlos.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="como-funciona">
                <h2 id="como-funciona">¿Cómo funciona la IA Local?</h2>
                <p>Este es el recorrido de cada consulta:</p>
                <ol className="flujo" ref={revelar} data-revelar-grupo="">
                    <li className="flujo-caja">
                        <span className="flujo-num">1</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Tu panel</h3>
                        <p>Reúne tu ánimo, tu porcentaje de carga y los títulos de tus actividades de hoy.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">2</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Servidor LearnTrack</h3>
                        <p>Verifica tu sesión, valida los datos y aplica límites de seguridad a las consultas.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">3</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Ollama (Llama 3.2)</h3>
                        <p>Procesa la consulta en el servidor de LearnTrack, sin enviarla a servicios de IA externos.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">4</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Tu consejo</h3>
                        <p>Vuelve a tu panel en máximo dos frases: seguir, descansar o dedicar tiempo a tu bienestar.</p>
                    </li>
                </ol>
                <div className="ejemplo">
                    <h3>Un ejemplo (ilustrativo)</h3>
                    <p><strong>Tú:</strong> ánimo cansado · carga del 95 % · actividades: "Parcial de Redes" (3 h) y "Proyecto final" (2 h).</p>
                    <p><strong>Asistente:</strong> "Llevas una carga muy alta y poca energía: cierra el estudio por hoy y reserva un rato para descansar o moverte con calma."</p>
                    <p>Las respuestas cambian según tu jornada, redactadas en tiempo real por el modelo local.</p>
                </div>
                <p className="nota"><strong>Tu privacidad:</strong> la IA (Ollama) corre en el servidor de LearnTrack y tus actividades se guardan en la base de datos de la aplicación (MongoDB). Si usas el dictado por voz, el reconocimiento lo hace tu navegador: en Chrome el audio lo procesa el servicio de Google. LearnTrack no graba ni guarda audio, y los archivos que adjuntas se leen en memoria y no se guardan.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="beneficios">
                <h2 id="beneficios">Beneficios en tu bienestar y tu productividad</h2>
                <div className="beneficios" ref={revelar} data-revelar-grupo="">
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>IA sin terceros</h3>
                        <p>Tus mensajes los interpreta un modelo local, no un servicio de IA de terceros.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Aviso temprano</h3>
                        <p>Te recuerda parar antes de llegar al agotamiento, cuidando tu salud mental.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Descansar sin culpa</h3>
                        <p>Una recomendación clara te da permiso para recargar energía cuando lo necesitas.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Consejos concretos</h3>
                        <p>En lugar de frases genéricas, recibes una sugerencia pensada para tu día de hoy.</p>
                    </article>
                </div>
                <p className="nota">El asistente es una guía de organización, no reemplaza el apoyo de un profesional de la salud. Si te sientes mal de forma sostenida, busca ayuda profesional.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="cta-final" aria-labelledby="cta-titulo">
                <h2 id="cta-titulo">Pruébalo con tu propio día</h2>
                <p>Inicia sesión o crea tu cuenta gratis para recibir tu primer consejo.</p>
                <div className="cta-botones">
                    <Link className="btn btn-volver" to="/">← Volver al inicio</Link>
                    <BotonAcceso>Iniciar sesión / Registro</BotonAcceso>
                </div>
            </section>
        </main>
    );
}
