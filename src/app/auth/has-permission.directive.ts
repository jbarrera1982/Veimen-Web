import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { PermissionsService } from '../services/permissions.service';

// Directiva estructural: muestra el contenido solo si el usuario tiene el permiso.
// Uso: <button *appHasPermission="PERMISSIONS.promptsWrite">…</button>
// Reacciona a cambios del signal de permisos (tras login/refresh/logout).
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly permissions = inject(PermissionsService);
  private readonly templateRef = inject(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);

  readonly appHasPermission = input.required<string>();

  private hasView = false;

  constructor() {
    effect(() => {
      const allowed = this.permissions.has(this.appHasPermission());
      if (allowed && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!allowed && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
