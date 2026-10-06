// ai-service.js

// REEMPLAZA ESTE TEXTO CON TU CLAVE DE GOOGLE AI STUDIO
const API_KEY = "AQ.Ab8RN6JbYlb7RLEKiTavLb-ku0_egxRDjCHvQJq-b6TGwdkvdg"; 
const URL_GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

export async function consultarIA(datos) {
    // Si aún no has puesto tu API_KEY, retorna null para usar la respuesta por defecto
    if (API_KEY === "AQ.Ab8RN6JbYlb7RLEKiTavLb-ku0_egxRDjCHvQJq-b6TGwdkvdg" || !API_KEY) {
        return null;
    }

    const mensaje = `
Actúa como el asistente virtual de la app LearnTrack.
El usuario se siente: "${datos.estadoAnimo}".
Su porcentaje de carga mental actual es: ${datos.porcentajeCarga}%.
Sus actividades de hoy son: ${JSON.stringify(datos.actividades)}.

Dame un consejo de máximo 2 oraciones, empático y directo, diciéndole si debe seguir estudiando, tomar un descanso o dedicar tiempo a su ocio/deporte para no saturarse.
    `;

    try {
        const respuesta = await fetch(URL_GEMINI, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: mensaje }] }]
            })
        });

        const data = await respuesta.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Error al conectar con la IA:", error);
        return null;
    }
}