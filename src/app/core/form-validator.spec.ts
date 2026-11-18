import { FieldDef } from './config.store';
import { requiredEvidence, validateForm } from './form-validator';

const f = (over: Partial<FieldDef>): FieldDef => ({ id: '1', label: 'Campo', type: 'Texto', required: false, placeholder: '', helpText: '', options: [], min: '', max: '', maxLength: '', defaultValue: '', visible: true, ...over });

describe('validateForm (mismo contrato que backend/src/services/forms.js)', () => {
  it('exige los campos obligatorios y acepta los opcionales vacíos', () => {
    const fields = [f({ label: 'Recibe', required: true }), f({ id: '2', label: 'Nota' })];
    expect(validateForm(fields, {}).map((e) => e.field)).toEqual(['Recibe']);
    expect(validateForm(fields, { Recibe: 'Ana' })).toEqual([]);
  });

  it('valida rangos numéricos, longitud, fecha, opciones y código de barras', () => {
    const fields = [f({ label: 'Cajas', type: 'Número', min: '1', max: '5' }), f({ id: '2', label: 'Texto', maxLength: '3' }), f({ id: '3', label: 'Fecha', type: 'Fecha' }),
      f({ id: '4', label: 'Tipo', type: 'Selección', options: ['A', 'B'] }), f({ id: '5', label: 'Código', type: 'Código de barras' })];
    const errs = validateForm(fields, { Cajas: '9', Texto: 'abcd', Fecha: '2026-13-45', Tipo: 'Z', Código: 'x' });
    expect(errs.map((e) => e.field).sort()).toEqual(['Cajas', 'Código', 'Fecha', 'Texto', 'Tipo']);
    expect(validateForm(fields, { Cajas: '3', Texto: 'abc', Fecha: '2026-11-17', Tipo: 'A', Código: 'ABC-1234' })).toEqual([]);
    expect(validateForm(fields, { Cajas: 'abc' }).find((e) => e.field === 'Cajas')?.message).toContain('número');
  });

  it('una casilla obligatoria debe marcarse; los campos ocultos, Foto y Firma no llevan valor', () => {
    const fields = [f({ label: 'Acepta', type: 'Casilla', required: true }), f({ id: '2', label: 'Oculto', required: true, visible: false }), f({ id: '3', label: 'Foto', type: 'Foto', required: true })];
    expect(validateForm(fields, { Acepta: false }).map((e) => e.field)).toEqual(['Acepta']);
    expect(validateForm(fields, { Acepta: true })).toEqual([]);
  });

  it('requiredEvidence detecta foto y firma obligatorias y visibles', () => {
    expect(requiredEvidence([f({ label: 'F', type: 'Foto', required: true }), f({ id: '2', label: 'S', type: 'Firma', required: true, visible: false })])).toEqual({ photo: true, signature: false });
    expect(requiredEvidence([])).toEqual({ photo: false, signature: false });
  });
});
