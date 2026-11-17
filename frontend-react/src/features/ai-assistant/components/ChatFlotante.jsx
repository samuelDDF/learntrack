import { useEffect, useState } from 'react';
import { ChatIA } from './ChatIA.jsx';
import './chat-flotante.css';

/** Acceso flotante al asistente, con el mismo chat completo de la agenda. */
export function ChatFlotante({ contexto, alActualizar = () => {} }) {
    const [abierto, setAbierto] = useState(false);
    const titulo = contexto?.seccion === 'proyectos' ? 'Asistente de proyectos' : 'Asistente de estudio';
    const bienvenida = contexto?.seccion === 'proyectos'
        ? (contexto.proyecto
            ? `¡Vamos con tu proyecto «${contexto.proyecto}»! Puedo ayudarte a revisar tareas, resolver dudas y organizar los próximos pasos.`
            : '¡Estoy aquí para ayudarte con tus proyectos! Selecciona uno y conversamos sobre sus tareas y avances.')
        : (contexto?.tema
            ? `¡Vamos con «${contexto.tema}»! Puedo explicártelo paso a paso, proponerte ejercicios y ayudarte a organizar su aprendizaje.`
            : '¡Vamos a aprender! Puedo ayudarte a comprender temas, detectar qué necesitas reforzar y organizar tu tiempo de estudio.');
    const sugerencias = contexto?.seccion === 'estudio'
        ? [
            { etiqueta: 'Planificar mis estudios', texto: 'Ayúdame a planificar mis sesiones de estudio según mis fechas límite y disponibilidad.' },
            { etiqueta: 'Detectar qué debo aprender', texto: 'Ayúdame a identificar qué conocimientos necesito reforzar para mis actividades.' },
            { etiqueta: 'Analizar un taller', texto: 'Quiero adjuntar un taller. Identifica los temas que necesito aprender y las fechas de entrega.' }
        ]
        : [
            { etiqueta: 'Revisar este proyecto', texto: 'Revisa el proyecto que tengo seleccionado y dime cuáles deberían ser mis próximos pasos.' },
            { etiqueta: 'Organizar tareas', texto: 'Ayúdame a organizar las tareas pendientes de este proyecto.' },
            { etiqueta: 'Detectar conocimientos', texto: '¿Qué conocimientos necesito para completar este proyecto?' }
        ];
    const claveContexto = `${contexto?.seccion || 'general'}:${contexto?.proyecto || ''}:${contexto?.tema || ''}`;
    useEffect(() => { if (contexto?.tema) setAbierto(true); }, [contexto?.tema]);

    return (
        <div className={`chatia-flotante${abierto ? ' abierto' : ''}`}>
            <section className="chatia-flotante-panel" aria-label={titulo} aria-hidden={!abierto} hidden={!abierto}>
                <header className="chatia-flotante-cabecera">
                    <div><strong>{titulo}</strong><span>Tu compañero de LearnTrack</span></div>
                    <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar asistente" title="Cerrar">×</button>
                </header>
                <ChatIA key={claveContexto} contexto={contexto} alActualizar={alActualizar} bienvenida={bienvenida} sugerencias={sugerencias} />
            </section>
            <button type="button" className="chatia-flotante-boton" aria-expanded={abierto}
                aria-label={abierto ? 'Cerrar asistente de IA' : 'Abrir asistente de IA'}
                title={abierto ? 'Cerrar asistente' : 'Hablar con Nexo'}
                onClick={() => setAbierto((v) => !v)}>
                {abierto ? '×' : '✦'}
            </button>
        </div>
    );
}
