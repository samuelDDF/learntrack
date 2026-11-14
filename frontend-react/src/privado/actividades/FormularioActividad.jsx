// Ventana para crear, editar y eliminar una actividad (COMPARTIDA por Mi panel, Mi agenda y Proyectos).
// Mismos campos, reglas y contrato que el formulario original.
import { useCallback, useId, useState } from 'react';
import { TIPOS, NOMBRE_TIPO, EXIGENCIAS, NOMBRE_EXIGENCIA, ESTADOS, NOMBRE_ESTADO, TIPOS_RECARGA } from '@compartido/catalogos.js';
import { aMinutos, horasEntre } from '@compartido/fechas.js';
import { Dialogo } from '../../comun/ui/Dialogo.jsx';
import { BotonConfirmar } from '../../comun/ui/BotonConfirmar.jsx';
import { hoyISO } from '../../comun/fechas-locales.js';
import { mensajeDeError } from '../../api/cliente.js';
import { actividades as apiActividades } from '../api.js';
import { useEliminarActividad } from './eliminar.js';

const NOMBRE_EXIGENCIA_FORM = { ...NOMBRE_EXIGENCIA, '-2': 'Recarga de energía' };

function valoresIniciales(actividad, previos) {
    const fecha = previos.fecha || hoyISO();
    const a = actividad ?? {
        id: '', titulo: '', tipo: 'estudio', exigencia: 2, horas: 1, estado: 'pendiente', proyecto: previos.proyecto || '', fija: false,
        fecha_inicio: fecha, fecha_fin: fecha, hora_inicio: previos.hora_inicio || null, hora_fin: null
    };
    return {
        id: a.id ?? '', titulo: a.titulo ?? '', tipo: a.tipo, exigencia: String(a.exigencia), inicio: a.fecha_inicio, fin: a.fecha_fin,
        vence: a.fecha_vencimiento || '', horaInicio: a.hora_inicio || '', horaFin: a.hora_fin || '', horas: String(a.horas),
        estado: a.estado, proyecto: a.proyecto ?? '', fija: a.fija === true
    };
}

function Campo({ id, etiqueta, opcional, ancho, children }) {
    return (
        <div className={`campo${ancho ? ' campo-ancho' : ''}`}>
            <label htmlFor={id}>{etiqueta}{opcional ? <span className="opcional"> ({opcional})</span> : null}</label>
            {children}
        </div>
    );
}

function Formulario({ actividad, previos, proyectos, alGuardado, alCerrar }) {
    const [v, setV] = useState(() => valoresIniciales(actividad, previos));
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const idLista = useId();
    const eliminar = useEliminarActividad(alGuardado);
    const editando = Boolean(actividad);
    const estadoOriginal = actividad?.estado ?? null;

    const cambiar = (campo) => (e) => {
        const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        setV((prev) => {
            const sig = { ...prev, [campo]: valor };
            if (campo === 'inicio' && sig.fin < sig.inicio) sig.fin = sig.inicio;
            if (campo === 'tipo') {
                if (TIPOS_RECARGA.includes(valor)) sig.exigencia = '-2';
                else if (sig.exigencia === '-2') sig.exigencia = '2';
            }
            if ((campo === 'horaInicio' || campo === 'horaFin') && sig.horaInicio && sig.horaFin && aMinutos(sig.horaFin) > aMinutos(sig.horaInicio)) {
                sig.horas = String(horasEntre(sig.horaInicio, sig.horaFin));
            }
            return sig;
        });
    };

    async function guardar(e) {
        e.preventDefault();
        setError('');
        const cuerpo = {
            titulo: v.titulo, tipo: v.tipo, exigencia: Number(v.exigencia), horas: Number(v.horas),
            fecha_inicio: v.inicio, fecha_fin: v.fin || v.inicio, hora_inicio: v.horaInicio, hora_fin: v.horaFin,
            estado: v.estado, proyecto: v.proyecto, fija: v.fija, fecha_vencimiento: v.vence
        };
        // Al editar, el estado solo se envía si cambió: así el auto-estado («en proceso» en su horario) sigue activo
        if (editando && cuerpo.estado === estadoOriginal) delete cuerpo.estado;
        if (!cuerpo.titulo.trim()) { setError('El título es obligatorio.'); document.getElementById('f-titulo')?.focus(); return; }
        if (!cuerpo.fecha_inicio) { setError('Elige la fecha de inicio.'); return; }
        setGuardando(true);
        try {
            const res = editando ? await apiActividades.editar(v.id, cuerpo) : await apiActividades.crear(cuerpo);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo guardar.')); return; }
            alGuardado(res.data);
            alCerrar();
        } catch (err) { setError(mensajeDeError(err)); } finally { setGuardando(false); }
    }

    return (
        <form id="form-actividad" className="formulario-dialogo" noValidate onSubmit={guardar}>
            <h3 id="modal-titulo">{editando ? 'Editar actividad' : 'Nueva actividad'}</h3>
            <Campo id="f-titulo" etiqueta="Título" ancho>
                <input type="text" id="f-titulo" maxLength={100} required value={v.titulo} onChange={cambiar('titulo')} autoFocus />
            </Campo>
            <Campo id="f-tipo" etiqueta="Tipo">
                <select id="f-tipo" value={v.tipo} onChange={cambiar('tipo')}>
                    {TIPOS.map((t) => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
                </select>
            </Campo>
            <Campo id="f-exigencia" etiqueta="Exigencia">
                <select id="f-exigencia" value={v.exigencia} onChange={cambiar('exigencia')}>
                    {EXIGENCIAS.map((x) => <option key={x} value={String(x)}>{NOMBRE_EXIGENCIA_FORM[x]}</option>)}
                </select>
            </Campo>
            <Campo id="f-inicio" etiqueta="Fecha de inicio">
                <input type="date" id="f-inicio" required value={v.inicio} onChange={cambiar('inicio')} />
            </Campo>
            <Campo id="f-fin" etiqueta="Fecha de fin">
                <input type="date" id="f-fin" value={v.fin} onChange={cambiar('fin')} />
            </Campo>
            <Campo id="f-hora-inicio" etiqueta="Hora de inicio">
                <input type="time" id="f-hora-inicio" value={v.horaInicio} onChange={cambiar('horaInicio')} />
            </Campo>
            <Campo id="f-hora-fin" etiqueta="Hora de fin">
                <input type="time" id="f-hora-fin" value={v.horaFin} onChange={cambiar('horaFin')} />
            </Campo>
            <Campo id="f-horas" etiqueta="Horas">
                <input type="number" id="f-horas" min="0.5" max="12" step="0.5" value={v.horas} onChange={cambiar('horas')} />
            </Campo>
            <Campo id="f-estado" etiqueta="Estado">
                <select id="f-estado" value={v.estado} onChange={cambiar('estado')}>
                    {ESTADOS.map((x) => <option key={x} value={x}>{NOMBRE_ESTADO[x]}</option>)}
                </select>
            </Campo>
            <Campo id="f-vence" etiqueta="Vence el" opcional="opcional: fecha límite o de entrega">
                <input type="date" id="f-vence" value={v.vence} onChange={cambiar('vence')} />
            </Campo>
            <Campo id="f-proyecto" etiqueta="Proyecto" opcional="opcional, agrupa en Proyectos">
                <input type="text" id="f-proyecto" maxLength={60} list={idLista} value={v.proyecto} onChange={cambiar('proyecto')} />
                <datalist id={idLista}>{proyectos.map((p) => <option key={p} value={p} />)}</datalist>
            </Campo>
            <div className="campo campo-ancho campo-check">
                <input type="checkbox" id="f-fija" checked={v.fija} onChange={cambiar('fija')} />
                <label htmlFor="f-fija">Fija<span className="opcional"> (el asistente no la moverá al liberar días o reorganizar)</span></label>
            </div>
            <p id="modal-error" className="error-formulario campo-ancho" role="alert">{error}</p>
            <div className="modal-pie campo-ancho">
                {editando ? (
                    <BotonConfirmar id="btn-eliminar" textoConfirmar="¿Seguro? Confirmar" ms={60000}
                        alConfirmar={async () => {
                            const fallo = await eliminar({ id: v.id, titulo: v.titulo });
                            if (fallo) setError(fallo); else alCerrar();
                        }}>Eliminar</BotonConfirmar>
                ) : null}
                <span className="espaciador" />
                <button type="button" className="boton" id="btn-cancelar" onClick={alCerrar}>Cancelar</button>
                <button type="submit" className="boton boton-primario" id="btn-guardar" disabled={guardando} aria-busy={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
        </form>
    );
}

/**
 * Hook del formulario. Devuelve { abrir(actividad?, previos?), formulario (JSX que hay que pintar), abierto }.
 * previos: { fecha, hora_inicio, proyecto } para una actividad nueva.
 */
export function useFormularioActividad({ alCambiar, proyectos = [] }) {
    const [estado, setEstado] = useState({ abierto: false, actividad: null, previos: {}, clave: 0 });
    const abrir = useCallback((actividad = null, previos = {}) => {
        setEstado((e) => ({ abierto: true, actividad, previos, clave: e.clave + 1 }));
    }, []);
    const cerrar = useCallback(() => setEstado((e) => ({ ...e, abierto: false })), []);
    const formulario = (
        <Dialogo abierto={estado.abierto} alCerrar={cerrar} id="modal-actividad" className="dialogo" aria-labelledby="modal-titulo">
            <Formulario key={estado.clave} actividad={estado.actividad} previos={estado.previos} proyectos={proyectos}
                alGuardado={alCambiar} alCerrar={cerrar} />
        </Dialogo>
    );
    return { abrir, formulario, abierto: estado.abierto };
}
