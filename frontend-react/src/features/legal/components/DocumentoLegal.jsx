// Pinta un documento legal de compartido/legal.js (fuente ÚNICA: el servidor calcula la huella de ese mismo texto).
// Los datos que aún faltan («[PENDIENTE: …]») se resaltan para que no pasen desapercibidos antes de publicar.
import { Fragment } from 'react';
import { Link } from 'react-router';

const PENDIENTE = /(\[PENDIENTE:[^\]]*\])/g;

/** Texto con los «[PENDIENTE: …]» resaltados */
export function TextoLegal({ texto }) {
    const partes = String(texto).split(PENDIENTE);
    return partes.map((p, i) => (i % 2 ? <mark key={i} className="legal-pendiente">{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

export function DocumentoLegal({ documento, otro }) {
    const pendientes = JSON.stringify(documento).match(PENDIENTE)?.length ?? 0;
    return (
        <main id="contenido" className="pagina-legal">
            <article className="legal-documento" aria-labelledby="legal-titulo">
                <header className="legal-cabecera">
                    <h1 id="legal-titulo">{documento.titulo}</h1>
                    <p className="legal-meta">
                        Versión {documento.version} · Vigente desde: <TextoLegal texto={documento.vigenteDesde} />
                    </p>
                    {pendientes ? (
                        <p className="legal-aviso" role="note">
                            Borrador en revisión: los datos marcados <mark className="legal-pendiente">[PENDIENTE]</mark> se completarán antes
                            de su publicación definitiva.
                        </p>
                    ) : null}
                    <nav className="legal-indice" aria-label="Contenido del documento">
                        <ol>
                            {documento.secciones.map((s, i) => <li key={i}><a href={`#seccion-${i + 1}`}>{s.titulo.replace(/^\d+\.\s*/, '')}</a></li>)}
                        </ol>
                    </nav>
                </header>
                {documento.secciones.map((s, i) => (
                    <section key={i} id={`seccion-${i + 1}`} className="legal-seccion">
                        <h2>{s.titulo}</h2>
                        {s.bloques.map((b, j) => (typeof b === 'string'
                            ? <p key={j}><TextoLegal texto={b} /></p>
                            : <ul key={j}>{b.lista.map((t, k) => <li key={k}><TextoLegal texto={t} /></li>)}</ul>))}
                    </section>
                ))}
                {otro ? <p className="legal-otro">Consulta también la <Link to={otro.a}>{otro.texto}</Link>.</p> : null}
            </article>
        </main>
    );
}
