// /privacidad — Política de Tratamiento de Datos Personales (página pública)
import { PRIVACIDAD } from '@compartido/legal.js';
import { DocumentoLegal } from '../components/DocumentoLegal.jsx';
import '../legal.css';

export default function Privacidad() {
    return <DocumentoLegal documento={PRIVACIDAD} otro={{ a: '/terminos', texto: 'Términos y Condiciones' }} />;
}
