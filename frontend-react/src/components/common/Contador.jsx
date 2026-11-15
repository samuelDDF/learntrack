// Contador animado (v3.8): el número sube hasta el valor REAL en CSS puro (propiedad registrada --lt-n).
//  · El texto real siempre está en el DOM (lectores de pantalla, copiar, pruebas): «57%».
//  · Con soporte (html.lt-contadores, ver revelar.js) se muestra el número animado y el texto real queda solo para
//    lectores de pantalla; sin soporte se ve el texto real tal cual. Nunca se muestra un valor inventado: la animación
//    va de 0 (o del valor anterior) al valor actual.
//  · Valores no enteros o no numéricos: se muestran sin animar.
export function Contador({ valor, sufijo = '', className = '' }) {
    const n = Number(valor);
    const texto = `${valor}${sufijo}`;
    if (!Number.isInteger(n) || Math.abs(n) > 1e6) return <span className={className || undefined}>{texto}</span>;
    return (
        <span className={`lt-contador ${className}`.trim()} style={{ '--lt-n': n }} data-sufijo={sufijo}>
            <span className="lt-contador-texto">{texto}</span>
        </span>
    );
}
