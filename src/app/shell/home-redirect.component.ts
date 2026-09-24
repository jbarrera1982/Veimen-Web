import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PermissionsService } from '../services/permissions.service';
import { firstAccessiblePath } from '../auth/permission.guard';

// Ruta raíz ('/'): redirige al primer módulo al que el usuario tiene acceso.
// Se usa un componente (y no un guard) porque Angular exige que toda ruta tenga
// component/redirectTo/children (NG04014). El authGuard del padre ya garantizó
// que hay sesión; aquí solo se resuelve el destino según los permisos.
@Component({
  selector: 'app-home-redirect',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeRedirectComponent implements OnInit {
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    if (!this.permissions.loaded()) {
      await firstValueFrom(this.permissions.load());
    }
    await this.router.navigateByUrl(firstAccessiblePath((code) => this.permissions.has(code)));
  }
}
