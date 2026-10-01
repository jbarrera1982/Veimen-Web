import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import { AuthService, UserDto } from './services/auth.service';
import { PERMISSIONS, PermissionsService } from './services/permissions.service';

const user: UserDto = {
  userId: 1,
  username: 'alice',
  email: 'alice@example.com',
  fullName: null,
  active: true,
  lastLoginAt: null,
};

describe('app.routes wiring', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should redirect an unauthenticated user from / to /login', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    expect(router.url).toContain('/login');
  });

  it('should redirect /business-model to /sin-acceso without the businessModel.read permission', async () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set(user);
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    permissions.loaded.set(true);

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/business-model');

    expect(router.url).toContain('/sin-acceso');
  });

  it('should allow /business-model with the businessModel.read permission', async () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set(user);
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.businessModelRead]);
    permissions.loaded.set(true);

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/business-model');

    expect(router.url).toBe('/business-model');
  });

  it('should redirect /tokens to /sin-acceso without the tokens.read permission', async () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set(user);
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.dashboardRead]);
    permissions.loaded.set(true);

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/tokens');

    expect(router.url).toContain('/sin-acceso');
  });
});
