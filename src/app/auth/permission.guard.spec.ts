import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService, UserDto } from '../services/auth.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { firstAccessiblePath, permissionGuard } from './permission.guard';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const user: UserDto = {
  userId: 1,
  username: 'alice',
  email: 'alice@example.com',
  fullName: null,
  active: true,
  lastLoginAt: null,
};

function snapshots(url: string): [ActivatedRouteSnapshot, RouterStateSnapshot] {
  return [{} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot];
}

describe('permissionGuard', () => {
  let auth: AuthService;
  let permissions: PermissionsService;

  function run(codes: string[], url = '/dashboard'): ReturnType<CanActivateFn> {
    const [route, state] = snapshots(url);
    return TestBed.runInInjectionContext(() => permissionGuard(...codes)(route, state));
  }

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    auth = TestBed.inject(AuthService);
    permissions = TestBed.inject(PermissionsService);
  });

  it('should allow the route when the user has one of the permissions', async () => {
    auth.currentUser.set(user);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    permissions.loaded.set(true);

    await expect(run([PERMISSIONS.promptsWrite, PERMISSIONS.promptsRead])).resolves.toBe(true);
  });

  it('should redirect to /sin-acceso when the user lacks the permissions', async () => {
    auth.currentUser.set(user);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    permissions.loaded.set(true);

    const result = await run([PERMISSIONS.dashboardRead]);
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/sin-acceso');
  });

  it('should redirect to /login when the user is not authenticated', async () => {
    const result = await run([PERMISSIONS.dashboardRead], '/service-request');
    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/login?redirect=%2Fservice-request');
  });

  it('should wait for the permissions load when they are not loaded yet', async () => {
    auth.currentUser.set(user);

    const pending = run([PERMISSIONS.dashboardRead]);
    const httpTesting = TestBed.inject(HttpTestingController);
    httpTesting
      .expectOne(`${API}/api/auth/me/permissions`)
      .flush({ profile: 'Reader', permissions: [PERMISSIONS.dashboardRead] });

    await expect(pending).resolves.toBe(true);
  });
});

describe('firstAccessiblePath', () => {
  it('should prefer the dashboard when readable', () => {
    const readable: string[] = [PERMISSIONS.dashboardRead, PERMISSIONS.promptsRead];
    expect(firstAccessiblePath((code) => readable.includes(code))).toBe('/dashboard');
  });

  it('should fall back to service-request when the dashboard is not readable', () => {
    const readable: string[] = [PERMISSIONS.serviceRequestsRead, PERMISSIONS.promptsRead];
    expect(firstAccessiblePath((code) => readable.includes(code))).toBe('/service-request');
  });

  it('should fall back to prompts when it is the only accessible module', () => {
    const has = (code: string) => code === PERMISSIONS.promptsRead;
    expect(firstAccessiblePath(has)).toBe('/prompts');
  });

  it('should fall back to usuarios when only manageable', () => {
    const has = (code: string) => code === PERMISSIONS.usersManage;
    expect(firstAccessiblePath(has)).toBe('/usuarios');
  });

  it('should fall back to business-model when it is the only accessible module', () => {
    const has = (code: string) => code === PERMISSIONS.businessModelRead;
    expect(firstAccessiblePath(has)).toBe('/business-model');
  });

  it('should fall back to cambiar-contrasena when there is no module access', () => {
    expect(firstAccessiblePath(() => false)).toBe('/cambiar-contrasena');
  });
});
