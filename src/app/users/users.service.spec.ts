import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ManagedUser, Profile, UsersService } from './users.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const user: ManagedUser = {
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

const profile: Profile = { profileId: 1, name: 'Admin', description: null };

describe('UsersService', () => {
  let service: UsersService;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    service = TestBed.inject(UsersService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should list users', () => {
    service.list().subscribe((users) => expect(users).toEqual([user]));

    const req = httpTesting.expectOne(`${API}/api/users`);
    expect(req.request.method).toBe('GET');
    req.flush([user]);
  });

  it('should list profiles', () => {
    service.listProfiles().subscribe((profiles) => expect(profiles).toEqual([profile]));

    const req = httpTesting.expectOne(`${API}/api/users/profiles`);
    expect(req.request.method).toBe('GET');
    req.flush([profile]);
  });

  it('should create a user', () => {
    const payload = {
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
      fullName: 'Bob',
      profileId: 1,
    };
    service.create(payload).subscribe((created) => expect(created).toEqual(user));

    const req = httpTesting.expectOne(`${API}/api/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(user);
  });

  it('should update a user', () => {
    service.update(1, { fullName: 'Bobby', active: false }).subscribe();

    const req = httpTesting.expectOne(`${API}/api/users/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ fullName: 'Bobby', active: false });
    req.flush({ ...user, fullName: 'Bobby', active: false });
  });

  it('should reset a password', () => {
    service.resetPassword(1, 'newpass123').subscribe();

    const req = httpTesting.expectOne(`${API}/api/users/1/reset-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newPassword: 'newpass123' });
    req.flush(null);
  });

  it('should delete a user', () => {
    service.delete(1).subscribe();

    const req = httpTesting.expectOne(`${API}/api/users/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
