import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="access-denied">
      <h1>Acceso denegado</h1>
      <p>No tienes permiso para acceder a esta sección.</p>
      @if (profile(); as currentProfile) {
        <p class="profile-note">
          Tu perfil actual es <strong>{{ currentProfile }}</strong
          >. Contacta a un administrador si necesitas más accesos.
        </p>
      }
      <a routerLink="/" class="back-link">Volver al inicio</a>
    </div>
  `,
  styles: `
    .access-denied {
      max-width: 28rem;
      margin: 4rem auto;
      padding: 0 1rem;
      text-align: center;
      display: grid;
      gap: 1rem;
    }

    .access-denied h1 {
      margin: 0;
    }

    .access-denied p {
      margin: 0;
    }

    .back-link {
      color: inherit;
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessDeniedComponent {
  private readonly permissions = inject(PermissionsService);
  readonly profile = this.permissions.profile;
}
