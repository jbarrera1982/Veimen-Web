import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangePasswordComponent } from './change-password.component';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

describe('ChangePasswordComponent', () => {
  let httpTesting: HttpTestingController;
  let component: ChangePasswordComponent;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ChangePasswordComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function fillValidForm(): void {
    component.form.patchValue({
      currentPassword: 'oldpass',
      newPassword: 'newpass123',
      confirmPassword: 'newpass123',
    });
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should change the password and show a success message', () => {
    fillValidForm();
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/auth/change-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ currentPassword: 'oldpass', newPassword: 'newpass123' });
    req.flush(null);

    expect(component.success()).toBe(true);
    expect(component.error()).toBeNull();
    expect(component.isSubmitting()).toBe(false);
  });

  it('should show the API error message on failure', () => {
    fillValidForm();
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/auth/change-password`);
    req.flush(
      { message: 'La contraseña actual es incorrecta.' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(component.error()).toBe('La contraseña actual es incorrecta.');
    expect(component.success()).toBe(false);
    expect(component.isSubmitting()).toBe(false);
  });

  it('should not submit when the new passwords do not match', () => {
    component.form.patchValue({
      currentPassword: 'oldpass',
      newPassword: 'newpass123',
      confirmPassword: 'otherpass',
    });
    component.submit();

    httpTesting.verify();
    expect(component.success()).toBe(false);
  });

  it('should not submit when the new password is too short', () => {
    component.form.patchValue({
      currentPassword: 'oldpass',
      newPassword: 'short',
      confirmPassword: 'short',
    });
    component.submit();

    httpTesting.verify();
    expect(component.success()).toBe(false);
  });
});
