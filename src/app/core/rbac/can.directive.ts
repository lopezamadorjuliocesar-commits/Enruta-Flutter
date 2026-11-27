import { Directive, EmbeddedViewRef, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { PermissionStore } from './permission.store';

/** `<button *appCan="'routes.approve'">` — renderiza solo si la sesión tiene el permiso. */
@Directive({ selector: '[appCan]', standalone: true })
export class CanDirective {
  readonly appCan = input.required<string | string[]>();
  private readonly perms = inject(PermissionStore);
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private view: EmbeddedViewRef<unknown> | null = null;

  constructor() {
    effect(() => {
      const needed = this.appCan(); const list = Array.isArray(needed) ? needed : [needed];
      const allowed = list.every((c) => this.perms.can(c));
      if (allowed && !this.view) this.view = this.vcr.createEmbeddedView(this.tpl);
      else if (!allowed && this.view) { this.vcr.clear(); this.view = null; }
    });
  }
}
