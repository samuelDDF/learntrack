// Página informativa del Planificador (contenido migrado de la página informativa original).
import { Link } from 'react-router';
import { BotonAcceso } from '../../auth/components/BotonAcceso.jsx';
import { useRevelar } from '../../../hooks/useAnimaciones.js';

export default function InfoPlanificador() {
    const revelar = useRevelar();
    return (
        <main id="contenido">
            <section className="info-hero" aria-labelledby="titulo-pagina">
                <h1 id="titulo-pagina">Planificador inteligente</h1>
                <p>Organiza tu día sin saturarte: LearnTrack mide cuánta energía te piden tus actividades y cuánta te devuelven.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="que-es">
                <h2 id="que-es">¿Qué es?</h2>
                <p>El Planificador inteligente es la herramienta con la que organizas tu jornada en LearnTrack. A diferencia de una lista de tareas común, no solo registra lo que tienes que hacer: te recibe con un <strong>check-in diario</strong> para entender tu contexto y calcula tu <strong>carga mental del día</strong>.</p>
                <p>Para eso compara el esfuerzo de tus actividades (estudio, trabajo) con la energía que recuperas (ocio, deporte) y cruza esta información con tu estado actual. El resultado es un porcentaje, un semáforo y consejos personalizados de la IA que te indican si es buen momento para seguir o si te conviene parar.</p>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="como-funciona">
                <h2 id="como-funciona">¿Cómo funciona?</h2>
                <p>Cuatro pasos, todos en tu panel:</p>
                <ol className="flujo" ref={revelar} data-revelar-grupo="">
                    <li className="flujo-caja">
                        <span className="flujo-num">1</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Check-in diario</h3>
                        <p>Al iniciar tu día, respondes una breve encuesta. Tu ánimo define tu capacidad de energía base (hasta 120 pts), mientras que tu sueño y enfoque nutren a la IA.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">2</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Tus actividades</h3>
                        <p>Registras estudio, trabajo, ocio o deporte, con su nivel de exigencia y las horas que dura.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">3</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>El cálculo</h3>
                        <p>Puntos = exigencia × horas × 10. Carga = puntos totales ÷ capacidad × 100.</p>
                    </li>
                    <li className="flujo-caja">
                        <span className="flujo-num">4</span>
                        <span className="flujo-icono" aria-hidden="true" />
                        <h3>Tu semáforo</h3>
                        <p>Verde por debajo de 50 %, amarillo de 50 % a 85 %, rojo por encima de 85 %.</p>
                    </li>
                </ol>
                <div className="ejemplo detalle-calculo">
                    <h3>La balanza de tu energía: Así se calcula</h3>
                    <p>Tu carga mental funciona como una balanza: por un lado está <strong>tu tanque de energía</strong> y por otro, <strong>el peso de tus tareas</strong>.</p>
                    <h4 className="primero">1. Tu Tanque de Energía (Check-in)</h4>
                    <p>Tu respuesta emocional al iniciar el día define tu límite matemático:</p>
                    <ul>
                        <li><strong>Motivado/Alto:</strong> Tanque de 120 pts (tienes más margen para exigirte).</li>
                        <li><strong>Normal/Medio:</strong> Tanque de 100 pts.</li>
                        <li><strong>Cansado/Bajo:</strong> Tanque de 70 pts (te saturarás mucho más rápido).</li>
                    </ul>
                    <p className="nota-ia"><em>La información sobre tu calidad de sueño y enfoque de hoy no altera esta matemática, pero viaja directamente a la Inteligencia Artificial (Llama 3.2) para que te brinde consejos con un contexto más humano.</em></p>
                    <h4>2. El Peso de tus Tareas</h4>
                    <p>Cada actividad suma o resta puntos con esta fórmula: <strong>Exigencia × Horas × 10</strong></p>
                    <ul>
                        <li>Alta exigencia (3): <strong>+30 pts</strong> por hora</li>
                        <li>Exigencia media (2): <strong>+20 pts</strong> por hora</li>
                        <li>Baja exigencia (1): <strong>+10 pts</strong> por hora</li>
                        <li className="recarga">Ocio / Deporte (-2): <strong>-20 pts</strong> por hora (esto recupera energía y baja tu nivel de saturación)</li>
                    </ul>
                    <p>Si una actividad dura varios días (por ejemplo, de lunes a viernes 2 h diarias), suma sus horas en <strong>cada</strong> día. Las actividades completadas siguen contando: la energía ya se gastó.</p>
                    <h4>3. El Semáforo Final</h4>
                    <p>Si amaneces con ánimo <strong>Normal (Tanque de 100 pts)</strong> y registras 2 horas de cálculo (+60 pts) y 1 hora de gimnasio (-20 pts):</p>
                    <p className="resultado">
                        Total de puntos: 40.<br />
                        Carga mental = (40 ÷ 100) × 100 = <strong>40% 🟢 Estado equilibrado.</strong>
                    </p>
                </div>
            </section>
            <section ref={revelar} data-revelar="arriba" className="info-section" aria-labelledby="beneficios">
                <h2 id="beneficios">Beneficios clave</h2>
                <div className="beneficios" ref={revelar} data-revelar-grupo="">
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Evita la saturación</h3>
                        <p>Ves venir el agotamiento antes de que llegue, en lugar de notarlo cuando ya es tarde.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>El descanso cuenta</h3>
                        <p>Ocio y deporte restan carga: descansar deja de ser "perder tiempo" y pasa a ser parte del plan.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Decisiones claras</h3>
                        <p>Un número y un color te ayudan a decidir si agregar otra tarea o dejarla para mañana.</p>
                    </article>
                    <article className="beneficio">
                        <span className="beneficio-icono" aria-hidden="true" />
                        <h3>Historial reciente</h3>
                        <p>Guardamos tu carga de los últimos días para que veas cómo evoluciona tu ritmo.</p>
                    </article>
                </div>
            </section>
            <section ref={revelar} data-revelar="arriba" className="cta-final" aria-labelledby="cta-titulo">
                <h2 id="cta-titulo">¿Listo para probarlo?</h2>
                <p>Crea tu cuenta gratis y planifica tu primer día en minutos.</p>
                <div className="cta-botones">
                    <Link className="btn btn-volver" to="/">← Volver al inicio</Link>
                    <BotonAcceso>Iniciar sesión / Registro</BotonAcceso>
                </div>
            </section>
        </main>
    );
}
