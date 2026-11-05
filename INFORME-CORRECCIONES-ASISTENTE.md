# Informe de correcciones del asistente LearnTrack

## Objetivo
Corregir el caso en que mensajes de creación de actividades con fechas futuras se interpretaban como consultas anuales, así como evitar que una solicitud nueva de creación se consuma como respuesta a una aclaración anterior.

## Archivos modificados

### `backend/servicios/asistente/orquestador-chat.js`
- `corregirIntencion()`: añade una regla determinista para reconocer verbos explícitos de creación/agendamiento y mensajes en primera persona que describen un evento (por ejemplo, «tengo un partido») cuando incluyen una fecha o un horario. Esta regla se ejecuta antes de las reglas de consulta anual.
- `crear()`: si el usuario solicita una cantidad de actividades sin describir qué son (por ejemplo, «crea 2 actividades para el 3 de enero de 2028»), pregunta por los nombres y horarios, sin consultar el calendario como sustituto ni inventar actividades.
- `procesarChat()`: cuando el mensaje nuevo se reconoce como una solicitud independiente de creación, no lo consume como respuesta de una aclaración antigua.

### `tests/integracion/asistente-anio-ambiguo.test.js`
Se añadieron pruebas para:
- Pedir detalles cuando se solicita crear varias actividades sin describirlas.
- Interpretar «tengo un partido de fútbol importante» con fecha y horario como creación, incluso si el clasificador simulado responde `charla`.
- Evitar que una nueva solicitud de creación sea absorbida por una aclaración anterior.

## Validaciones realizadas
- `node --check backend/servicios/asistente/orquestador-chat.js`: correcto.
- `node --check tests/integracion/asistente-anio-ambiguo.test.js`: correcto.
- Intento de ejecutar `node --test tests/integracion/asistente-anio-ambiguo.test.js`: no pudo iniciar porque no están instaladas las dependencias del proyecto; Node informó `ERR_MODULE_NOT_FOUND` para `mongoose`.
- No se ha validado la compilación de Vite ni la integración completa contra MongoDB/Ollama. No se declara que las pruebas de integración hayan pasado.

## Pendiente antes de producción
Instalar las dependencias usando el archivo de bloqueo del proyecto y ejecutar la prueba de integración, la suite completa y la compilación. Revisar también el resultado del flujo con una base de datos de pruebas.
