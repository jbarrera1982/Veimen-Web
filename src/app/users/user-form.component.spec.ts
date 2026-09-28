import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { UserFormComponent } from './user-form.component';
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

const profiles = [{ profileId: 1, name: 'Admin', description: null }];

describe('UserFormComponent', () => {
  let httpTesting: HttpTestingController;

  async function setup(id: string | null) {
    await TestBed.configureTestingModule({
      imports: [UserFormComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } },
    });

    httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UserFormComponent);
    return fixture;
  }

  function flushCreateLoad() {
    httpTesting.expectOne(`${API}/api/users/profiles`).flush(profiles);
  }

  function flushEditLoad(users = [user]) {
    httpTesting.expectOne(`${API}/api/users/profiles`).flush(profiles);
    httpTesting.expectOne(`${API}/api/users`).flush(users);
  }

  afterEach(() => {
    httpTesting.verify();
  });

  it('should start in create mode without id', async () => {
    const fixture = await setup(null);
    flushCreateLoad();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isEdit()).toBe(false);
    expect(component.isLoading()).toBe(false);
    expect(component.notFound()).toBe(false);
  });

  it('should create the user and navigate back', async () => {
    const fixture = await setup(null);
    flushCreateLoad();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.patchValue({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      fullName: 'Alice',
      profileId: 1,
    });
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      fullName: 'Alice',
      profileId: 1,
      active: true,
    });
    req.flush({ ...user, userId: 2, username: 'alice' });
    fixture.detectChanges();

    expect(component.notFound()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('El usuario no existe.');
    expect(navigateSpy).toHaveBeenCalledWith(['/usuarios'], {
      state: { notice: 'Usuario alice creado correctamente.' },
    });
  });

  it('should load the user into the form', async () => {
    const fixture = await setup('1');
    flushEditLoad();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isLoading()).toBe(false);
    expect(component.user()?.username).toBe('bob');
    expect(component.form.value.email).toBe('bob@example.com');
    expect(component.form.value.profileId).toBe(1);
  });

  it('should update the user including the email and navigate back', async () => {
    const fixture = await setup('1');
    flushEditLoad();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.patchValue({ email: 'nuevo@example.com', fullName: 'Bobby' });
    component.submit();

    const req = httpTesting.expectOne(`${API}/api/users/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      email: 'nuevo@example.com',
      fullName: 'Bobby',
      profileId: 1,
      active: true,
    });
    req.flush({ ...user, email: 'nuevo@example.com' });

    expect(navigateSpy).toHaveBeenCalledWith(['/usuarios']);
  });

  it('should show not found when the user does not exist', async () => {
    const fixture = await setup('999');
    flushEditLoad([]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.notFound()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('El usuario no existe.');
  });

  it('should show an error message when the update fails', async () => {
    const fixture = await setup('1');
    flushEditLoad();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.form.patchValue({ email: 'otro@example.com' });
    component.submit();

    httpTesting
      .expectOne(`${API}/api/users/1`)
      .flush(
        { message: 'El correo electrónico ya está en uso.' },
        { status: 409, statusText: 'Conflict' },
      );

    expect(component.error()).toBe('El correo electrónico ya está en uso.');
    expect(component.isSaving()).toBe(false);
  });
});
