import { ChangeDetectionStrategy, Component, ElementRef, output, signal, viewChild } from '@angular/core';

/** Lienzo de firma (táctil/ratón). Emite un PNG real al confirmar; no genera firmas por sí mismo. */
@Component({
  selector: 'app-signature-pad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`canvas{display:block;width:100%;height:180px;background:#fff;border:1px dashed #9db0c4;border-radius:10px;touch-action:none}.row{display:flex;gap:8px;margin-top:8px}.row button{flex:1}`],
  template: `
    <canvas #c width="560" height="180" aria-label="Área de firma"
      (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointerleave)="up()" (pointercancel)="up()"></canvas>
    <div class="row"><button type="button" class="ghost" (click)="clear()">Borrar</button><button type="button" class="ghost" [disabled]="!dirty()" (click)="confirm()">Guardar firma</button></div>`,
})
export class SignaturePadComponent {
  readonly signed = output<Blob>();
  readonly dirty = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private drawing = false;

  private pos(e: PointerEvent): { x: number; y: number } {
    const el = this.canvas().nativeElement; const r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * el.width, y: ((e.clientY - r.top) / r.height) * el.height };
  }
  down(e: PointerEvent): void {
    const el = this.canvas().nativeElement; const ctx = el.getContext('2d'); if (!ctx) return;
    el.setPointerCapture?.(e.pointerId); this.drawing = true; const p = this.pos(e);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke(); this.dirty.set(true);
  }
  move(e: PointerEvent): void {
    if (!this.drawing) return; const ctx = this.canvas().nativeElement.getContext('2d'); if (!ctx) return; const p = this.pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  up(): void { this.drawing = false; }
  clear(): void { const el = this.canvas().nativeElement; el.getContext('2d')?.clearRect(0, 0, el.width, el.height); this.dirty.set(false); }
  confirm(): void { if (!this.dirty()) return; this.canvas().nativeElement.toBlob((b) => { if (b) { this.signed.emit(b); this.clear(); } }, 'image/png'); }
}
