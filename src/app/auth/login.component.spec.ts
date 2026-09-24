import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthResponse, UserDto } from '../services/auth.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const user: UserDto = {
  userId: 1,
  username: 'alice',
  email: 'alice@example.com',
  fullName: 'Alice',
  active: true,
  lastLoginAt: null,
};

const authResponse: AuthResponse = {
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  user,
};

describe('LoginComponent', () => {
  let httpTesting: HttpTestingController;
  let component: LoginComponent;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should submit credentials and navigate to the home route on success', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.form.patchValue({ identifier: 'alice', password: 'secret' });
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ identifier: 'alice', password: 'secret' });
    req.flush(authResponse);

    // El login encadena la carga de permisos antes de completar.
    httpTesting
      .expectOne(`${API}/api/auth/me/permissions`)
      .flush({ profile: null, permissions: [] });

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.error()).toBeNull();
  });

  it('should show the API error message on failure', () => {
    component.form.patchValue({ identifier: 'alice', password: 'wrong' });
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/auth/login`);
    req.flush({ message: 'Credenciales inválidas.' }, { status: 401, statusText: 'Unauthorized' });

    expect(component.error()).toBe('Credenciales inválidas.');
    expect(component.isSubmitting()).toBe(false);
  });

  it('should show a generic error when the server is unreachable', () => {
    component.form.patchValue({ identifier: 'alice', password: 'secret' });
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/auth/login`);
    req.flush(null, { status: 0, statusText: 'Unknown Error' });

    expect(component.error()).toBe('No se pudo conectar con el servidor. Verifica tu conexión.');
  });

  it('should not submit when the form is invalid', () => {
    component.form.patchValue({ identifier: '', password: '' });
    component.submit();

    httpTesting.verify();
    expect(component.error()).toBeNull();
  });
});
