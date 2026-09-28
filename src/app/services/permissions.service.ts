import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';

// Códigos de permiso: deben coincidir con Services/Permissions.cs del backend
// (y con la tabla 'permission' de la base de datos).
export const PERMISSIONS = {
  promptsRead: 'prompts.read',
  promptsWrite: 'prompts.write',
  serviceRequestsRead: 'service-requests.read',
  dashboardRead: 'dashboard.read',
  usersManage: 'users.manage',
  businessModelRead: 'businessModel.read',
} as const;

export interface UserPermissionsDto {
  profile: string | null;
  permissions: string[];
}

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  readonly profile = signal<string | null>(null);
  readonly permissions = signal<readonly string[]>([]);
  // true cuando ya se consultaron los permisos al menos una vez (con éxito o error).
  readonly loaded = signal(false);

  has(permission: string): boolean {
    return this.permissions().includes(permission);
  }

  hasAny(...codes: string[]): boolean {
    return codes.some((code) => this.has(code));
  }

  // Consulta GET /api/auth/me/permissions (el interceptor adjunta el Bearer).
  // Los permisos se guardan solo en memoria: se recargan en login/refresh/arranque
  // para reflejar los cambios de BD (que aplican al renovar el access token).
  load(): Observable<void> {
    return this.http.get<UserPermissionsDto>(`${this.apiBaseUrl}/api/auth/me/permissions`).pipe(
      tap((dto) => {
        this.profile.set(dto.profile);
        this.permissions.set(dto.permissions);
        this.loaded.set(true);
      }),
      map(() => undefined),
      catchError(() => {
        // Ante un error no bloqueamos el arranque ni la navegación: se marca como
        // cargado sin permisos, así guards/directivas ocultan todo en vez de fallar.
        this.profile.set(null);
        this.permissions.set([]);
        this.loaded.set(true);
        return of(undefined);
      }),
    );
  }

  clear(): void {
    this.profile.set(null);
    this.permissions.set([]);
    this.loaded.set(false);
  }
}
