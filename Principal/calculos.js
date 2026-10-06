let plazo
plazo = 12  //horas

function pedirPlazo() {
    if (plazo < 10) {
        return plazo + 2
    } else {
        return "no es posible aumentar el plazo"
    }
}

console.log("Nuevo plazo: " + pedirPlazo())

if (plazo < 3) {
    console.log("Recordatorio importante: Le quedan menos de 3 horas para realizar su tarea.");
}

