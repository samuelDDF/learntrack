// Correo «Verifica tu dirección de correo» (HTML + texto plano). v3.10.
// HTML para clientes de correo: tablas, estilos en línea (Gmail, Outlook y Apple Mail ignoran <style> externo o
// parte de él), ancho máximo de 560 px que se adapta al móvil, sin JavaScript ni imágenes remotas (el logo va
// adjunto e incrustado con cid:, así no se descarga nada de fuera ni sirve para rastrear la apertura).
// Colores de LearnTrack: azul #2b3a67, cian #00bcd4, azul vivo #077cc0.

const escapar = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const CID_LOGO = 'logo-learntrack';

/**
 * @param {{ nombre: string, codigo: string, minutos: number, conLogo?: boolean }} datos
 * @returns {{ asunto: string, texto: string, html: string }}
 */
export function correoVerificacion({ nombre, codigo, minutos, conLogo = true }) {
    const n = escapar(nombre || '');
    const digitos = String(codigo).split('').map((d) => `<td style="padding:0 3px;"><div style="width:44px;height:56px;line-height:56px;border-radius:10px;background:#f1f6fb;border:1px solid #cfe0ef;font-family:'Courier New',Consolas,monospace;font-size:30px;font-weight:700;color:#2b3a67;text-align:center;">${escapar(d)}</div></td>`).join('');
    // El código NO va en el asunto: el asunto se ve en notificaciones y pantallas de bloqueo
    const asunto = 'Verifica tu correo en LearnTrack';
    const texto = [
        `Hola${nombre ? ` ${nombre}` : ''}:`,
        '',
        'Para terminar de crear tu cuenta en LearnTrack, escribe este código en la ventana de verificación:',
        '',
        `Tu código de verificación es: ${codigo}`,
        '',
        `El código expira en ${minutos} minutos y solo se puede usar una vez.`,
        '',
        'Si no has solicitado crear una cuenta en LearnTrack, puedes ignorar este mensaje: sin el código nadie puede usar tu correo.',
        'Nunca te pediremos este código por teléfono, chat ni otro correo.',
        '',
        '— LearnTrack'
    ].join('\n');
    const logo = conLogo
        ? `<img src="cid:${CID_LOGO}" width="44" height="44" alt="" style="display:block;border:0;border-radius:10px;">`
        : '';
    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Verifica tu dirección de correo</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Tu código de LearnTrack: ${escapar(codigo)}. Expira en ${minutos} minutos.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Poppins,'Segoe UI',Arial,Helvetica,sans-serif;">
    <tr><td style="background:#2b3a67;background-image:linear-gradient(135deg,#2b3a67,#077cc0);padding:22px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        ${logo ? `<td style="padding-right:12px;">${logo}</td>` : ''}
        <td style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">LearnTrack</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:30px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#2b3a67;">Verifica tu dirección de correo</h1>
      <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#33415c;">Hola${n ? ` <strong>${n}</strong>` : ''}:</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#33415c;">Para terminar de crear tu cuenta, escribe este código en la ventana de verificación de LearnTrack:</p>
    </td></tr>
    <tr><td align="center" style="padding:0 16px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-label="Código de verificación ${escapar(codigo.split('').join(' '))}"><tr>${digitos}</tr></table>
    </td></tr>
    <tr><td align="center" style="padding:14px 28px 4px;">
      <p style="margin:0;font-size:14px;color:#077cc0;font-weight:600;">El código expira en ${minutos} minutos y solo sirve una vez.</p>
    </td></tr>
    <tr><td style="padding:22px 28px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f9fc;border-left:4px solid #00bcd4;border-radius:8px;">
        <tr><td style="padding:12px 14px;font-size:13px;line-height:1.55;color:#4a5670;">
          <strong style="color:#2b3a67;">Aviso de seguridad:</strong> si no has solicitado crear una cuenta en LearnTrack, puedes ignorar este mensaje; sin el código nadie puede usar tu correo. Nunca te pediremos este código por teléfono, chat ni otro correo.
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #e6ebf2;font-size:12px;line-height:1.5;color:#7a8499;text-align:center;">
      LearnTrack · Organización y bienestar académico<br>Este es un mensaje automático; no hace falta responderlo.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
    return { asunto, texto, html };
}
