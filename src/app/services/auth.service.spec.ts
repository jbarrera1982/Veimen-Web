import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { AuthService, AuthResponse, UserDto } from './auth.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const user: UserDto = {
  userId: 1,
  username: 'alice',
  email: 'alice@example.com',
  fullName: 'Alice Wonder',
  active: true,
  lastLoginAt: '2026-09-15T10:00:00Z',
};

const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const authResponse: AuthResponse = {
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  accessTokenExpiresAt: expiresAt,
  refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  user,
};

// login/refresh cargan los permisos del usuario tras persistir la sesión.
const PERMISSIONS_URL = `${API}/api/auth/me/permissions`;
const PERMISSIONS_DTO = { profile: 'Admin', permissions: ['prompts.read'] };

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login and persist the session', () => {
    service.login('alice', 'secret').subscribe({
      next: (resp) => expect(resp).toEqual(authResponse),
      error: () => expect.unreachable('should not error'),
    });

    const req = httpTesting.expectOne(`${API}/api/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.body).toEqual({ identifier: 'alice', password: 'secret' });
    req.flush(authResponse);

    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    expect(service.currentUser()).toEqual(user);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getAccessToken()).toBe('access-123');
    expect(service.getRefreshToken()).toBe('refresh-456');
    expect(localStorage.getItem('veimen-web.accessToken')).toBe('access-123');
    expect(localStorage.getItem('veimen-web.refreshToken')).toBe('refresh-456');
    expect(localStorage.getItem('veimen-web.user')).toBe(JSON.stringify(user));
  });

  it('should restore the user from localStorage on construction', () => {
    TestBed.resetTestingModule();

    localStorage.setItem('veimen-web.user', JSON.stringify(user));
    localStorage.setItem('veimen-web.accessToken', 'access-123');

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    const restarted = TestBed.inject(AuthService);

    expect(restarted.currentUser()).toEqual(user);
    expect(restarted.isAuthenticated()).toBe(true);
  });

  it('should refresh the token pair', () => {
    localStorage.setItem('veimen-web.refreshToken', 'refresh-456');

    service.refresh().subscribe({
      next: (resp) => expect(resp.accessToken).toBe('new-access'),
      error: () => expect.unreachable('should not error'),
    });

    const req = httpTesting.expectOne(`${API}/api/auth/refresh`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refreshToken: 'refresh-456' });
    req.flush({ ...authResponse, accessToken: 'new-access', refreshToken: 'new-refresh' });

    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    expect(service.getAccessToken()).toBe('new-access');
    expect(service.getRefreshToken()).toBe('new-refresh');
  });

  it('should error on refresh when there is no stored refresh token', () => {
    let errored = false;
    service.refresh().subscribe({
      next: () => expect.unreachable('should not emit'),
      error: () => (errored = true),
    });

    expect(errored).toBe(true);
  });

  it('should fetch the profile and update the user signal', () => {
    localStorage.setItem('veimen-web.accessToken', 'access-123');

    service.getProfile().subscribe({
      next: (resp) => expect(resp).toEqual(user),
      error: () => expect.unreachable('should not error'),
    });

    const req = httpTesting.expectOne(`${API}/api/auth/me`);
    expect(req.request.method).toBe('GET');
    req.flush(user);

    expect(service.currentUser()).toEqual(user);
  });

  it('should clear the session on logout and revoke the refresh token', () => {
    service.login('alice', 'secret').subscribe();
    httpTesting.expectOne(`${API}/api/auth/login`).flush(authResponse);
    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    service.logout().subscribe();

    const req = httpTesting.expectOne(`${API}/api/auth/logout`);
    expect(req.request.body).toEqual({ refreshToken: 'refresh-456' });
    req.flush(null);

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('veimen-web.accessToken')).toBeNull();
    expect(localStorage.getItem('veimen-web.user')).toBeNull();
  });

  it('should clear the session even if the logout call fails', () => {
    service.login('alice', 'secret').subscribe();
    httpTesting.expectOne(`${API}/api/auth/login`).flush(authResponse);
    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    service.logout().subscribe();
    httpTesting
      .expectOne(`${API}/api/auth/logout`)
      .flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
  });

  it('should keep the session while the logout request is in flight', () => {
    service.login('alice', 'secret').subscribe();
    httpTesting.expectOne(`${API}/api/auth/login`).flush(authResponse);
    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    service.logout().subscribe();

    expect(service.isAuthenticated()).toBe(true);
    expect(service.getAccessToken()).toBe('access-123');

    httpTesting.expectOne(`${API}/api/auth/logout`).flush(null);

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
  });

  it('should change the password', () => {
    service.changePassword('oldpass', 'newpass123').subscribe({
      error: () => expect.unreachable('should not error'),
    });

    const req = httpTesting.expectOne(`${API}/api/auth/change-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ currentPassword: 'oldpass', newPassword: 'newpass123' });
    req.flush(null);
  });

  it('should report an expired access token', () => {
    localStorage.setItem(
      'veimen-web.accessTokenExpiry',
      new Date(Date.now() - 60 * 1000).toISOString(),
    );

    expect(service.isAccessTokenExpired()).toBe(true);

    localStorage.setItem('veimen-web.accessTokenExpiry', expiresAt);
    expect(service.isAccessTokenExpired()).toBe(false);
  });

  it('should refresh a valid session during initialize when the access token is expired', async () => {
    localStorage.setItem('veimen-web.refreshToken', 'refresh-456');
    localStorage.setItem(
      'veimen-web.accessTokenExpiry',
      new Date(Date.now() - 60 * 1000).toISOString(),
    );

    const init = service.initialize();

    const refreshReq = httpTesting.expectOne(`${API}/api/auth/refresh`);
    refreshReq.flush({ ...authResponse, accessToken: 'new-access' });

    httpTesting.expectOne(PERMISSIONS_URL).flush(PERMISSIONS_DTO);

    const meReq = httpTesting.expectOne(`${API}/api/auth/me`);
    meReq.flush(user);

    await init;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.getAccessToken()).toBe('new-access');
  });

  it('should clear the session when initialize finds no tokens', async () => {
    localStorage.clear();

    await service.initialize();

    expect(service.isAuthenticated()).toBe(false);
    httpTesting.verify();
  });

  it('should be a no-op on the server platform', async () => {
    TestBed.resetTestingModule();

    localStorage.setItem('veimen-web.accessToken', 'access-123');
    localStorage.setItem('veimen-web.refreshToken', 'refresh-456');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    const serverService = TestBed.inject(AuthService);

    expect(serverService.getAccessToken()).toBeNull();
    expect(serverService.getRefreshToken()).toBeNull();
    expect(serverService.currentUser()).toBeNull();

    await serverService.initialize();

    expect(serverService.isAuthenticated()).toBe(false);
  });
});
