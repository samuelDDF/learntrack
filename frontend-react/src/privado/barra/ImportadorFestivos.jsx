// Importador de DÍAS FESTIVOS (Nager.Date a través del servidor). Solo SUMA festivos: nunca crea, cambia ni borra
// tareas o eventos. Al cambiar, avisa a la agenda y al panel (evento «festivos-actualizados»).
import { useEffect, useState } from 'react';
import { BotonConfirmar } from '../../comun/ui/BotonConfirmar.jsx';
import { Mensaje, estadoMsg } from '../../comun/ui/Mensaje.jsx';
import { mensajeDeError } from '../../api/cliente.js';
import { festivos as apiFestivos } from '../api.js';
import { emitir, FESTIVOS_ACTUALIZADOS } from '../eventos.js';

const nombresPais = (() => { try { return new Intl.DisplayNames(['es'], { type: 'region' }); } catch { return null; } })();
const nombrePais = (p) => { try { return nombresPais?.of(p.codigo) || p.nombre; } catch { return p.nombre; } };

export function ImportadorFestivos() {
    const anioActual = new Date().getFullYear();
    const [paises, setPaises] = useState(null);                 // null = cargando
    const [pais, setPais] = useState('');
    const [regiones, setRegiones] = useState([]);
    const [region, setRegion] = useState('');
    const [anio, setAnio] = useState(String(anioActual));
    const [importados, setImportados] = useState([]);
    const [estado, setEstado] = useState(estadoMsg());
    const [importando, setImportando] = useState(false);

    // Al abrir el panel: festivos ya importados, países y país sugerido (el último importado o el del navegador)
    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const actuales = await apiFestivos.listar();
                const lista = actuales.ok ? actuales.data.festivos : [];
                if (!vivo) return;
                setImportados(lista);
                const r = await apiFestivos.paises();
                if (!vivo) return;
                if (!r.ok) { setPaises([]); setEstado(estadoMsg(mensajeDeError(r, 'No se pudo cargar la lista de países.'), 'error')); return; }
                const ordenados = r.data.paises.map((p) => ({ codigo: p.codigo, nombre: nombrePais(p) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
                setPaises(ordenados);
                const sugerido = lista.at(-1)?.pais ?? (navigator.language.split('-')[1] ?? '').toUpperCase();
                if (ordenados.some((p) => p.codigo === sugerido)) setPais(sugerido);
            } catch (e) { if (vivo) { setPaises([]); setEstado(estadoMsg(mensajeDeError(e), 'error')); } }
        })();
        return () => { vivo = false; };
    }, []);

    useEffect(() => {
        let vivo = true;
        setRegiones([]); setRegion('');
        if (!pais) return undefined;
        apiFestivos.regiones(pais, anio).then((r) => { if (vivo && r.ok) setRegiones(r.data.regiones); }).catch(() => {});
        return () => { vivo = false; };
    }, [pais, anio]);

    async function importar(e) {
        e.preventDefault();
        if (!pais) { setEstado(estadoMsg('Elige un país.', 'error')); document.getElementById('festivo-pais')?.focus(); return; }
        setImportando(true);
        setEstado(estadoMsg('Buscando feriados…'));
        try {
            const cuerpo = { pais, anio: Number(anio) };
            if (region) cuerpo.region = region;
            const r = await apiFestivos.importar(cuerpo);
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudo importar el calendario.'), 'error')); return; }
            const { añadidos, yaExistian, limite } = r.data;
            const partes = [añadidos ? `Se añadieron ${añadidos} festivo${añadidos === 1 ? '' : 's'} a tu agenda.` : 'No hay novedades.'];
            if (yaExistian) partes.push(`${yaExistian} ya estaba${yaExistian === 1 ? '' : 'n'}.`);
            if (limite) partes.push('Llegaste al máximo de días feriados guardados: quita algunos para importar más.');
            partes.push('Tus actividades no se tocaron.');
            setEstado(estadoMsg(partes.join(' '), limite ? 'error' : 'ok'));
            setImportados(r.data.festivos);
            emitir(FESTIVOS_ACTUALIZADOS, r.data.festivos);
        } catch (err) { setEstado(estadoMsg(mensajeDeError(err), 'error')); } finally { setImportando(false); }
    }

    async function quitarTodos() {
        try {
            const r = await apiFestivos.quitarTodos();
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudieron quitar.'), 'error')); return; }
            setEstado(estadoMsg(`Se quitaron ${r.data.eliminados} días feriados. Tus actividades siguen igual.`, 'ok'));
            setImportados([]);
            emitir(FESTIVOS_ACTUALIZADOS, []);
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); }
    }

    const n = importados.length;
    return (
        <section className="offcanvas-seccion festivos" aria-labelledby="festivos-titulo">
            <h3 id="festivos-titulo">Tu país/ciudad</h3>
            <p className="ayuda">Añade a tu agenda los días feriados de tu país.</p>
            <form className="festivos-form" noValidate onSubmit={importar}>
                <div className="campo">
                    <label htmlFor="festivo-pais">País</label>
                    <select id="festivo-pais" required value={pais} onChange={(e) => setPais(e.target.value)} disabled={paises === null}>
                        <option value="">{paises === null ? 'Cargando países…' : paises.length ? 'Elige un país…' : 'No disponible'}</option>
                        {(paises ?? []).map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
                    </select>
                </div>
                <div className="campo">
                    <label htmlFor="festivo-region">Región o ciudad (opcional)</label>
                    <select id="festivo-region" aria-describedby="festivo-region-ayuda" value={region} onChange={(e) => setRegion(e.target.value)} disabled={regiones.length === 0}>
                        <option value="">Se toma en cuenta el calendario nacional</option>
                        {regiones.map((codigo) => <option key={codigo} value={codigo}>{`${codigo.replace(`${pais}-`, '')} (${codigo})`}</option>)}
                    </select>
                    <small id="festivo-region-ayuda" className="ayuda">Suma también los feriados locales de esa región (estado, provincia o comunidad), si el país los publica.</small>
                </div>
                <div className="campo">
                    <label htmlFor="festivo-anio">Año</label>
                    <select id="festivo-anio" value={anio} onChange={(e) => setAnio(e.target.value)}>
                        {[anioActual - 1, anioActual, anioActual + 1, anioActual + 2].map((a) => <option key={a} value={String(a)}>{a}</option>)}
                    </select>
                </div>
                <button type="submit" className="boton boton-primario" disabled={importando}>Importar feriados</button>
                <Mensaje estado={estado} />
            </form>
            <div className="festivos-pie">
                <p className="festivos-resumen">{n ? `Tienes ${n} festivo${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}.` : 'Todavía no has importado el calendario de tu país.'}</p>
                {n ? <BotonConfirmar className="boton boton-peligro boton-mini" textoConfirmar="¿Quitar todos los días feriados?" alConfirmar={quitarTodos}>Quitar feriados importados</BotonConfirmar> : null}
            </div>
        </section>
    );
}
