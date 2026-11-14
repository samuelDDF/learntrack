// Secciones de Configuración. Cada una usa PUT /api/perfil (u otra ruta de /api/perfil) con el mismo contrato que
// la interfaz original, y muestra el resultado con un mensaje de estado accesible.
import { useEffect, useRef, useState } from 'react';
import { Dialogo } from '../../../comun/ui/Dialogo.jsx';
import { Mensaje, estadoMsg } from '../../../comun/ui/Mensaje.jsx';
import { aplicarApariencia, olvidarApariencia } from '../../../comun/tema.js';
import { actualizarUsuario } from '../../../comun/sesion.js';
import { mensajeDeError, navegador } from '../../../api/cliente.js';
import { perfil as apiPerfil } from '../../api.js';
import { Avatar } from '../../barra/Avatar.jsx';
import { vocesDisponibles, hablar, callar, sintesisDisponible, fijarVozPreferida } from '../../asistente/voz.js';
import { reducirImagen, esImagenAceptada } from './imagenes.js';

const aparienciaDe = (p) => ({ temaSeleccionado: p.temaSeleccionado, variablesTema: p.variablesTema, imagenFondoUrl: p.imagenFondoUrl });

// ================================================================ 1. Información básica
export function SeccionInformacion({ perfil, pintarTodo }) {
    const [nombre, setNombre] = useState(perfil.nombre);
    const [email, setEmail] = useState(perfil.email);
    const [actual, setActual] = useState('');
    const [estado, setEstado] = useState(estadoMsg());
    const [estadoAvatar, setEstadoAvatar] = useState(estadoMsg());
    const [guardando, setGuardando] = useState(false);
    const sensible = email.trim().toLowerCase() !== perfil.email;

    async function guardar(ev) {
        ev.preventDefault();
        setEstado(estadoMsg());
        const cuerpo = {};
        if (nombre.trim() !== perfil.nombre) cuerpo.nombre = nombre.trim();
        if (email.trim().toLowerCase() !== perfil.email) cuerpo.email = email.trim();
        if (Object.keys(cuerpo).length === 0) { setEstado(estadoMsg('No hay cambios que guardar.')); return; }
        if (cuerpo.email !== undefined) {
            if (!actual) { document.getElementById('pw-actual')?.focus(); setEstado(estadoMsg('Escribe tu contraseña actual para cambiar el correo.', 'error')); return; }
            cuerpo.passwordActual = actual;
        }
        setGuardando(true);
        try {
            const r = await apiPerfil.guardar(cuerpo);
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudo guardar.'), 'error')); return; }
            pintarTodo(r.data);
            setNombre(r.data.perfil.nombre); setEmail(r.data.perfil.email); setActual('');
            setEstado(estadoMsg('Cambios guardados.', 'ok'));
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); } finally { setGuardando(false); }
    }

    async function subirAvatar(ev) {
        const archivo = ev.target.files?.[0];
        ev.target.value = '';
        if (!archivo) return;
        if (!esImagenAceptada(archivo)) { setEstadoAvatar(estadoMsg('Elige una imagen JPG, PNG o WebP.', 'error')); return; }
        if (archivo.size > 15 * 1024 * 1024) { setEstadoAvatar(estadoMsg('La imagen es demasiado grande (máximo 15 MB).', 'error')); return; }
        setEstadoAvatar(estadoMsg('Subiendo…'));
        try {
            const blob = await reducirImagen(archivo, { lado: 256, cuadrado: true });
            const r = await apiPerfil.subirAvatar(blob);
            if (!r.ok) { setEstadoAvatar(estadoMsg(mensajeDeError(r, 'No se pudo subir la foto.'), 'error')); return; }
            pintarTodo(r.data);
            setEstadoAvatar(estadoMsg('Foto actualizada.', 'ok'));
        } catch { setEstadoAvatar(estadoMsg('No pude leer esa imagen. Prueba con otra.', 'error')); }
    }
    async function quitarAvatar() {
        const r = await apiPerfil.quitarAvatar().catch(() => null);
        if (!r?.ok) { setEstadoAvatar(estadoMsg(mensajeDeError(r, 'No se pudo quitar la foto.'), 'error')); return; }
        pintarTodo(r.data);
        setEstadoAvatar(estadoMsg('Foto eliminada.', 'ok'));
    }

    return (
        <>
            <h2>Información básica</h2>
            <p className="panel-intro">Tu foto, tu nombre y tu correo. Para cambiar el correo te pedimos la contraseña actual.</p>
            <div className="avatar-bloque">
                <Avatar usuario={perfil} clase="avatar-grande" alt="Tu foto de perfil" />
                <div className="avatar-acciones">
                    <label className="boton" htmlFor="avatar-archivo">Cambiar foto</label>
                    <input type="file" id="avatar-archivo" className="solo-lectores" accept="image/png,image/jpeg,image/webp" onChange={subirAvatar} />
                    {perfil.avatarUrl ? <button type="button" className="boton boton-peligro" id="btn-avatar-quitar" onClick={quitarAvatar}>Quitar foto</button> : null}
                    <p className="ayuda" id="avatar-ayuda">JPG, PNG o WebP. La reducimos a 256 × 256 px antes de subirla.</p>
                    <Mensaje estado={estadoAvatar} id="avatar-estado" />
                </div>
            </div>
            <form id="form-perfil" className="form-perfil" noValidate autoComplete="off" onSubmit={guardar}>
                <div className="campo">
                    <label htmlFor="perfil-nombre">Nombre de usuario</label>
                    <input id="perfil-nombre" name="nombre" type="text" minLength={2} maxLength={60} required autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="campo">
                    <label htmlFor="perfil-email">Correo electrónico</label>
                    <input id="perfil-email" name="email" type="email" maxLength={254} required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {sensible ? (
                    <div className="campo campo-actual" id="campo-actual">
                        <label htmlFor="pw-actual">Contraseña actual <span className="opcional">(necesaria para cambiar el correo)</span></label>
                        <input id="pw-actual" type="password" maxLength={128} autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
                    </div>
                ) : null}
                <Mensaje estado={estado} id="perfil-estado" />
                <div className="acciones-form">
                    <button type="submit" className="boton boton-primario" id="btn-guardar-perfil" disabled={guardando} aria-busy={guardando}>Guardar cambios</button>
                </div>
            </form>
        </>
    );
}

// ================================================================ 2. Voz e identidad de la IA
export function SeccionVoz({ perfil, fijarPerfil }) {
    const [nombreIA, setNombreIA] = useState(perfil.nombreIA ?? 'Nexo');
    const [estadoNombre, setEstadoNombre] = useState(estadoMsg());
    const [voces, setVoces] = useState(null);
    const [voz, setVoz] = useState(perfil.vozAsistente ?? '');
    const [prueba, setPrueba] = useState('Hola, soy tu asistente de LearnTrack. Así sonaré cuando te lea las respuestas.');
    const [hablando, setHablando] = useState(false);
    const [estadoVoz, setEstadoVoz] = useState(estadoMsg());
    const [guardandoVoz, setGuardandoVoz] = useState(false);
    const disponible = sintesisDisponible();

    useEffect(() => {
        if (!disponible) return undefined;
        let vivo = true;
        vocesDisponibles().then((v) => { if (vivo) setVoces(v); });
        return () => { vivo = false; callar(); };
    }, [disponible]);

    async function guardarNombre(ev) {
        ev.preventDefault();
        try {
            const r = await apiPerfil.guardar({ nombreIA: nombreIA.trim() || 'Nexo' });
            if (!r.ok) { setEstadoNombre(estadoMsg(mensajeDeError(r, 'No se pudo guardar el nombre.'), 'error')); return; }
            fijarPerfil(r.data.perfil);
            setNombreIA(r.data.perfil.nombreIA);
            actualizarUsuario({ nombreIA: r.data.perfil.nombreIA });
            setEstadoNombre(estadoMsg(`Listo: el asistente se presentará como «${r.data.perfil.nombreIA}».`, 'ok'));
        } catch (e) { setEstadoNombre(estadoMsg(mensajeDeError(e), 'error')); }
    }
    async function probar() {
        if (hablando) { callar(); return; }
        setHablando(true);
        try { await hablar(prueba || 'Hola, soy tu asistente de LearnTrack.', { voz }); } finally { setHablando(false); }
    }
    async function guardarVoz() {
        setGuardandoVoz(true);
        try {
            const r = await apiPerfil.guardar({ vozAsistente: voz });
            if (!r.ok) { setEstadoVoz(estadoMsg(mensajeDeError(r, 'No se pudo guardar la voz.'), 'error')); return; }
            fijarPerfil(r.data.perfil);
            fijarVozPreferida(r.data.perfil.vozAsistente);
            actualizarUsuario({ vozAsistente: r.data.perfil.vozAsistente });
            setEstadoVoz(estadoMsg(r.data.perfil.vozAsistente ? `Voz guardada: ${r.data.perfil.vozAsistente}.` : 'Voz guardada: automática.', 'ok'));
        } catch (e) { setEstadoVoz(estadoMsg(mensajeDeError(e), 'error')); } finally { setGuardandoVoz(false); }
    }

    const es = (voces ?? []).filter((v) => v.lang.startsWith('es'));
    const otras = (voces ?? []).filter((v) => !v.lang.startsWith('es'));
    const guardada = perfil.vozAsistente ?? '';
    const guardadaAusente = guardada && voces && !voces.some((v) => v.name === guardada);
    const opcion = (v) => <option key={v.name} value={v.name}>{`${v.name} (${v.lang})${v.localService ? '' : ' · en línea'}`}</option>;
    return (
        <>
            <h2>Voz e identidad de la IA</h2>
            <p className="panel-intro">El nombre con el que se presenta tu asistente y la voz con la que te lee sus respuestas (botón «🔊 Leer respuestas» o «🗣 Conversación por voz» del chat). Las voces son las que trae tu sistema y tu navegador, así que pueden cambiar de un dispositivo a otro.</p>
            {!disponible ? <p className="nota-modo" id="voz-no-disponible" role="note">Este navegador no puede leer en voz alta (speechSynthesis). Prueba con Chrome, Edge o Safari.</p> : null}
            <form className="voz-bloque nombre-ia" id="form-nombre-ia" noValidate onSubmit={guardarNombre}>
                <div className="campo">
                    <label htmlFor="nombre-ia">Nombre del asistente</label>
                    <div className="fila-en-linea">
                        <input id="nombre-ia" type="text" minLength={1} maxLength={30} autoComplete="off" placeholder="Nexo" value={nombreIA} onChange={(e) => setNombreIA(e.target.value)} />
                        <button type="submit" className="boton boton-primario" id="btn-nombre-ia">Guardar nombre</button>
                    </div>
                    <small className="ayuda">Así se presentará en el chat. «Nexo» es el nombre predeterminado.</small>
                </div>
                <Mensaje estado={estadoNombre} id="nombre-ia-estado" />
            </form>
            <div className="voz-bloque">
                <div className="campo">
                    <label htmlFor="voz-select">Voz del asistente</label>
                    <select id="voz-select" value={voz} disabled={!disponible} onChange={(e) => setVoz(e.target.value)}>
                        <option value="">Automática (la primera voz en español)</option>
                        {es.length ? <optgroup label="Español">{es.map(opcion)}</optgroup> : null}
                        {otras.length ? <optgroup label="Otros idiomas">{otras.map(opcion)}</optgroup> : null}
                        {guardadaAusente ? <option value={guardada}>{`${guardada} (no disponible en este dispositivo)`}</option> : null}
                    </select>
                    <small className="ayuda" id="voz-ayuda">
                        {!disponible ? 'Se guarda en tu cuenta.' : voces === null ? 'Buscando voces…' : voces.length ? `Hay ${voces.length} voces en este dispositivo. Se guarda en tu cuenta.` : 'Tu navegador no ofrece voces todavía; se usará la voz por defecto.'}
                    </small>
                </div>
                <div className="campo">
                    <label htmlFor="voz-prueba">Frase de prueba</label>
                    <input id="voz-prueba" type="text" maxLength={200} value={prueba} disabled={!disponible} onChange={(e) => setPrueba(e.target.value)} />
                </div>
                <div className="acciones-form">
                    <button type="button" className="boton" id="btn-voz-probar" disabled={!disponible} onClick={probar}>{hablando ? '■ Detener' : '▶ Probar voz'}</button>
                    <button type="button" className="boton boton-primario" id="btn-voz-guardar" disabled={guardandoVoz} aria-busy={guardandoVoz} onClick={guardarVoz}>Guardar voz</button>
                </div>
                <Mensaje estado={estadoVoz} id="voz-estado" />
            </div>
        </>
    );
}

// ================================================================ 3. Estética
const TEMAS = [
    { id: 'tech-focus', nombre: 'Tema Base', desc: <>Azul eléctrico sobre fondo claro: el aspecto de siempre. <em>(Por defecto)</em></> },
    { id: 'moderno', nombre: 'Moderno', desc: 'Violeta y cian con acento coral, esquinas más redondeadas.' },
    { id: 'oscuro-profundo', nombre: 'Oscuro Profundo', desc: 'Negro puro con azul claro. Ideal para pantallas OLED y de noche.' },
    { id: 'futurista', nombre: 'Futurista', desc: 'Azul medianoche con neón cian, magenta y amarillo.' },
    { id: 'zen-calm', nombre: 'Zen & Calm', desc: 'Grises suaves con toques verde oliva y durazno.' },
    { id: 'oscuro', nombre: 'Oscuro elegante', desc: 'Azul noche con cian y violeta.' }
];

function Muestras({ colores }) {
    // Sin colores: las muestras toman los del tema (CSS). Con colores (Mi paleta): CSSOM vía style de React.
    return (
        <span className="tema-muestra" aria-hidden="true">
            {['sw-fondo', 'sw-primario', 'sw-secundario', 'sw-acento'].map((c, i) => <i key={c} className={`sw ${c}`} style={colores?.[i] ? { background: colores[i] } : undefined} />)}
        </span>
    );
}

export function SeccionEstetica({ perfil, pintarTodo, fijarPerfil }) {
    const [estadoTema, setEstadoTema] = useState(estadoMsg());
    const [semilla, setSemilla] = useState('#2563eb');
    const [propuesta, setPropuesta] = useState(null);
    const [estadoPaleta, setEstadoPaleta] = useState(estadoMsg());
    const [generando, setGenerando] = useState(false);
    const [estadoFondo, setEstadoFondo] = useState(estadoMsg());
    const [temaElegido, setTemaElegido] = useState(perfil.temaSeleccionado);
    const guardadaRef = useRef(aparienciaDe(perfil));
    guardadaRef.current = aparienciaDe(perfil);
    const vistaPrevia = useRef(false);

    // Si se sale de la pestaña con una vista previa de paleta sin guardar, vuelve la apariencia guardada
    useEffect(() => () => { if (vistaPrevia.current) aplicarApariencia(guardadaRef.current); }, []);

    async function elegirTema(id) {
        const anterior = aparienciaDe(perfil);
        vistaPrevia.current = false; setPropuesta(null);
        setTemaElegido(id);
        aplicarApariencia({ ...anterior, temaSeleccionado: id, variablesTema: id === 'personalizado' ? perfil.variablesTema : null });
        setEstadoTema(estadoMsg('Guardando…'));
        try {
            const r = await apiPerfil.guardar({ temaSeleccionado: id });
            if (!r.ok) throw new Error(r.data.error);
            fijarPerfil(r.data.perfil);
            aplicarApariencia(aparienciaDe(r.data.perfil));
            setEstadoTema(estadoMsg('Tema guardado en tu cuenta.', 'ok'));
        } catch {
            aplicarApariencia(anterior);                  // si falla, vuelve al anterior
            setTemaElegido(anterior.temaSeleccionado);
            setEstadoTema(estadoMsg('No se pudo guardar el tema. Se restauró el anterior.', 'error'));
        }
    }

    // Paleta con IA: el navegador pide al servidor POST /api/perfil/paleta y el servidor consulta a Colormind
    async function generar(ev) {
        ev.preventDefault();
        setGenerando(true);
        setEstadoPaleta(estadoMsg('Generando paleta…'));
        try {
            const r = await apiPerfil.paleta(semilla);
            if (!r.ok) { setEstadoPaleta(estadoMsg(mensajeDeError(r, 'No se pudo generar la paleta.'), 'error')); return; }
            setPropuesta(r.data);
            vistaPrevia.current = true;
            aplicarApariencia({ temaSeleccionado: 'personalizado', variablesTema: r.data.variables, imagenFondoUrl: perfil.imagenFondoUrl }, false);
            setEstadoPaleta(r.data.fuente === 'colormind'
                ? estadoMsg('Paleta generada por Colormind. Así se vería la página: guárdala si te gusta.', 'ok')
                : estadoMsg('Colormind no respondió; generamos una paleta armónica parecida. Así se vería la página.'));
        } catch (e) { setEstadoPaleta(estadoMsg(mensajeDeError(e), 'error')); } finally { setGenerando(false); }
    }
    async function guardarPaleta() {
        if (!propuesta) return;
        try {
            const r = await apiPerfil.guardar({ temaSeleccionado: 'personalizado', coloresPersonalizados: propuesta.colores });
            if (!r.ok) { setEstadoPaleta(estadoMsg(mensajeDeError(r, 'No se pudo guardar la paleta.'), 'error')); return; }
            vistaPrevia.current = false; setPropuesta(null);
            pintarTodo(r.data);
            setTemaElegido('personalizado');
            setEstadoPaleta(estadoMsg('Paleta guardada: ahora es tu tema «Mi paleta».', 'ok'));
        } catch (e) { setEstadoPaleta(estadoMsg(mensajeDeError(e), 'error')); }
    }
    function descartar() {
        vistaPrevia.current = false; setPropuesta(null);
        aplicarApariencia(aparienciaDe(perfil));
        setEstadoPaleta(estadoMsg('Vista previa descartada.'));
    }

    // Fondo personalizado: multipart (campo «imagen») → multer en el servidor
    async function subirFondo(ev) {
        const archivo = ev.target.files?.[0];
        ev.target.value = '';
        if (!archivo) return;
        if (!esImagenAceptada(archivo)) { setEstadoFondo(estadoMsg('Elige una imagen JPG, PNG o WebP.', 'error')); return; }
        if (archivo.size > 25 * 1024 * 1024) { setEstadoFondo(estadoMsg('La imagen es demasiado grande (máximo 25 MB).', 'error')); return; }
        setEstadoFondo(estadoMsg('Subiendo fondo…'));
        try {
            const blob = await reducirImagen(archivo, { lado: 1920, calidad: 0.82 });
            const fd = new FormData();
            fd.append('imagen', blob, 'fondo.jpg');
            const r = await apiPerfil.subirFondo(fd);
            if (!r.ok) { setEstadoFondo(estadoMsg(mensajeDeError(r, 'No se pudo subir el fondo.'), 'error')); return; }
            pintarTodo(r.data);
            setEstadoFondo(estadoMsg('Fondo aplicado en todas tus páginas.', 'ok'));
        } catch { setEstadoFondo(estadoMsg('No pude leer esa imagen. Prueba con otra.', 'error')); }
    }
    async function quitarFondo() {
        const r = await apiPerfil.quitarFondo().catch(() => null);
        if (!r?.ok) { setEstadoFondo(estadoMsg(mensajeDeError(r, 'No se pudo quitar el fondo.'), 'error')); return; }
        pintarTodo(r.data);
        setEstadoFondo(estadoMsg('Fondo quitado.', 'ok'));
    }

    const v = perfil.variablesTema;
    const temas = perfil.coloresPersonalizados
        ? [...TEMAS, { id: 'personalizado', nombre: 'Mi paleta', desc: 'Los colores que generaste con Colormind.', colores: v ? [v['--color-fondo'], v['--color-primario'], v['--color-secundario'], v['--color-acento']] : null }]
        : TEMAS;
    return (
        <>
            <h2>Estética de la página</h2>
            <p className="panel-intro">El cambio se aplica al instante y se guarda en tu cuenta, así que te acompaña en cualquier dispositivo.</p>
            <h3 className="subtitulo">Temas</h3>
            <fieldset className="temas" id="grupo-temas">
                <legend className="solo-lectores">Tema de color</legend>
                {temas.map((t) => (
                    <label key={t.id} className="tema-opcion" data-tema={t.id}>
                        <input type="radio" name="tema" value={t.id} checked={temaElegido === t.id} onChange={() => elegirTema(t.id)} />
                        <span className="tema-tarjeta">
                            <Muestras colores={t.colores} />
                            <strong>{t.nombre}</strong>
                            <small>{t.desc}</small>
                        </span>
                    </label>
                ))}
            </fieldset>
            <Mensaje estado={estadoTema} id="tema-estado" />

            <h3 className="subtitulo">Generar una paleta con IA (Colormind)</h3>
            <p className="ayuda ayuda-bloque">Elige un color base y Colormind genera cuatro colores que combinan con él. La vista previa se aplica a toda la página; si te gusta, guárdala.</p>
            <form className="paleta-form" id="form-paleta" noValidate onSubmit={generar}>
                <label htmlFor="color-semilla">Color base</label>
                <input type="color" id="color-semilla" value={semilla} onChange={(e) => setSemilla(e.target.value)} />
                <code id="color-semilla-hex">{semilla}</code>
                <button type="submit" className="boton boton-primario" id="btn-paleta-generar" disabled={generando} aria-busy={generando}>✨ Generar paleta</button>
            </form>
            {propuesta ? (
                <div className="paleta-resultado" id="paleta-resultado">
                    <ol className="paleta-colores" id="paleta-colores" aria-label="Colores generados">
                        {propuesta.colores.map((c, i) => (
                            <li key={`${c}-${i}`}><span className="paleta-muestra" aria-hidden="true" style={{ background: c }} /><code>{c}</code>{i === 0 ? <small>base</small> : null}</li>
                        ))}
                    </ol>
                    <div className="acciones-form">
                        <button type="button" className="boton boton-primario" id="btn-paleta-guardar" onClick={guardarPaleta}>Guardar esta paleta</button>
                        <button type="button" className="boton" id="btn-paleta-descartar" onClick={descartar}>Descartar</button>
                    </div>
                </div>
            ) : null}
            <Mensaje estado={estadoPaleta} id="paleta-estado" />

            <h3 className="subtitulo">Fondo personalizado</h3>
            <div className="fondo-bloque">
                <div className={`fondo-vista${perfil.imagenFondoUrl ? ' con-imagen' : ''}`} id="fondo-vista" aria-hidden="true"
                    style={perfil.imagenFondoUrl ? { backgroundImage: `url("${perfil.imagenFondoUrl}")` } : undefined}>
                    <span>Sin fondo</span>
                </div>
                <div className="avatar-acciones">
                    <label className="boton" htmlFor="fondo-archivo">Subir imagen de fondo</label>
                    <input type="file" id="fondo-archivo" className="solo-lectores" accept="image/png,image/jpeg,image/webp" onChange={subirFondo} />
                    {perfil.imagenFondoUrl ? <button type="button" className="boton boton-peligro" id="btn-fondo-quitar" onClick={quitarFondo}>Quitar fondo</button> : null}
                    <p className="ayuda">JPG, PNG o WebP. La reducimos a 1920 px de ancho antes de subirla (máximo 1,5 MB).</p>
                    <Mensaje estado={estadoFondo} id="fondo-estado" />
                </div>
            </div>
        </>
    );
}

// ================================================================ 4. Cuentas vinculadas
const ICONOS = {
    video: <><circle cx="12" cy="12" r="9" /><path d="M10 8.8v6.4l5.4-3.2z" fill="currentColor" /></>,
    codigo: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15" />,
    chat: <><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><circle cx="9" cy="10.5" r="1" fill="currentColor" /><circle cx="15" cy="10.5" r="1" fill="currentColor" /></>,
    musica: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" fill="currentColor" /><circle cx="16.5" cy="16" r="2.5" fill="currentColor" /></>,
    mando: <><path d="M6.5 8h11a4 4 0 0 1 3.9 4.9l-.9 4a2.6 2.6 0 0 1-4.4 1.2L14 16h-4l-2.1 2.1a2.6 2.6 0 0 1-4.4-1.2l-.9-4A4 4 0 0 1 6.5 8z" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="15.5" cy="11.5" r=".9" fill="currentColor" /><circle cx="17.5" cy="13.5" r=".9" fill="currentColor" /></>
};
const SERVICIOS = [
    { id: 'youtube', nombre: 'YouTube', desc: 'Listas de estudio y clases.', icono: 'video' },
    { id: 'github', nombre: 'GitHub', desc: 'Repositorios y proyectos de código.', icono: 'codigo' },
    { id: 'discord', nombre: 'Discord', desc: 'Grupos de estudio y avisos.', icono: 'chat' },
    { id: 'spotify', nombre: 'Spotify', desc: 'Música para concentrarte.', icono: 'musica' },
    { id: 'steam', nombre: 'Steam', desc: 'Tiempo de juego como descanso.', icono: 'mando' },
    { id: 'xbox', nombre: 'Xbox', desc: 'Tiempo de juego como descanso.', icono: 'mando' }
];

export function SeccionCuentas({ perfil, integraciones, fijarPerfil }) {
    const [estado, setEstado] = useState(estadoMsg());
    const [ocupado, setOcupado] = useState(null);
    async function alternar(s) {
        const vincular = !perfil.cuentasVinculadas?.[s.id]?.vinculada;
        setOcupado(s.id); setEstado(estadoMsg());
        try {
            const r = vincular ? await apiPerfil.vincular(s.id) : await apiPerfil.desvincular(s.id);
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, `No se pudo ${vincular ? 'conectar' : 'desconectar'} ${s.nombre}.`), 'error')); return; }
            fijarPerfil(r.data.perfil, r.data.integraciones);
            setEstado(estadoMsg(vincular ? `${s.nombre}: conectado.` : `${s.nombre}: desconectado.`, 'ok'));
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); } finally { setOcupado(null); }
    }
    return (
        <>
            <h2>Cuentas vinculadas</h2>
            <p className="panel-intro">Conecta los servicios que usas para estudiar, programar y descansar.</p>
            {integraciones?.modo === 'simulado' ? (
                <p className="nota-modo" id="nota-modo" role="note">Modo de demostración: al conectar solo se guarda el estado en tu perfil; todavía no se conecta con el servicio real (falta configurar OAuth en el servidor).</p>
            ) : null}
            <ul className="cuentas" id="lista-cuentas">
                {SERVICIOS.map((s) => {
                    const vinculada = Boolean(perfil.cuentasVinculadas?.[s.id]?.vinculada);
                    return (
                        <li key={s.id} className={`cuenta${vinculada ? ' vinculada' : ''}`} data-servicio={s.id}>
                            <span className={`cuenta-icono ic-${s.icono}`} aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONOS[s.icono]}</svg>
                            </span>
                            <div className="cuenta-info">
                                <h3>{s.nombre}</h3>
                                <p className="cuenta-desc">{s.desc}</p>
                                <p className="estado-cuenta">{vinculada ? 'Conectado' : 'Desconectado'}</p>
                            </div>
                            <button type="button" className={`boton ${vinculada ? 'boton-peligro' : 'boton-primario'}`} aria-label={`${vinculada ? 'Desconectar' : 'Conectar'} ${s.nombre}`}
                                disabled={ocupado === s.id} onClick={() => alternar(s)}>{vinculada ? 'Desconectar' : 'Conectar'}</button>
                        </li>
                    );
                })}
            </ul>
            <Mensaje estado={estado} id="cuentas-estado" />
        </>
    );
}

// ================================================================ 5. Notificaciones
function Interruptor({ id, etiqueta, ayuda, checked, disabled, alCambiar }) {
    return (
        <li className="interruptor">
            <div><label htmlFor={id}>{etiqueta}</label><small>{ayuda}</small></div>
            <input type="checkbox" role="switch" id={id} className="switch" checked={checked} disabled={disabled} onChange={(e) => alCambiar(e.target.checked)} />
        </li>
    );
}
export function SeccionNotificaciones({ perfil, fijarPerfil }) {
    const [estado, setEstado] = useState(estadoMsg());
    async function guardar(cuerpo) {
        try {
            const r = await apiPerfil.guardar(cuerpo);
            if (!r.ok) throw new Error();
            fijarPerfil(r.data.perfil);
            setEstado(estadoMsg('Preferencias guardadas.', 'ok'));
        } catch { setEstado(estadoMsg('No se pudo guardar. Inténtalo de nuevo.', 'error')); }
    }
    const general = Boolean(perfil.notificacionesActivas);
    const pref = perfil.preferenciasNotificaciones ?? {};
    return (
        <>
            <h2>Notificaciones</h2>
            <ul className="interruptores">
                <Interruptor id="sw-general" etiqueta="Activar notificaciones" ayuda="Interruptor general. Si lo apagas, no recibirás ningún aviso." checked={general}
                    alCambiar={(v) => guardar({ notificacionesActivas: v })} />
                <Interruptor id="sw-alertas" etiqueta="Alertas de tareas" ayuda="Avisos de actividades próximas y de días con mucha carga." checked={Boolean(pref.alertasTareas)} disabled={!general}
                    alCambiar={(v) => guardar({ preferenciasNotificaciones: { alertasTareas: v } })} />
                <Interruptor id="sw-ia" etiqueta="Recordatorios de la IA" ayuda="Sugerencias del asistente para reorganizar o descansar." checked={Boolean(pref.recordatoriosIA)} disabled={!general}
                    alCambiar={(v) => guardar({ preferenciasNotificaciones: { recordatoriosIA: v } })} />
            </ul>
            <Mensaje estado={estado} id="notif-estado" />
        </>
    );
}

// ================================================================ 6. Privacidad y seguridad
export function SeccionPrivacidad({ fijarPerfil }) {
    const [pw, setPw] = useState({ actual: '', nueva: '', confirma: '' });
    const [estado, setEstado] = useState(estadoMsg());
    const [cambiando, setCambiando] = useState(false);
    const [baja, setBaja] = useState(false);
    const cambiar = (k) => (e) => setPw((x) => ({ ...x, [k]: e.target.value }));

    async function cambiarPassword(ev) {
        ev.preventDefault();
        if (!pw.actual) { document.getElementById('pw-actual-cambio')?.focus(); setEstado(estadoMsg('Escribe tu contraseña actual.', 'error')); return; }
        if (!pw.nueva) { document.getElementById('pw-nueva')?.focus(); setEstado(estadoMsg('Escribe la contraseña nueva.', 'error')); return; }
        if (pw.nueva !== pw.confirma) { document.getElementById('pw-confirma')?.focus(); setEstado(estadoMsg('Las contraseñas nuevas no coinciden.', 'error')); return; }
        setCambiando(true);
        try {
            const r = await apiPerfil.guardar({ passwordActual: pw.actual, passwordNueva: pw.nueva });
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudo cambiar la contraseña.'), 'error')); return; }
            fijarPerfil(r.data.perfil);
            setPw({ actual: '', nueva: '', confirma: '' });
            setEstado(estadoMsg('Contraseña cambiada. Cerramos tus otras sesiones por seguridad.', 'ok'));
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); } finally { setCambiando(false); }
    }

    return (
        <>
            <h2>Privacidad y seguridad</h2>
            <form id="form-password" className="form-perfil" noValidate onSubmit={cambiarPassword}>
                <h3 className="subtitulo">Cambiar contraseña</h3>
                <div className="campo">
                    <label htmlFor="pw-actual-cambio">Contraseña actual</label>
                    <input id="pw-actual-cambio" type="password" maxLength={128} autoComplete="current-password" required value={pw.actual} onChange={cambiar('actual')} />
                </div>
                <div className="campo">
                    <label htmlFor="pw-nueva">Contraseña nueva</label>
                    <input id="pw-nueva" type="password" minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="pw-ayuda" required value={pw.nueva} onChange={cambiar('nueva')} />
                    <small id="pw-ayuda" className="ayuda">Mínimo 8 caracteres, con una letra y un número.</small>
                </div>
                <div className="campo">
                    <label htmlFor="pw-confirma">Repite la contraseña nueva</label>
                    <input id="pw-confirma" type="password" maxLength={128} autoComplete="new-password" required value={pw.confirma} onChange={cambiar('confirma')} />
                </div>
                <Mensaje estado={estado} id="password-estado" />
                <div className="acciones-form">
                    <button type="submit" className="boton boton-primario" id="btn-cambiar-password" disabled={cambiando} aria-busy={cambiando}>Cambiar contraseña</button>
                </div>
                <p className="ayuda">Al cambiarla cerramos tus otras sesiones abiertas.</p>
            </form>
            <div className="zona-peligro">
                <h3>Zona de peligro</h3>
                <p>Eliminar tu cuenta borra para siempre tu perfil, actividades, festivos importados, papelera, historial, check-ins, foto y fondo. No se puede deshacer.</p>
                <button type="button" className="boton boton-peligro" id="btn-eliminar-cuenta" onClick={() => setBaja(true)}>Eliminar cuenta…</button>
            </div>
            <Dialogo abierto={baja} alCerrar={() => setBaja(false)} id="dlg-eliminar" className="dialogo" aria-labelledby="titulo-eliminar">
                <FormularioBaja alCancelar={() => setBaja(false)} />
            </Dialogo>
        </>
    );
}

/** Baja con DOBLE confirmación: 1) botón «Eliminar cuenta…»; 2) contraseña + escribir ELIMINAR */
function FormularioBaja({ alCancelar }) {
    const [password, setPassword] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    async function eliminar(ev) {
        ev.preventDefault();
        setError('');
        if (!password) { setError('Escribe tu contraseña.'); return; }
        if (confirmacion.trim() !== 'ELIMINAR') { setError('Escribe ELIMINAR en mayúsculas para confirmar.'); return; }
        setEnviando(true);
        try {
            const r = await apiPerfil.eliminarCuenta(password, confirmacion.trim());
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo eliminar la cuenta.')); return; }
            olvidarApariencia();
            navegador.irA('/');
        } catch (e) { setError(mensajeDeError(e)); } finally { setEnviando(false); }
    }
    return (
        <form id="form-eliminar" className="formulario-dialogo form-eliminar" noValidate onSubmit={eliminar}>
            <h3 id="titulo-eliminar">¿Eliminar tu cuenta?</h3>
            <p className="campo-ancho">Se borrarán <strong>todos</strong> tus datos de forma permanente. Para confirmar, escribe tu contraseña y la palabra <strong>ELIMINAR</strong>.</p>
            <div className="campo campo-ancho">
                <label htmlFor="eliminar-password">Contraseña</label>
                <input id="eliminar-password" type="password" maxLength={128} autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="campo campo-ancho">
                <label htmlFor="eliminar-confirmacion">Escribe ELIMINAR</label>
                <input id="eliminar-confirmacion" type="text" maxLength={20} autoComplete="off" required value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
            </div>
            <p className="error-formulario campo-ancho" id="eliminar-error" role="alert">{error}</p>
            <div className="modal-pie campo-ancho">
                <span className="espaciador" />
                <button type="button" className="boton" id="btn-eliminar-cancelar" onClick={alCancelar}>Cancelar</button>
                <button type="submit" className="boton boton-peligro confirmar" id="btn-eliminar-confirmar" disabled={enviando} aria-busy={enviando}>Eliminar para siempre</button>
            </div>
        </form>
    );
}
