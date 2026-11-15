// Una actividad de «Tu día de hoy» (Mi panel): título, detalle, editar y eliminar (con confirmación en dos clics).
import { useRef } from 'react';
import { NOMBRE_TIPO, NOMBRE_EXIGENCIA, TIPOS_RECARGA } from '@compartido/catalogos.js';
import { textoHorario } from '@compartido/fechas.js';
import { esperarSalida } from '../../../utils/animaciones.js';
import { BotonConfirmar } from '../../../components/common/BotonConfirmar.jsx';

export function FilaActividad({ a, alEditar, alEliminar }) {
    const clase = a.exigencia === 3 ? 'exig-alta' : TIPOS_RECARGA.includes(a.tipo) ? 'recarga' : '';
    const rango = a.fecha_fin !== a.fecha_inicio ? ` · ${a.fecha_inicio.slice(5)} → ${a.fecha_fin.slice(5)}` : '';
    const hora = a.hora_inicio ? ` · ${textoHorario(a)}` : '';
    const detalle = `${NOMBRE_TIPO[a.tipo].toUpperCase()} • ${a.horas} h${hora}${rango} (Exigencia: ${NOMBRE_EXIGENCIA[a.exigencia]})${a.estado === 'completado' ? ' • completada' : ''}${a.repaso ? ' • 🧠 repaso' : ''}`;
    const fila = useRef(null);
    // Al eliminar: la fila sale deslizándose y LUEGO se borra; si el borrado falla, vuelve a su sitio
    const eliminarConSalida = async (x) => {
        const salida = await esperarSalida(fila.current);
        const ok = await alEliminar(x);
        if (ok === false) salida?.cancel();
    };
    return (
        <div ref={fila} className={`act-dia ${clase}`}>
            <div className="act-info">
                <strong className={a.estado === 'completado' ? 'tachado' : ''}>{a.titulo}</strong>
                <small>{detalle}</small>
            </div>
            <div className="act-acciones">
                <button type="button" className="btn-icono" aria-label={`Editar ${a.titulo}`} onClick={() => alEditar(a)}>✏️</button>
                <BotonConfirmar className="btn-icono" aria-label={`Eliminar ${a.titulo}`} alConfirmar={() => eliminarConSalida(a)}>🗑️</BotonConfirmar>
            </div>
        </div>
    );
}
