import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ClientContextService } from '../services/client-context.service';
import { PermissionsService, PERMISSIONS } from '../services/permissions.service';

// Guard factory: permite la ruta si el usuario tiene al menos uno de los permisos dados.
// Red de seguridad: si los permisos aún no se cargaron (ej: F5 en una ruta protegida),
// espera la carga antes de decidir. Sin permiso redirige a /sin-acceso.
// Solo UX: la seguridad real la aplican las policies del backend.
export function permissionGuard(...codes: string[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const permissions = inject(PermissionsService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    }

    if (!permissions.loaded()) {
      await firstValueFrom(permissions.load());
    }

    if (codes.length === 0 || permissions.hasAny(...codes)) {
      return true;
    }

    return router.createUrlTree(['/sin-acceso']);
  };
}

// Bloquea una ruta a los usuarios con cliente asociado (p. ej. Clientes): redirige a /sin-acceso.
export const withoutAssociatedClientGuard: CanActivateFn = () => {
  const clientContext = inject(ClientContextService);
  const router = inject(Router);

  return clientContext.hasAssociatedClient() ? router.createUrlTree(['/sin-acceso']) : true;
};

// Calcula la ruta del primer módulo al que el usuario tiene acceso,
// en el mismo orden que el sidebar. /cambiar-contrasena siempre es accesible.
// Un usuario con cliente asociado no aterriza en Clientes (la ruta está bloqueada).
// Función pura para poder reutilizarla fuera de un guard (HomeRedirectComponent).
export function firstAccessiblePath(
  has: (code: string) => boolean,
  hasAssociatedClient = false,
): string {
  if (has(PERMISSIONS.dashboardRead)) {
    return '/dashboard';
  }
  if (has(PERMISSIONS.tokensRead)) {
    return '/tokens';
  }
  if (has(PERMISSIONS.usageRead)) {
    return '/uso-openai';
  }
  if (has(PERMISSIONS.mailScan)) {
    return '/procesamiento';
  }
  if (has(PERMISSIONS.serviceRequestsRead)) {
    return '/service-request';
  }
  if (!hasAssociatedClient && has(PERMISSIONS.clientsRead)) {
    return '/clientes';
  }
  if (has(PERMISSIONS.usersManage)) {
    return '/usuarios';
  }
  if (has(PERMISSIONS.promptsRead)) {
    return '/prompts';
  }
  if (has(PERMISSIONS.businessModelRead)) {
    return '/business-model';
  }
  return '/cambiar-contrasena';
}
