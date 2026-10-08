import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, HasPermissionDirective],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  readonly PERMISSIONS = PERMISSIONS;

  readonly isMenuOpen = signal(false);

  readonly currentUser = this.auth.currentUser;

  // La categoría "Monitorear" se oculta si el usuario no tiene ninguno de sus permisos.
  readonly canMonitor = computed(() =>
    this.permissions.hasAny(
      PERMISSIONS.dashboardRead,
      PERMISSIONS.tokensRead,
      PERMISSIONS.usageRead,
      PERMISSIONS.serviceRequestsRead,
    ),
  );

  // "Administrar" se oculta si el usuario no tiene ninguno de sus permisos
  // (Clientes, Usuarios o Prompts).
  readonly canManage = computed(() =>
    this.permissions.hasAny(
      PERMISSIONS.clientsRead,
      PERMISSIONS.usersManage,
      PERMISSIONS.promptsRead,
    ),
  );

  readonly displayName = computed(() => {
    const user = this.currentUser();
    if (!user) {
      return '';
    }
    return user.fullName?.trim() || user.username;
  });

  readonly initials = computed(() => {
    const name = this.displayName();
    if (!name) {
      return '?';
    }
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  });

  toggleMenu(): void {
    this.isMenuOpen.update((open) => !open);
  }

  logout(): void {
    this.auth.logout().subscribe();
    void this.router.navigate(['/login']);
  }
}
