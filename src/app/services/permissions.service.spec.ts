import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PermissionsService, PERMISSIONS, UserPermissionsDto } from './permissions.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

const dto: UserPermissionsDto = {
  profile: 'Admin',
  permissions: [PERMISSIONS.promptsRead, PERMISSIONS.promptsWrite],
};

describe('PermissionsService', () => {
  let service: PermissionsService;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    service = TestBed.inject(PermissionsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should load the permissions and expose them', () => {
    service.load().subscribe({
      error: () => expect.unreachable('should not error'),
    });

    const req = httpTesting.expectOne(`${API}/api/auth/me/permissions`);
    expect(req.request.method).toBe('GET');
    req.flush(dto);

    expect(service.profile()).toBe('Admin');
    expect(service.permissions()).toEqual(dto.permissions);
    expect(service.loaded()).toBe(true);
    expect(service.has(PERMISSIONS.promptsRead)).toBe(true);
    expect(service.has(PERMISSIONS.promptsWrite)).toBe(true);
    expect(service.has(PERMISSIONS.serviceRequestsRead)).toBe(false);
    expect(service.hasAny(PERMISSIONS.serviceRequestsRead, PERMISSIONS.promptsRead)).toBe(true);
    expect(service.hasAny(PERMISSIONS.serviceRequestsRead, PERMISSIONS.dashboardRead)).toBe(false);
  });

  it('should mark as loaded with no permissions when the request fails', () => {
    service.load().subscribe({
      error: () => expect.unreachable('should not error'),
    });

    httpTesting
      .expectOne(`${API}/api/auth/me/permissions`)
      .flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(service.loaded()).toBe(true);
    expect(service.profile()).toBeNull();
    expect(service.permissions()).toEqual([]);
    expect(service.has(PERMISSIONS.promptsRead)).toBe(false);
  });

  it('should clear the state', () => {
    service.load().subscribe();
    httpTesting.expectOne(`${API}/api/auth/me/permissions`).flush(dto);

    service.clear();

    expect(service.loaded()).toBe(false);
    expect(service.profile()).toBeNull();
    expect(service.permissions()).toEqual([]);
  });
});
