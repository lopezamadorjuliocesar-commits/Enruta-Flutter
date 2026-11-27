import type { FieldDef } from './config.store';

export interface FieldError { field: string; message: string; }
const num = (v: string | number | null | undefined): number | null => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Validación real de capturas de un formulario publicado. Es el MISMO contrato que `backend/src/services/forms.js`
 * (el servidor revalida al guardar, así que esta copia solo da respuesta inmediata al repartidor).
 * Foto y Firma no llevan valor: se exigen como evidencia (ver `requiredEvidence`).
 */
export function validateForm(fields: FieldDef[], values: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of fields) {
    if (f.visible === false || f.type === 'Foto' || f.type === 'Firma') continue;
    const raw = values[f.label];
    if (raw === undefined || raw === null || raw === '') { if (f.required) errors.push({ field: f.label, message: `«${f.label}» es obligatorio.` }); continue; }
    const s = String(raw); const err = (message: string) => errors.push({ field: f.label, message });
    switch (f.type) {
      case 'Texto': { const max = num(f.maxLength); if (max && s.length > max) err(`«${f.label}» admite hasta ${max} caracteres.`); break; }
      case 'Número': {
        const n = Number(s); if (!Number.isFinite(n)) { err(`«${f.label}» debe ser un número.`); break; }
        const lo = num(f.min); const hi = num(f.max);
        if (lo !== null && n < lo) err(`«${f.label}» debe ser mayor o igual a ${lo}.`); if (hi !== null && n > hi) err(`«${f.label}» debe ser menor o igual a ${hi}.`); break;
      }
      case 'Fecha': if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) err(`«${f.label}» debe ser una fecha válida (AAAA-MM-DD).`); break;
      case 'Selección': if (!f.options.includes(s)) err(`«${f.label}»: elige una de las opciones.`); break;
      case 'Código de barras': if (!/^[A-Za-z0-9\-_.]{4,64}$/.test(s)) err(`«${f.label}» no es un código válido.`); break;
      case 'Casilla': if (typeof raw !== 'boolean' && !['true', 'false'].includes(s)) err(`«${f.label}» debe ser sí o no.`); else if (f.required && (raw === false || s === 'false')) err(`«${f.label}» debe marcarse.`); break;
      default: break;
    }
  }
  return errors;
}

export const requiredEvidence = (fields: FieldDef[]): { photo: boolean; signature: boolean } => ({
  photo: fields.some((f) => f.type === 'Foto' && f.required && f.visible !== false),
  signature: fields.some((f) => f.type === 'Firma' && f.required && f.visible !== false),
});
