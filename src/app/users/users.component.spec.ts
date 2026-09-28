import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { UsersComponent } from './users.component';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const user = {
  userId: 1,
  username: 'bob',
  email: 'bob@example.com',
  fullName: 'Bob',
  active: true,
  profileId: 1,
  profileName: 'Admin',
  lastLoginAt: null,
  createdAt: '2026-09-01T10:00:00Z',
};

describe('UsersComponent', () => {
  let httpTesting: HttpTestingController;
  let component: UsersComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UsersComponent);
    component = fixture.componentInstance;

    httpTesting.expectOne(`${API}/api/users`).flush([user]);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should create the component with the loaded users', () => {
    expect(component).toBeTruthy();
    expect(component.usersList().length).toBe(1);
    expect(component.isLoading()).toBe(false);
  });

  it('should navigate to the form on create', () => {
    const navigateSpy = vi.spyOn(component.router, 'navigate').mockResolvedValue(true);
    component.openCreate();
    expect(navigateSpy).toHaveBeenCalledWith(['/usuarios/nuevo']);
  });

  it('should navigate to the form on edit', () => {
    const navigateSpy = vi.spyOn(component.router, 'navigate').mockResolvedValue(true);
    component.openEdit(component.usersList()[0]);
    expect(navigateSpy).toHaveBeenCalledWith(['/usuarios', 1]);
  });

  it('should open and close the password dialog', () => {
    component.openPassword(component.usersList()[0]);
    expect(component.dialog()?.kind).toBe('password');

    component.closeDialog();
    expect(component.dialog()).toBeNull();
  });

  it('should reset the password', () => {
    component.openPassword(component.usersList()[0]);
    component.passwordForm.patchValue({ newPassword: 'password123' });
    component.submitPassword();

    const req = httpTesting.expectOne(`${API}/api/users/1/reset-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newPassword: 'password123' });
    req.flush(null);

    expect(component.dialog()).toBeNull();
    expect(component.notice()).toContain('bob');
  });

  it('should sort active users first and then by username', () => {
    const fixture = TestBed.createComponent(UsersComponent);
    httpTesting.expectOne(`${API}/api/users`).flush([
      { ...user, userId: 2, username: 'zara', active: false },
      { ...user, userId: 3, username: 'ana', active: true },
      { ...user, userId: 4, username: 'maria', active: false },
      { ...user, userId: 1, username: 'bob', active: true },
    ]);
    fixture.detectChanges();

    const usernames = fixture.componentInstance.usersList().map((u) => u.username);
    expect(usernames).toEqual(['ana', 'bob', 'maria', 'zara']);
  });

  it('should show the notice passed via navigation state', () => {
    window.history.replaceState({ notice: 'Usuario alice creado correctamente.' }, '');
    try {
      const fixture = TestBed.createComponent(UsersComponent);
      httpTesting.expectOne(`${API}/api/users`).flush([user]);
      fixture.detectChanges();

      expect(fixture.componentInstance.notice()).toBe('Usuario alice creado correctamente.');
      expect(fixture.nativeElement.textContent).toContain('Usuario alice creado correctamente.');
    } finally {
      window.history.replaceState({}, '');
    }
  });

  it('should deactivate an active user after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.toggleActive(component.usersList()[0]);

    const req = httpTesting.expectOne(`${API}/api/users/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: false });
    req.flush({ ...user, active: false });

    expect(component.usersList()[0].active).toBe(false);
    expect(component.notice()).toContain('desactivado');
  });

  it('should activate an inactive user after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.usersList.set([{ ...user, active: false }]);

    component.toggleActive(component.usersList()[0]);

    const req = httpTesting.expectOne(`${API}/api/users/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: true });
    req.flush({ ...user, active: true });

    expect(component.usersList()[0].active).toBe(true);
    expect(component.notice()).toContain('activado');
  });

  it('should not toggle the user when confirmation is cancelled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    component.toggleActive(component.usersList()[0]);

    expect(confirmSpy).toHaveBeenCalled();
    expect(component.usersList()[0].active).toBe(true);
  });
});
