// /admin — Panel de administración (v3.13). Solo lo ve la cuenta de administración (RutaAdmin en el navegador; el
// servidor responde 404 a cualquier otra en la página y en /api/admin). Diseño propio y mínimo: no usa el menú de la
// zona privada (la cuenta de administración no tiene agenda, IA, etc.).
//   · Resumen: totales y comprobación de integridad (exactamente un administrador e índice único activo).
//   · Cuentas: buscar por nombre, correo o id; filtrar por estado; paginar; abrir la ficha de cada una.
//   · Auditoría: acciones administrativas registradas.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth.js';
import { mensajeDeError } from '../../../services/errores.js';
import { Cargando } from '../../../components/common/Cargando.jsx';
import { admin } from '../services/admin.service.js';
import { DetalleCuenta } from '../components/DetalleCuenta.jsx';
import { ACCIONES_AUDITORIA, FILTROS, estadoCuenta, fecha, fechaHora } from '../components/formato.js';
import '../admin.css';

function Resumen({ datos }) {
    if (!datos) return <Cargando texto="Cargando resumen…" />;
    const ok = datos.integridad.unico && datos.integridad.indiceUnico;
    const tarjetas = [
        ['Cuentas', datos.total], ['Activas (7 días)', datos.activas7d], ['Nuevas (7 días)', datos.nuevas7d],
        ['Suspendidas', datos.suspendidas], ['Sin verificar', datos.sinVerificar], ['Menores sin autorización', datos.menoresPendientes]
    ];
    return (
        <section aria-labelledby="adm-resumen-titulo">
            <h2 id="adm-resumen-titulo" className="adm-oculto">Resumen</h2>
            <ul className="adm-tarjetas">
                {tarjetas.map(([t, n]) => <li key={t}><span className="adm-numero">{n}</span><span>{t}</span></li>)}
            </ul>
            <p className={`adm-integridad ${ok ? 'adm-integridad-ok' : 'adm-integridad-mal'}`} role="status">
                {ok ? '✔ Integridad: hay exactamente un administrador y la base de datos impide crear otro.'
                    : `✖ Integridad: ${datos.integridad.administradores} administrador(es); índice único ${datos.integridad.indiceUnico ? 'activo' : 'NO encontrado'}. Revisa con «npm run admin:verificar».`}
            </p>
        </section>
    );
}

function Cuentas({ alCambiarResumen }) {
    const [filtro, setFiltro] = useState({ q: '', estado: '', pagina: 1 });
    const [texto, setTexto] = useState('');
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');
    const [abierta, setAbierta] = useState(null);

    const cargar = useCallback(async () => {
        setError('');
        try {
            const r = await admin.cuentas(filtro);
            if (r.ok) setDatos(r.data); else setError(mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
    }, [filtro]);
    useEffect(() => { cargar(); }, [cargar]);

    const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
    const buscar = (ev) => { ev.preventDefault(); setAviso(''); setFiltro((f) => ({ ...f, q: texto.trim(), pagina: 1 })); };
    const alCambiar = (tipo, mensaje) => { if (tipo === 'eliminada') setAviso(mensaje); cargar(); alCambiarResumen(); };

    return (
        <section aria-labelledby="adm-cuentas-titulo" className="adm-bloque">
            <h2 id="adm-cuentas-titulo">Cuentas</h2>
            <form className="adm-filtros" role="search" onSubmit={buscar}>
                <label htmlFor="adm-buscar" className="adm-oculto">Buscar por nombre, correo o id</label>
                <input id="adm-buscar" type="search" maxLength={80} placeholder="Nombre, correo o id…" value={texto} onChange={(e) => setTexto(e.target.value)} />
                <label htmlFor="adm-filtro" className="adm-oculto">Estado</label>
                <select id="adm-filtro" value={filtro.estado} onChange={(e) => setFiltro((f) => ({ ...f, estado: e.target.value, pagina: 1 }))}>
                    {FILTROS.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
                </select>
                <button type="submit" className="adm-btn">Buscar</button>
            </form>
            {aviso ? <p className="adm-ok" role="status">{aviso}</p> : null}
            {error ? <p className="adm-error" role="alert">{error}</p> : null}
            {!datos && !error ? <Cargando texto="Cargando cuentas…" /> : null}
            {datos ? (
                <>
                    <p className="adm-total">{datos.total} {datos.total === 1 ? 'cuenta' : 'cuentas'}{filtro.q ? ` para «${filtro.q}»` : ''}</p>
                    {datos.cuentas.length ? (
                        <ul className="adm-lista">
                            {datos.cuentas.map((c) => {
                                const est = estadoCuenta(c);
                                return (
                                    <li key={c.id}>
                                        <button type="button" className="adm-fila" onClick={() => setAbierta(c.id)} aria-label={`Ver la cuenta de ${c.nombre}`}>
                                            <span className="adm-fila-nombre">{c.nombre}<span className="adm-mono">{c.email}</span></span>
                                            <span className="adm-fila-dato"><span className="adm-etq">Registro</span>{fecha(c.creado)}</span>
                                            <span className="adm-fila-dato"><span className="adm-etq">Última actividad</span>{c.ultimoAcceso ? fecha(c.ultimoAcceso) : 'Nunca'}</span>
                                            <span className={`adm-estado ${est.clase}`}>{est.texto}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : <p className="adm-vacio">No hay cuentas con ese criterio.</p>}
                    {paginas > 1 ? (
                        <nav className="adm-paginas" aria-label="Páginas">
                            <button type="button" className="adm-btn adm-btn-sec" disabled={filtro.pagina <= 1} onClick={() => setFiltro((f) => ({ ...f, pagina: f.pagina - 1 }))}>Anterior</button>
                            <span>Página {filtro.pagina} de {paginas}</span>
                            <button type="button" className="adm-btn adm-btn-sec" disabled={filtro.pagina >= paginas} onClick={() => setFiltro((f) => ({ ...f, pagina: f.pagina + 1 }))}>Siguiente</button>
                        </nav>
                    ) : null}
                </>
            ) : null}
            {abierta ? <DetalleCuenta idCuenta={abierta} alCerrar={() => setAbierta(null)} alCambiar={alCambiar} /> : null}
        </section>
    );
}

function Auditoria() {
    const [pagina, setPagina] = useState(1);
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let vivo = true;
        admin.auditoria(pagina).then((r) => { if (vivo) (r.ok ? setDatos(r.data) : setError(mensajeDeError(r))); }).catch((e) => { if (vivo) setError(mensajeDeError(e)); });
        return () => { vivo = false; };
    }, [pagina]);
    const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
    return (
        <section aria-labelledby="adm-auditoria-titulo" className="adm-bloque">
            <h2 id="adm-auditoria-titulo">Auditoría</h2>
            <p className="adm-nota">Cada acción administrativa queda registrada (se conserva 2 años). No incluye contraseñas ni el correo de cuentas eliminadas.</p>
            {error ? <p className="adm-error" role="alert">{error}</p> : null}
            {!datos && !error ? <Cargando texto="Cargando auditoría…" /> : null}
            {datos?.acciones.length ? (
                <ul className="adm-historial adm-auditoria">
                    {datos.acciones.map((a) => (
                        <li key={a.id}>
                            <span className="adm-auditoria-fecha">{fechaHora(a.fecha)}</span>
                            <span><strong>{ACCIONES_AUDITORIA[a.accion] ?? a.accion}</strong>{a.cuentaId ? <> · cuenta <span className="adm-mono">{a.cuentaId}</span></> : null}
                                {a.detalle?.motivo ? <> — {a.detalle.motivo}</> : null}
                                {a.detalle?.hasta ? <> (hasta {fecha(a.detalle.hasta)})</> : null}
                                {a.detalle?.origen === 'script' ? <> · desde el script del servidor</> : null}</span>
                        </li>
                    ))}
                </ul>
            ) : datos ? <p className="adm-vacio">Aún no hay acciones registradas.</p> : null}
            {paginas > 1 ? (
                <nav className="adm-paginas" aria-label="Páginas de la auditoría">
                    <button type="button" className="adm-btn adm-btn-sec" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                    <span>Página {pagina} de {paginas}</span>
                    <button type="button" className="adm-btn adm-btn-sec" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
                </nav>
            ) : null}
        </section>
    );
}

export default function PanelAdmin() {
    const { usuario, cerrarSesion } = useAuth();
    const [vista, setVista] = useState('cuentas');
    const [resumen, setResumen] = useState(null);
    const [error, setError] = useState('');
    const [saliendo, setSaliendo] = useState(false);

    useEffect(() => {
        document.title = 'Administración | LearnTrack';
        document.body.classList.add('pagina-admin');
        return () => document.body.classList.remove('pagina-admin');
    }, []);
    const cargarResumen = useCallback(() => {
        admin.resumen().then((r) => (r.ok ? setResumen(r.data) : setError(mensajeDeError(r)))).catch((e) => setError(mensajeDeError(e)));
    }, []);
    useEffect(() => { cargarResumen(); }, [cargarResumen]);

    return (
        <div className="adm">
            <header className="adm-cabecera">
                <div className="adm-cabecera-dentro">
                    <p className="adm-marca">LearnTrack <span>Administración</span></p>
                    <div className="adm-sesion">
                        <span className="adm-quien">{usuario?.nombre}</span>
                        <button type="button" className="adm-btn adm-btn-claro" disabled={saliendo} onClick={async () => { setSaliendo(true); await cerrarSesion({ destino: '/' }); }}>Cerrar sesión</button>
                    </div>
                </div>
            </header>
            <main id="contenido" className="adm-main">
                <h1 className="adm-titulo">Panel de administración</h1>
                {error ? <p className="adm-error" role="alert">{error}</p> : null}
                <Resumen datos={resumen} />
                <div className="adm-pestanas" role="tablist" aria-label="Secciones">
                    <button type="button" role="tab" aria-selected={vista === 'cuentas'} className="adm-pestana" onClick={() => setVista('cuentas')}>Cuentas</button>
                    <button type="button" role="tab" aria-selected={vista === 'auditoria'} className="adm-pestana" onClick={() => setVista('auditoria')}>Auditoría</button>
                </div>
                {vista === 'cuentas' ? <Cuentas alCambiarResumen={cargarResumen} /> : <Auditoria />}
            </main>
        </div>
    );
}
