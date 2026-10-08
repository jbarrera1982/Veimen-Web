import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthResponse, UserDto } from './auth.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;
const WEBHOOK = 'https://veimen.app.n8n.cloud/webhook/dashboard-by-status';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const user: UserDto = {
  userId: 1,
  username: 'alice',
  email: 'alice@example.com',
  fullName: null,
  active: true,
  lastLoginAt: null,
};

const newAuth: AuthResponse = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  user,
};

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should attach the bearer token to API requests', () => {
    localStorage.setItem('veimen-web.accessToken', 'access-123');

    http.get(`${API}/data`).subscribe(() => undefined);
    const req = httpTesting.expectOne(`${API}/data`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-123');
    req.flush({});
  });

  it('should not attach the token to non-API requests', () => {
    localStorage.setItem('veimen-web.accessToken', 'access-123');

    http.get(WEBHOOK).subscribe(() => undefined);
    const req = httpTesting.expectOne(WEBHOOK);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('should refresh the token and retry the request on 401', async () => {
    localStorage.setItem('veimen-web.accessToken', 'old-access');
    localStorage.setItem('veimen-web.refreshToken', 'refresh-456');

    const responsePromise = firstValueFrom(http.get(`${API}/data`));

    const first = httpTesting.expectOne(`${API}/data`);
    expect(first.request.headers.get('Authorization')).toBe('Bearer old-access');
    first.flush({ message: 'Token expired' }, { status: 401, statusText: 'Unauthorized' });

    const refreshReq = httpTesting.expectOne(`${API}/api/auth/refresh`);
    expect(refreshReq.request.method).toBe('POST');
    expect(refreshReq.request.headers.has('Authorization')).toBe(false);
    expect(refreshReq.request.body).toEqual({ refreshToken: 'refresh-456' });
    refreshReq.flush(newAuth);

    // El refresh encadena la recarga de permisos antes de reintentar la petición original.
    httpTesting
      .expectOne(`${API}/api/auth/me/permissions`)
      .flush({ profile: 'Admin', permissions: [] });

    await tick();

    const retried = httpTesting.expectOne(`${API}/data`);
    expect(retried.request.headers.get('Authorization')).toBe('Bearer new-access');
    retried.flush([{ ok: true }]);

    expect(await responsePromise).toEqual([{ ok: true }]);
  });

  it('should clear the session and redirect to login when refresh fails', async () => {
    localStorage.setItem('veimen-web.accessToken', 'old-access');
    localStorage.setItem('veimen-web.refreshToken', 'refresh-456');
    localStorage.setItem(
      'veimen-web.accessTokenExpiry',
      new Date(Date.now() - 1000).toISOString(),
    );
    localStorage.setItem('veimen-web.user', JSON.stringify(user));

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const responsePromise = firstValueFrom(http.get(`${API}/data`)).catch(() => 'failed');

    httpTesting
      .expectOne(`${API}/data`)
      .flush({ message: 'Token expired' }, { status: 401, statusText: 'Unauthorized' });

    httpTesting
      .expectOne(`${API}/api/auth/refresh`)
      .flush({ message: 'Invalid refresh token' }, { status: 401, statusText: 'Unauthorized' });

    await tick();

    expect(await responsePromise).toBe('failed');
    expect(localStorage.getItem('veimen-web.accessToken')).toBeNull();
    expect(localStorage.getItem('veimen-web.user')).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { redirect: expect.any(String) },
    });
  });

  it('should not attach a token when there is no session', () => {
    http.get(`${API}/data`).subscribe(() => undefined);
    const req = httpTesting.expectOne(`${API}/data`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
