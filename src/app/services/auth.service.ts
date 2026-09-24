import { HttpClient, HttpContext, HttpContextToken } from '@angular/common/http';
import { PLATFORM_ID, computed, inject, Injectable, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  catchError,
  finalize,
  firstValueFrom,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { environment } from '../../environments/environment';
import { PermissionsService } from './permissions.service';

export interface UserDto {
  userId: number;
  username: string;
  email: string;
  fullName: string | null;
  active: boolean;
  lastLoginAt: string | null;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  user: UserDto;
}

export const AUTH_ALLOW_ANON = new HttpContextToken<boolean>(() => false);

const ACCESS_TOKEN_KEY = 'veimen-web.accessToken';
const REFRESH_TOKEN_KEY = 'veimen-web.refreshToken';
const ACCESS_TOKEN_EXPIRY_KEY = 'veimen-web.accessTokenExpiry';
const USER_KEY = 'veimen-web.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly permissions = inject(PermissionsService);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  readonly currentUser = signal<UserDto | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  constructor() {
    if (this.isBrowser) {
      this.restoreUser();
    }
  }

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  login(identifier: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${this.apiBaseUrl}/api/auth/login`,
        { identifier, password },
        { context: new HttpContext().set(AUTH_ALLOW_ANON, true) },
      )
      .pipe(
        tap((resp) => this.persistAuth(resp)),
        // Tras login, cargar los permisos del usuario para guards y directivas.
        switchMap((resp) => this.permissions.load().pipe(map(() => resp))),
      );
  }

  refresh(): Observable<AuthResponse> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return throwError(() => new Error('No hay token de refresco.'));
    }

    return this.http
      .post<AuthResponse>(
        `${this.apiBaseUrl}/api/auth/refresh`,
        { refreshToken },
        { context: new HttpContext().set(AUTH_ALLOW_ANON, true) },
      )
      .pipe(
        tap((resp) => {
          this.persistAuth(resp);
          // El nuevo access token puede traer permisos distintos: recargarlos en segundo
          // plano SIN encadenarlos al observable. Encadenarlos (switchMap) interbloquearía
          // al authInterceptor: ante un 401 reintenta esperando este mismo refresh.
          this.permissions.load().subscribe();
        }),
      );
  }

  getProfile(): Observable<UserDto> {
    return this.http.get<UserDto>(`${this.apiBaseUrl}/api/auth/me`).pipe(
      tap((user) => {
        this.currentUser.set(user);
        this.storeUser(user);
      }),
    );
  }

  logout(): Observable<void> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      this.clearSession();
      return of(undefined);
    }

    return this.http.post<void>(`${this.apiBaseUrl}/api/auth/logout`, { refreshToken }).pipe(
      map(() => undefined),
      catchError(() => of(undefined)),
      finalize(() => this.clearSession()),
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http
      .post<void>(`${this.apiBaseUrl}/api/auth/change-password`, { currentPassword, newPassword })
      .pipe(map(() => undefined));
  }

  getAccessToken(): string | null {
    return this.isBrowser ? this.read(ACCESS_TOKEN_KEY) : null;
  }

  getRefreshToken(): string | null {
    return this.isBrowser ? this.read(REFRESH_TOKEN_KEY) : null;
  }

  isAccessTokenExpired(): boolean {
    const raw = this.isBrowser ? this.read(ACCESS_TOKEN_EXPIRY_KEY) : null;
    if (!raw) {
      return true;
    }

    const expiresAt = new Date(raw).getTime();
    return Number.isNaN(expiresAt) || expiresAt <= Date.now() + 30_000;
  }

  initialize(): Promise<void> {
    if (!this.isBrowser) {
      return Promise.resolve();
    }

    if (!this.getAccessToken() && !this.getRefreshToken()) {
      this.clearSession();
      return Promise.resolve();
    }

    if (this.isAccessTokenExpired()) {
      return new Promise<void>((resolve) => {
        this.refresh()
          .pipe(catchError(() => of(null)))
          .subscribe({
            next: (resp) => {
              if (resp) {
                this.getProfile()
                  .pipe(catchError(() => of(null)))
                  .subscribe();
              }
              resolve();
            },
            error: () => resolve(),
          });
      });
    }

    if (!this.currentUser()) {
      this.getProfile()
        .pipe(
          catchError(() => {
            this.clearSession();
            return of(null);
          }),
        )
        .subscribe();
    }

    // Esperar la carga de permisos para que los guards tengan datos antes del primer render.
    return firstValueFrom(this.permissions.load());
  }

  clearSession(): void {
    if (this.isBrowser) {
      this.remove(ACCESS_TOKEN_KEY);
      this.remove(REFRESH_TOKEN_KEY);
      this.remove(ACCESS_TOKEN_EXPIRY_KEY);
      this.remove(USER_KEY);
    }
    this.currentUser.set(null);
    this.permissions.clear();
  }

  private restoreUser(): void {
    if (!this.isBrowser) {
      return;
    }

    const raw = this.read(USER_KEY);
    if (!raw) {
      return;
    }

    try {
      this.currentUser.set(JSON.parse(raw) as UserDto);
    } catch {
      this.clearSession();
    }
  }

  private persistAuth(resp: AuthResponse): void {
    if (this.isBrowser) {
      this.write(ACCESS_TOKEN_KEY, resp.accessToken);
      this.write(REFRESH_TOKEN_KEY, resp.refreshToken);
      this.write(ACCESS_TOKEN_EXPIRY_KEY, resp.accessTokenExpiresAt);
      this.storeUser(resp.user);
    }
    this.currentUser.set(resp.user);
  }

  private storeUser(user: UserDto): void {
    if (this.isBrowser) {
      this.write(USER_KEY, JSON.stringify(user));
    }
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore storage errors */
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore storage errors */
    }
  }
}
