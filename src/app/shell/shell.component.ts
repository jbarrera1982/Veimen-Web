import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ClientContextService } from '../services/client-context.service';
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
export class ShellComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly clientContext = inject(ClientContextService);

  readonly PERMISSIONS = PERMISSIONS;

  readonly isMenuOpen = signal(false);

  readonly currentUser = this.auth.currentUser;

  // Filtro global de cliente: el menú es el único que lo edita. El contexto lo
  // consumen los filtros internos de cada componente.
  readonly selectableClients = this.clientContext.selectableClients;
  readonly selectedClient = this.clientContext.selectedClient;
  readonly selectedClientName = this.clientContext.selectedClientName;
  readonly hasAssociatedClient = this.clientContext.hasAssociatedClient;
  readonly associatedClientId = this.clientContext.associatedClientId;

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
  // (Clientes, Usuarios o Prompts). Un usuario con cliente asociado no ve Clientes.
  readonly canManage = computed(() =>
    this.permissions.hasAny(
      ...(this.hasAssociatedClient() ? [] : [PERMISSIONS.clientsRead]),
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

  ngOnInit(): void {
    // Carga los clientes para poblar el filtro global (el GET no exige clients.read).
    this.clientContext.ensureLoaded();
  }

  /** Selecciona el cliente del desplegable del menú ('' = Todos). */
  onClientChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.clientContext.selectClient(value ? Number(value) : null);
  }

  toggleMenu(): void {
    this.isMenuOpen.update((open) => !open);
  }

  logout(): void {
    this.clientContext.reset();
    this.auth.logout().subscribe();
    void this.router.navigate(['/login']);
  }
}
