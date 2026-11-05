// Avatar: foto de perfil o la inicial del nombre.
export const inicialDe = (nombre) => (String(nombre ?? '').trim()[0] ?? '?').toUpperCase();

export function Avatar({ usuario, clase = 'avatar-mini', alt = '' }) {
    const url = usuario?.avatarUrl ?? null;
    return (
        <span className={`avatar ${clase}`} aria-hidden={alt ? undefined : 'true'}>
            {url ? <img src={url} alt={alt} /> : <span className="avatar-inicial">{inicialDe(usuario?.nombre)}</span>}
        </span>
    );
}
