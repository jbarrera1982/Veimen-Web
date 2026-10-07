import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { HomeRedirectComponent } from './home-redirect.component';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

describe('HomeRedirectComponent', () => {
  let permissions: PermissionsService;
  let navigateSpy: ReturnType<typeof vi.spyOn>;
  let fixture: import('@angular/core/testing').ComponentFixture<HomeRedirectComponent>;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [HomeRedirectComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    permissions = TestBed.inject(PermissionsService);
    const router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  function create(): void {
    fixture = TestBed.createComponent(HomeRedirectComponent);
    fixture.detectChanges();
  }

  it('should navigate to the dashboard when the user can read it', async () => {
    permissions.permissions.set([PERMISSIONS.dashboardRead, PERMISSIONS.promptsRead]);
    permissions.loaded.set(true);

    create();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/dashboard');
  });

  it('should navigate to the first accessible module without dashboard access', async () => {
    permissions.permissions.set([PERMISSIONS.serviceRequestsRead]);
    permissions.loaded.set(true);

    create();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/service-request');
  });

  it('should navigate to consumo when the user only has usage.read', async () => {
    permissions.permissions.set([PERMISSIONS.usageRead]);
    permissions.loaded.set(true);

    create();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/consumo');
  });

  it('should navigate to the business model when it is the only accessible module', async () => {
    permissions.permissions.set([PERMISSIONS.businessModelRead]);
    permissions.loaded.set(true);

    create();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/business-model');
  });

  it('should load the permissions first when they are not loaded yet', async () => {
    create();

    const httpTesting = TestBed.inject(HttpTestingController);
    httpTesting
      .expectOne(`${API}/api/auth/me/permissions`)
      .flush({ profile: 'Reader', permissions: [PERMISSIONS.promptsRead] });
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/prompts');
    httpTesting.verify();
  });
});
