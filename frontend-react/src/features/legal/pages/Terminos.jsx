// /terminos — Términos y Condiciones (página pública)
import { TERMINOS } from '@compartido/legal.js';
import { DocumentoLegal } from '../components/DocumentoLegal.jsx';
import '../legal.css';

export default function Terminos() {
    return <DocumentoLegal documento={TERMINOS} otro={{ a: '/privacidad', texto: 'Política de Tratamiento de Datos Personales' }} />;
}
