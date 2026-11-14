// Servidor SMTP SIMULADO para las pruebas (v3.10). Habla el protocolo SMTP real (EHLO, MAIL, RCPT, DATA, QUIT), de
// modo que Nodemailer funciona exactamente como en producción. Guarda cada mensaje, decodifica sus partes MIME
// (quoted-printable / base64) y extrae el código del texto, como lo leería una persona en su bandeja de entrada.
// También puede «fallar» para probar los errores del servidor de correo.
import net from 'node:net';

function desplegarCabeceras(texto) {
    const cab = {};
    for (const linea of texto.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
        const i = linea.indexOf(':');
        if (i > 0) cab[linea.slice(0, i).trim().toLowerCase()] = linea.slice(i + 1).trim();
    }
    return cab;
}

function decodificarQP(texto) {
    const sinSaltos = texto.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < sinSaltos.length; i++) {
        if (sinSaltos[i] === '=' && /^[0-9A-F]{2}$/i.test(sinSaltos.slice(i + 1, i + 3))) { bytes.push(parseInt(sinSaltos.slice(i + 1, i + 3), 16)); i += 2; }
        else bytes.push(...Buffer.from(sinSaltos[i], 'utf8'));
    }
    return Buffer.from(bytes).toString('utf8');
}

/** Devuelve las hojas MIME: [{ tipo, contenido, cabeceras }] */
function partesMime(crudo) {
    const corte = crudo.indexOf('\r\n\r\n');
    const cabeceras = desplegarCabeceras(corte < 0 ? crudo : crudo.slice(0, corte));
    const cuerpo = corte < 0 ? '' : crudo.slice(corte + 4);
    const tipo = (cabeceras['content-type'] ?? 'text/plain').toLowerCase();
    const limite = /boundary="?([^";]+)"?/i.exec(cabeceras['content-type'] ?? '')?.[1];
    if (tipo.startsWith('multipart/') && limite) {
        return cuerpo.split(`--${limite}`).slice(1)
            .filter((p) => !p.startsWith('--'))
            .flatMap((p) => partesMime(p.replace(/^\r\n/, '')));
    }
    const codificacion = (cabeceras['content-transfer-encoding'] ?? '').toLowerCase();
    let contenido = cuerpo;
    if (codificacion === 'quoted-printable') contenido = decodificarQP(cuerpo);
    else if (codificacion === 'base64' && tipo.startsWith('text/')) contenido = Buffer.from(cuerpo.replace(/\s/g, ''), 'base64').toString('utf8');
    return [{ tipo: tipo.split(';')[0], contenido, cabeceras }];
}

export async function iniciarSmtpFalso() {
    const mensajes = [];
    let fallo = null;                                  // null | 'rechazar' (554 en DATA) | 'desconectar'
    const servidor = net.createServer((sock) => {
        if (fallo === 'desconectar') { sock.destroy(); return; }
        sock.setEncoding('utf8');
        let buf = '', datos = false, actual = { para: [] };
        const w = (l) => sock.write(`${l}\r\n`);
        w('220 smtp-falso ESMTP listo');
        sock.on('error', () => {});
        sock.on('data', (trozo) => {
            buf += trozo;
            for (;;) {
                if (datos) {
                    const fin = buf.indexOf('\r\n.\r\n');
                    if (fin < 0) return;
                    const crudo = buf.slice(0, fin).replace(/\r\n\.\./g, '\r\n.');
                    buf = buf.slice(fin + 5); datos = false;
                    if (fallo === 'rechazar') { w('554 5.7.1 mensaje rechazado (simulado)'); }
                    else {
                        const partes = partesMime(crudo);
                        const texto = partes.find((p) => p.tipo === 'text/plain')?.contenido ?? '';
                        const html = partes.find((p) => p.tipo === 'text/html')?.contenido ?? '';
                        const cab = desplegarCabeceras(crudo.slice(0, crudo.indexOf('\r\n\r\n')));
                        mensajes.push({
                            para: actual.para, asunto: cab.subject ?? '', de: cab.from ?? '', texto, html, crudo,
                            adjuntos: partes.filter((p) => !p.tipo.startsWith('text/')).map((p) => ({ tipo: p.tipo, cid: p.cabeceras['content-id'] ?? '' })),
                            codigo: /verificación es: (\d{6})/.exec(texto)?.[1] ?? null
                        });
                        w('250 2.0.0 OK');
                    }
                    actual = { para: [] };
                    continue;
                }
                const i = buf.indexOf('\r\n');
                if (i < 0) return;
                const linea = buf.slice(0, i); buf = buf.slice(i + 2);
                const cmd = linea.slice(0, 4).toUpperCase();
                if (cmd === 'EHLO') sock.write('250-smtp-falso\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
                else if (cmd === 'HELO') w('250 smtp-falso');
                else if (cmd === 'MAIL') { actual.de = linea; w('250 2.1.0 OK'); }
                else if (cmd === 'RCPT') { actual.para.push(/<([^>]*)>/.exec(linea)?.[1] ?? ''); w('250 2.1.5 OK'); }
                else if (cmd === 'DATA') { datos = true; w('354 Termina con <CRLF>.<CRLF>'); }
                else if (cmd === 'QUIT') { w('221 2.0.0 Adiós'); sock.end(); return; }
                else if (cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
                else w('502 5.5.2 No implementado');
            }
        });
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const puerto = servidor.address().port;
    return {
        mensajes,
        variablesEntorno: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(puerto), SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'LearnTrack <pruebas@learntrack.test>' },
        /** Mensajes enviados a un correo (más reciente al final) */
        paraCorreo: (email) => mensajes.filter((m) => m.para.includes(email)),
        /** Último código enviado a un correo (o null) */
        codigoPara(email) { return this.paraCorreo(email).at(-1)?.codigo ?? null; },
        /** null (normal) | 'rechazar' | 'desconectar' */
        fallar(modo) { fallo = modo; },
        cerrar: () => new Promise((ok) => servidor.close(() => ok()))
    };
}
