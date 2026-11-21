// DOCUMENTOS LEGALES de LearnTrack (v3.13): Términos y Condiciones y Política de Tratamiento de Datos Personales.
// Fuente ÚNICA: el navegador los muestra (/terminos y /privacidad) y el servidor calcula la HUELLA (SHA-256) del texto
// exacto que cada persona acepta (backend/servicios/cuenta/legal.js).
//
// ⚠️ BORRADOR PARA REVISIÓN DE UN ABOGADO COLOMBIANO. No garantiza por sí solo el cumplimiento de la ley.
//    Los datos del responsable que no se conocen están marcados [PENDIENTE: …] y deben completarse antes de publicar.
//
// CAMBIOS: si modificas un documento de forma SUSTANCIAL, sube su versión (VERSION_*). Todas las cuentas tendrán que
// aceptar la versión nueva antes de seguir usando LearnTrack. Un cambio de redacción menor puede conservar la versión,
// pero la huella cambiará igual (queda registrado qué texto exacto aceptó cada persona).

export const VERSION_TERMINOS = '1.0';
export const VERSION_PRIVACIDAD = '1.0';
export const VIGENTE_DESDE = '[PENDIENTE: fecha de publicación, p. ej. 1 de diciembre de 2026]';

/** Edad mínima para registrarse y mayoría de edad (de 14 a 17 años hace falta la autorización del representante) */
export const EDAD_MINIMA = 14;
export const MAYORIA_EDAD = 18;

/** Datos del responsable del tratamiento: NO se inventan. Completa cada campo antes de publicar. */
export const RESPONSABLE = {
    nombre: '[PENDIENTE: nombre completo o razón social del responsable de LearnTrack]',
    identificacion: '[PENDIENTE: cédula de ciudadanía o NIT]',
    domicilio: '[PENDIENTE: ciudad y dirección de notificaciones]',
    correo: '[PENDIENTE: correo electrónico para datos personales y soporte]',
    telefono: '[PENDIENTE: teléfono de contacto]'
};

/** Años cumplidos en la fecha `hoy` (ambas 'YYYY-MM-DD') */
export function edadEn(fechaNacimiento, hoy) {
    const [a, m, d] = fechaNacimiento.split('-').map(Number);
    const [ha, hm, hd] = hoy.split('-').map(Number);
    return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

const R = RESPONSABLE;

// Cada documento: { id, titulo, version, vigenteDesde, secciones: [{ titulo, bloques: [texto | { lista: [texto] }] }] }
export const TERMINOS = {
    id: 'terminos',
    titulo: 'Términos y Condiciones de LearnTrack',
    version: VERSION_TERMINOS,
    vigenteDesde: VIGENTE_DESDE,
    secciones: [
        {
            titulo: '1. Identificación y descripción de LearnTrack',
            bloques: [
                `LearnTrack es una plataforma web de organización personal, aprendizaje y bienestar. La administra ${R.nombre}, identificado(a) con ${R.identificacion}, con domicilio en ${R.domicilio} (en adelante, «el Responsable»). Contacto: ${R.correo}.`,
                'Estos Términos regulan el acceso y el uso de LearnTrack. Al crear una cuenta y marcar la casilla de aceptación, declaras haberlos leído y aceptado. La aceptación por medios electrónicos tiene plena validez (Ley 527 de 1999).'
            ]
        },
        {
            titulo: '2. Objeto y alcance del servicio',
            bloques: [
                'LearnTrack ofrece, en su versión actual, las siguientes funciones:',
                {
                    lista: [
                        'Agenda y calendario de actividades, con un cálculo orientativo de la «carga» de cada día.',
                        'Proyectos con sus tareas y avance.',
                        'Estudio: temas de aprendizaje con fecha límite, prioridad y progreso, sesiones de estudio y repaso espaciado.',
                        'Bienestar: un check-in diario opcional (ánimo, sueño y enfoque) y consejos generales.',
                        'Un asistente de inteligencia artificial («Nexo» u otro nombre que elijas) que propone cambios en tu agenda, responde dudas y lee documentos que tú adjuntes.',
                        'Personalización (tema visual, foto de perfil, imagen de fondo, voz del asistente) y una papelera para recuperar lo borrado.'
                    ]
                },
                `LearnTrack se ofrece actualmente sin costo [PENDIENTE: confirmar si el servicio es gratuito o si habrá planes de pago]. Es una herramienta de apoyo: no sustituye a profesores, instituciones educativas, profesionales de la salud ni asesores de ningún tipo.`
            ]
        },
        {
            titulo: '3. Requisitos para crear una cuenta',
            bloques: [
                {
                    lista: [
                        `Tener al menos ${EDAD_MINIMA} años. Si tienes entre ${EDAD_MINIMA} y ${MAYORIA_EDAD - 1} años, tu madre, padre o representante legal debe autorizar tu registro y el tratamiento de tus datos; la cuenta no se puede usar hasta que lo haga.`,
                        'Dar un nombre y un correo electrónico propios y verificar el correo con el código que te enviamos.',
                        'Elegir una contraseña segura y mantenerla en secreto.',
                        'Aceptar estos Términos y la Política de Tratamiento de Datos Personales.'
                    ]
                },
                'Cada cuenta es personal e intransferible. No se pueden crear cuentas en nombre de otra persona sin su autorización.'
            ]
        },
        {
            titulo: '4. Responsabilidades del usuario',
            bloques: [
                {
                    lista: [
                        'Usar LearnTrack de buena fe y conforme a la ley colombiana.',
                        'Ser responsable de la información que registras, de su exactitud y de tener derecho a usarla.',
                        'No subir información de terceros sin estar autorizado(a) para ello.',
                        'Revisar y decidir sobre las propuestas y recomendaciones del asistente antes de aplicarlas.',
                        'Avisar al Responsable si sospechas que alguien usó tu cuenta.'
                    ]
                }
            ]
        },
        {
            titulo: '5. Uso adecuado de la plataforma',
            bloques: [
                'Está prohibido, entre otros:',
                {
                    lista: [
                        'Intentar acceder a cuentas, datos o funciones que no te pertenecen, o eludir los controles de seguridad.',
                        'Automatizar peticiones masivas, sobrecargar el servicio o interferir en su funcionamiento.',
                        'Subir archivos con software malicioso o contenido ilícito, o usar el asistente para generar contenido ilícito.',
                        'Usar LearnTrack para acosar, suplantar o perjudicar a otras personas.'
                    ]
                }
            ]
        },
        {
            titulo: '6. Tareas, calendarios, proyectos y actividades',
            bloques: [
                'Tú decides qué registras y puedes editarlo o borrarlo cuando quieras. Lo que borras pasa a la papelera durante 30 días (o el plazo que indique la aplicación) y después se elimina de forma definitiva.',
                'Los porcentajes de carga, las prioridades y los planes de estudio son estimaciones automáticas para ayudarte a organizarte; no son una evaluación de tu rendimiento ni de tu salud.',
                'LearnTrack no envía tus actividades a otras personas ni las publica.'
            ]
        },
        {
            titulo: '7. Funcionamiento y limitaciones de la inteligencia artificial',
            bloques: [
                'El asistente usa un modelo de lenguaje de código abierto (Llama 3.2) que se ejecuta en un equipo controlado por el Responsable, no en servicios de inteligencia artificial de terceros. Para responderte recibe tu mensaje, el contexto necesario de tu agenda o de la sección desde la que escribes y, si lo adjuntas, el contenido del documento.',
                {
                    lista: [
                        'Puede equivocarse, malinterpretar una fecha o dar información incompleta o desactualizada.',
                        'Puede no estar disponible en algunos momentos (por ejemplo, si el equipo que lo ejecuta está apagado o sin conexión).',
                        'No guarda tus conversaciones: LearnTrack no almacena el texto del chat ni los documentos que adjuntas; solo guarda las actividades, temas o cambios que tú confirmas.',
                        'Las fechas y horarios que propone los calcula el sistema con reglas fijas y siempre te los muestra antes de guardarlos.'
                    ]
                }
            ]
        },
        {
            titulo: '8. Recomendaciones generadas por la IA',
            bloques: [
                'Las explicaciones, consejos, planes y sugerencias del asistente son orientativos. No son asesoría médica, psicológica, legal, financiera ni académica oficial. Antes de actuar con base en ellos, evalúalos con tu propio criterio y, cuando corresponda, consulta a un profesional o a tu institución.',
                'Ninguna propuesta del asistente cambia tu agenda sin que la confirmes. Tú eres responsable de las decisiones que tomes al aplicarlas.'
            ]
        },
        {
            titulo: '9. Seguridad y protección de las cuentas',
            bloques: [
                'LearnTrack guarda las contraseñas con un algoritmo de derivación segura (nunca en texto plano), usa conexiones cifradas, cookies de sesión protegidas, verificación del correo y límites de intentos de acceso. Ningún sistema es infalible: si detectas un uso no autorizado, cambia tu contraseña y escribe a ' + R.correo + '.',
                'El Responsable nunca te pedirá tu contraseña ni el código de verificación por correo, teléfono o chat.'
            ]
        },
        {
            titulo: '10. Suspensión y eliminación de cuentas',
            bloques: [
                'Puedes eliminar tu cuenta en cualquier momento desde «Mi perfil»: se borran tu cuenta y todos sus datos asociados (actividades, proyectos, temas de estudio, check-ins, imágenes y sesiones).',
                'El Responsable puede suspender temporalmente una cuenta, o eliminarla, cuando exista un incumplimiento de estos Términos, un riesgo para la seguridad del servicio o de otras personas, o una orden de autoridad competente. Durante la suspensión no se puede iniciar sesión y se cierran las sesiones abiertas. Se registra el motivo y la fecha, y puedes pedir explicaciones o solicitar la reactivación en ' + R.correo + '.',
                'Las cuentas que no verifican su correo se eliminan automáticamente a los 7 días.'
            ]
        },
        {
            titulo: '11. Disponibilidad, mantenimiento e interrupciones',
            bloques: [
                'LearnTrack se ofrece «tal como está» y según su disponibilidad. Puede haber interrupciones por mantenimiento, actualizaciones, fallas de los proveedores de alojamiento o de conectividad, o causas ajenas al Responsable. Se procurará avisar de los mantenimientos previstos cuando sea posible.',
                'Las funciones pueden cambiar, mejorarse o retirarse. Si una función que uses deja de existir, podrás seguir consultando o eliminando tus datos mientras tu cuenta exista.'
            ]
        },
        {
            titulo: '12. Propiedad intelectual',
            bloques: [
                'El software, el diseño, los textos, los logotipos y la marca LearnTrack pertenecen al Responsable o a sus licenciantes [PENDIENTE: confirmar titularidad de la marca y de las ilustraciones]. Los componentes de código abierto que usa LearnTrack se rigen por sus propias licencias.',
                'El contenido que registras sigue siendo tuyo. Solo autorizas al Responsable a almacenarlo y procesarlo para prestarte el servicio.'
            ]
        },
        {
            titulo: '13. Limitaciones de responsabilidad',
            bloques: [
                'En la medida en que lo permita la ley colombiana, el Responsable no responde por: decisiones tomadas con base en estimaciones o recomendaciones de la plataforma o de la IA; pérdidas derivadas de un uso indebido de la cuenta por no proteger la contraseña; interrupciones causadas por terceros o por fuerza mayor; ni por la información que registres sin estar autorizado(a).',
                'Nada de lo anterior limita los derechos que la ley reconoce de forma irrenunciable, incluidos los de los consumidores cuando resulten aplicables (Ley 1480 de 2011).'
            ]
        },
        {
            titulo: '14. Modificaciones de los Términos',
            bloques: [
                'El Responsable puede actualizar estos Términos. Si el cambio es sustancial, se publicará una nueva versión y LearnTrack te pedirá aceptarla antes de seguir usando la aplicación; si no la aceptas, puedes cerrar sesión o eliminar tu cuenta. La versión y la fecha de vigencia aparecen al inicio de este documento.'
            ]
        },
        {
            titulo: '15. Canales de contacto',
            bloques: [
                `Correo: ${R.correo} · Teléfono: ${R.telefono} · Dirección: ${R.domicilio}. También puedes usar el formulario de contacto de la página de inicio.`
            ]
        },
        {
            titulo: '16. Legislación aplicable y solución de controversias',
            bloques: [
                'Estos Términos se rigen por las leyes de la República de Colombia. Cualquier diferencia se intentará resolver primero de forma directa escribiendo al canal de contacto, que responderá en un plazo máximo de 15 días hábiles. Si no hay acuerdo, podrás acudir a las autoridades competentes, incluida la Superintendencia de Industria y Comercio en materia de protección de datos personales y de protección al consumidor, o a los jueces de la República de Colombia [PENDIENTE: confirmar ciudad o jurisdicción].'
            ]
        }
    ]
};

export const PRIVACIDAD = {
    id: 'privacidad',
    titulo: 'Política de Tratamiento de Datos Personales de LearnTrack',
    version: VERSION_PRIVACIDAD,
    vigenteDesde: VIGENTE_DESDE,
    secciones: [
        {
            titulo: '1. Responsable del tratamiento',
            bloques: [
                `Responsable: ${R.nombre} · Identificación: ${R.identificacion} · Domicilio: ${R.domicilio} · Correo: ${R.correo} · Teléfono: ${R.telefono}.`,
                'Esta Política se adopta en cumplimiento de la Ley Estatutaria 1581 de 2012 y del Decreto 1074 de 2015 (capítulo 25 y siguientes del título 2, parte 2, libro 2), que regulan la protección de datos personales en Colombia.'
            ]
        },
        {
            titulo: '2. Qué datos recopila LearnTrack',
            bloques: [
                {
                    lista: [
                        'Registro y autenticación: nombre, correo electrónico, contraseña (solo su huella cifrada, nunca el texto), fecha de nacimiento, fecha de creación de la cuenta, último acceso y, si eres menor de edad, el nombre, el correo y el parentesco de tu representante legal y la fecha en que autorizó.',
                        'Aceptación de documentos: versión de estos documentos que aceptaste, fecha y hora, y una huella digital del texto aceptado. No se registra tu dirección IP ni se usan técnicas de seguimiento.',
                        'Contenido que registras: actividades, horarios, proyectos, temas y sesiones de estudio, y su estado.',
                        'Bienestar (opcional): las respuestas al check-in diario (ánimo, sueño y enfoque) y el historial de carga diaria.',
                        'Personalización: tema visual, colores, foto de perfil, imagen de fondo, nombre y voz del asistente, festivos importados y preferencias de notificaciones.',
                        'Mensajes del formulario de contacto: nombre, correo y mensaje.',
                        'Datos técnicos imprescindibles: cookies de sesión y de verificación (no de publicidad ni de analítica) y preferencias guardadas en tu propio navegador (por ejemplo, la vista de la agenda).'
                    ]
                }
            ]
        },
        {
            titulo: '3. Finalidades del tratamiento',
            bloques: [
                {
                    lista: [
                        'Crear y administrar tu cuenta, verificar tu correo y mantener tu sesión segura.',
                        'Prestarte las funciones de LearnTrack: guardar y mostrar tu agenda, proyectos, estudio y bienestar, calcular la carga de cada día y proponer planes.',
                        'Permitir que el asistente de IA responda tus mensajes y analice los documentos que adjuntes.',
                        'Enviarte únicamente correos necesarios del servicio (códigos de verificación y, si eres menor de edad, la solicitud de autorización a tu representante). LearnTrack no envía publicidad.',
                        'Atender consultas, reclamos y mensajes de contacto.',
                        'Proteger la seguridad del servicio, prevenir abusos y, cuando corresponda, suspender o eliminar cuentas según los Términos.',
                        'Cumplir obligaciones legales y atender requerimientos de autoridades competentes.'
                    ]
                },
                'Tus datos no se venden ni se ceden a terceros con fines comerciales.'
            ]
        },
        {
            titulo: '4. Información que envías a la inteligencia artificial',
            bloques: [
                'Cuando escribes al asistente, LearnTrack le envía tu mensaje, las últimas frases de la conversación, el contexto necesario (por ejemplo, tus actividades próximas o el proyecto o tema que tienes abierto) y, si lo adjuntas, el contenido del documento.',
                'El modelo (Llama 3.2) se ejecuta en un equipo controlado por el Responsable mediante el programa Ollama; el servidor de LearnTrack se comunica con él por un túnel cifrado provisto por Tailscale Inc. Ningún proveedor de IA externo recibe tus datos.',
                'LearnTrack no guarda el texto de tus conversaciones ni los documentos que adjuntas: solo se conserva lo que tú confirmas (por ejemplo, una actividad creada). Las propuestas pendientes de confirmar se borran a los 10 minutos. Excepción: cuando el asistente te sugiere un tema de estudio, guarda junto a la sugerencia la frase tuya que la motivó (hasta 140 caracteres), para explicarte por qué te lo sugiere. Esa frase se borra si descartas la sugerencia (solo se conserva el nombre del tema, para no volver a sugerírtelo) y al eliminar el tema o tu cuenta.',
                'El dictado por voz usa el reconocimiento de voz de tu navegador: según el navegador, el audio puede procesarlo el fabricante (por ejemplo, Google en Chrome). LearnTrack solo recibe el texto resultante. Puedes no usar el dictado.',
                'Evita escribir en el chat o en los documentos datos sensibles innecesarios o datos de otras personas.'
            ]
        },
        {
            titulo: '5. Datos sensibles y datos de menores de edad',
            bloques: [
                'Las respuestas del check-in diario sobre ánimo y sueño pueden considerarse datos relacionados con la salud y, por tanto, datos sensibles (artículo 5 de la Ley 1581 de 2012). Responder es FACULTATIVO: no estás obligado(a) a hacerlo y puedes usar LearnTrack sin el check-in. Si respondes, autorizas su tratamiento solo para mostrarte tu carga del día y consejos generales. LearnTrack no realiza diagnósticos.',
                `LearnTrack admite personas desde los ${EDAD_MINIMA} años. Los datos de niños, niñas y adolescentes se tratan respetando su interés superior y sus derechos fundamentales. Si tienes entre ${EDAD_MINIMA} y ${MAYORIA_EDAD - 1} años, al registrarte expresas tu opinión y tu madre, padre o representante legal recibe un correo para autorizar (o no) el tratamiento; la cuenta no se puede usar hasta que autorice. El representante puede revocar la autorización y pedir la eliminación de los datos en cualquier momento.`
            ]
        },
        {
            titulo: '6. Proveedores y transmisiones o transferencias internacionales',
            bloques: [
                'Para funcionar, LearnTrack usa estos proveedores, que actúan como encargados o prestadores de infraestructura:',
                {
                    lista: [
                        'Railway Corp. (Estados Unidos): servidor de la aplicación.',
                        'MongoDB Inc. – MongoDB Atlas: base de datos [PENDIENTE: indicar la región del clúster].',
                        'GitHub Inc. – GitHub Pages (Estados Unidos): publicación de la interfaz web.',
                        'Google LLC (Estados Unidos): envío de correos (Gmail API) y fuentes tipográficas de la página pública (Google Fonts, que recibe tu dirección IP al cargar la página).',
                        'Tailscale Inc. (Estados Unidos): túnel cifrado entre el servidor y el equipo que ejecuta la IA.',
                        'Nager.Date y Colormind: solo reciben el país y año de los festivos o la petición de una paleta de colores, sin datos personales.'
                    ]
                },
                'Estados Unidos figura entre los países con nivel adecuado de protección de datos según la Circular Externa 005 de 2017 de la Superintendencia de Industria y Comercio. Al aceptar esta Política autorizas estas transferencias o transmisiones, limitadas a lo necesario para prestar el servicio.'
            ]
        },
        {
            titulo: '7. Almacenamiento y seguridad',
            bloques: [
                'Medidas aplicadas: contraseñas protegidas con derivación segura (scrypt) y sal; conexiones cifradas (HTTPS); cookies de sesión HttpOnly; verificación del correo; límites de intentos; separación estricta de los datos de cada cuenta; acceso administrativo restringido a una única cuenta, sin acceso al contenido de tus actividades, y con registro de sus acciones.',
                'Ningún sistema es completamente seguro. Si ocurre un incidente que afecte tus datos, se informará a la Superintendencia de Industria y Comercio y a los titulares afectados conforme a la ley.'
            ]
        },
        {
            titulo: '8. Tiempo de conservación',
            bloques: [
                {
                    lista: [
                        'Datos de la cuenta y su contenido: mientras la cuenta exista. Al eliminarla, se borran todos.',
                        'Registros sin verificar el correo: 7 días.',
                        'Sesiones: 7 días como máximo (8 horas para la cuenta de administración).',
                        'Elementos en la papelera: 30 días (o el plazo configurado).',
                        'Propuestas del asistente sin confirmar: 10 minutos.',
                        'Registro de acciones de administración (sin contraseñas ni correos de cuentas eliminadas): 2 años.',
                        'Mensajes del formulario de contacto: [PENDIENTE: definir plazo, p. ej. 1 año desde su respuesta].',
                        'Copias de seguridad del proveedor de base de datos: [PENDIENTE: confirmar política de respaldos de MongoDB Atlas].'
                    ]
                },
                'Esta Política y la base de datos estarán vigentes mientras LearnTrack preste el servicio.'
            ]
        },
        {
            titulo: '9. Derechos de los titulares',
            bloques: [
                'Según el artículo 8 de la Ley 1581 de 2012, tienes derecho a:',
                {
                    lista: [
                        'Conocer, actualizar y rectificar tus datos.',
                        'Solicitar prueba de la autorización que otorgaste.',
                        'Ser informado(a), previa solicitud, del uso que se ha dado a tus datos.',
                        'Presentar quejas ante la Superintendencia de Industria y Comercio, una vez agotado el trámite ante el Responsable.',
                        'Revocar la autorización y/o solicitar la supresión de tus datos cuando no exista un deber legal o contractual de conservarlos.',
                        'Acceder de forma gratuita a tus datos.'
                    ]
                }
            ]
        },
        {
            titulo: '10. Cómo ejercer tus derechos',
            bloques: [
                'Desde la aplicación puedes ver y corregir tus datos en «Mi perfil» y eliminar tu cuenta con todos sus datos. Para cualquier otra solicitud (por ejemplo, una copia de tus datos o la prueba de tu autorización), escribe a ' + R.correo + ' indicando tu nombre, el correo de tu cuenta, lo que pides y cómo quieres recibir la respuesta. Por seguridad podremos pedirte que confirmes la solicitud desde el correo de la cuenta.',
                {
                    lista: [
                        'Consultas: se responden en máximo 10 días hábiles desde su recibo, prorrogables hasta 5 días hábiles más, informándote el motivo (artículo 14).',
                        'Reclamos (corrección, actualización, supresión o incumplimiento): se responden en máximo 15 días hábiles, prorrogables hasta 8 días hábiles más. Si el reclamo está incompleto, se te pedirá completarlo en 5 días; si pasan 2 meses sin hacerlo, se entenderá desistido (artículo 15).'
                    ]
                },
                `Área o persona responsable de atender peticiones, consultas y reclamos: ${R.nombre} [PENDIENTE: confirmar persona o área].`
            ]
        },
        {
            titulo: '11. Cambios en esta Política',
            bloques: [
                'Si esta Política cambia de forma sustancial (por ejemplo, nuevas finalidades o nuevos proveedores), se publicará una nueva versión y LearnTrack te pedirá aceptarla antes de seguir usando la aplicación. La versión y la fecha de vigencia aparecen al inicio del documento.'
            ]
        }
    ]
};

export const DOCUMENTOS_LEGALES = { terminos: TERMINOS, privacidad: PRIVACIDAD };
export const VERSIONES_VIGENTES = { terminos: VERSION_TERMINOS, privacidad: VERSION_PRIVACIDAD };
