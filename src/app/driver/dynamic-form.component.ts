import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FieldDef } from '../core/config.store';
import { FieldError } from '../core/form-validator';

/**
 * Formulario dinámico a partir de la definición PUBLICADA (entrega, cobro o visita). Los campos Foto y Firma se capturan en el paso de
 * evidencias, no aquí. La validación real vive en `core/form-validator.ts` y el servidor la repite.
 */
@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: [`.f{margin:10px 0}.f label{display:block;font-weight:600;font-size:14px;margin:0 0 4px}.req{color:#b3261e}small.help{color:#708197;display:block;margin-top:2px}small.err{color:#b3261e;display:block;margin-top:2px}
    input,select{width:100%;box-sizing:border-box;min-height:48px;border:1px solid #e5eaf0;border-radius:10px;padding:0 12px;font-size:16px;background:#fff}input[type=checkbox]{width:22px;min-height:22px}.chk{display:flex;gap:10px;align-items:center}`],
  template: `
    @for (f of visibleFields(); track f.id) {
      <div class="f" [attr.data-field]="f.label">
        @if (f.type === 'Casilla') {
          <label class="chk"><input type="checkbox" [ngModel]="!!values()[f.label]" (ngModelChange)="set(f.label, $event)"> {{ f.label }}@if (f.required) { <span class="req">*</span> }</label>
        } @else {
          <label [attr.for]="'df-' + f.id">{{ f.label }}@if (f.required) { <span class="req"> *</span> }</label>
          @switch (f.type) {
            @case ('Selección') { <select [id]="'df-' + f.id" [ngModel]="values()[f.label] ?? ''" (ngModelChange)="set(f.label, $event)"><option value="">Selecciona…</option>@for (o of f.options; track o) { <option [value]="o">{{ o }}</option> }</select> }
            @case ('Número') { <input [id]="'df-' + f.id" type="number" inputmode="decimal" [placeholder]="f.placeholder" [ngModel]="values()[f.label] ?? ''" (ngModelChange)="set(f.label, $event)"> }
            @case ('Fecha') { <input [id]="'df-' + f.id" type="date" [ngModel]="values()[f.label] ?? ''" (ngModelChange)="set(f.label, $event)"> }
            @default { <input [id]="'df-' + f.id" type="text" [attr.maxlength]="f.maxLength || null" [placeholder]="f.type === 'Código de barras' ? 'Escribe o escanea el código' : f.placeholder" [ngModel]="values()[f.label] ?? ''" (ngModelChange)="set(f.label, $event)"> }
          }
        }
        @if (f.helpText) { <small class="help">{{ f.helpText }}</small> }
        @if (errorOf(f.label); as m) { <small class="err" role="alert">{{ m }}</small> }
      </div>
    }`,
})
export class DynamicFormComponent {
  readonly fields = input.required<FieldDef[]>();
  readonly values = model<Record<string, unknown>>({});
  readonly errors = input<FieldError[]>([]);
  visibleFields(): FieldDef[] { return this.fields().filter((f) => f.visible !== false && f.type !== 'Foto' && f.type !== 'Firma'); }
  errorOf(label: string): string { return this.errors().find((e) => e.field === label)?.message ?? ''; }
  set(label: string, value: unknown): void { this.values.update((v) => ({ ...v, [label]: value })); }
}
