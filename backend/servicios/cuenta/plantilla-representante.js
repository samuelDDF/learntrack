// Correo al representante legal de un menor de 14 a 17 años (v3.13): le pide AUTORIZAR (o no) el registro y el
// tratamiento de datos. Mismo estilo que plantilla-verificacion.js: tablas, estilos en línea, sin imágenes remotas.
// El enlace lleva el token en el fragmento (#t=…), que el navegador no envía en la URL ni en el Referer.
import { CID_LOGO } from './plantilla-verificacion.js';

const escapar = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PARENTESCO = { madre: 'madre', padre: 'padre', tutor: 'tutor(a) o representante legal' };

/**
 * @param {{ nombreRepresentante: string, parentesco: string, nombreMenor: string, enlace: string, dias: number, conLogo?: boolean }} d
 */
export function correoRepresentante({ nombreRepresentante, parentesco, nombreMenor, enlace, dias, conLogo = true }) {
    const n = escapar(nombreRepresentante);
    const m = escapar(nombreMenor);
    const asunto = `${nombreMenor} quiere usar LearnTrack: se necesita tu autorización`;
    const texto = [
        `Hola ${nombreRepresentante}:`,
        '',
        `${nombreMenor} se registró en LearnTrack, una plataforma de organización personal, estudio y bienestar, e indicó que eres su ${PARENTESCO[parentesco] ?? 'representante legal'}.`,
        'Como es menor de edad, la ley colombiana exige tu autorización para crear la cuenta y tratar sus datos personales. Hasta que decidas, la cuenta no se puede usar.',
        '',
        `Revisa la información y decide (autorizar o no autorizar) en este enlace, válido durante ${dias} días:`,
        enlace,
        '',
        'Si no autorizas, la cuenta y sus datos se eliminan. Si no conoces a esta persona, ignora este mensaje: la cuenta se quedará sin poder usarse.',
        '',
        '— LearnTrack'
    ].join('\n');
    const logo = conLogo ? `<td style="padding-right:12px;"><img src="cid:${CID_LOGO}" width="44" height="44" alt="" style="display:block;border:0;border-radius:10px;"></td>` : '';
    const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Autorización de LearnTrack</title></head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Poppins,'Segoe UI',Arial,Helvetica,sans-serif;">
    <tr><td style="background:#2b3a67;background-image:linear-gradient(135deg,#2b3a67,#077cc0);padding:22px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}<td style="font-size:22px;font-weight:700;color:#ffffff;">LearnTrack</td></tr></table>
    </td></tr>
    <tr><td style="padding:30px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#2b3a67;">Se necesita tu autorización</h1>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#33415c;">Hola <strong>${n}</strong>:</p>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#33415c;"><strong>${m}</strong> se registró en LearnTrack, una plataforma de organización personal, estudio y bienestar, e indicó que eres su ${escapar(PARENTESCO[parentesco] ?? 'representante legal')}.</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#33415c;">Como es menor de edad, la ley colombiana exige tu autorización para crear la cuenta y tratar sus datos personales. Hasta que decidas, la cuenta no se puede usar.</p>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 8px;">
      <a href="${escapar(enlace)}" style="display:inline-block;background:#077cc0;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:10px;">Revisar y decidir</a>
      <p style="margin:12px 0 0;font-size:13px;color:#077cc0;font-weight:600;">El enlace es válido durante ${dias} días.</p>
    </td></tr>
    <tr><td style="padding:22px 28px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f9fc;border-left:4px solid #00bcd4;border-radius:8px;">
        <tr><td style="padding:12px 14px;font-size:13px;line-height:1.55;color:#4a5670;">Si no autorizas, la cuenta y sus datos se eliminan. Si no conoces a esta persona, ignora este mensaje: la cuenta se quedará sin poder usarse.</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #e6ebf2;font-size:12px;line-height:1.5;color:#7a8499;text-align:center;">LearnTrack · Organización y bienestar académico<br>Este es un mensaje automático; no hace falta responderlo.</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
    return { asunto, texto, html };
}
