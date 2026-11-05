// Carga el .env ANTES que cualquier otro módulo (los imports de ES se evalúan en orden: server.js importa este
// archivo primero). Así variables como PAPELERA_DIAS ya existen cuando se cargan los modelos.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
