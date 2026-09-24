import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DashboardService, StatusCount } from './dashboard.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests/dashboard`;

describe('DashboardService', () => {
  let service: DashboardService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should map the API date to YYYY-MM-DD and translate statuses', () => {
    let result: StatusCount[] | undefined;
    service.getStatusByStatus().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush([
      { status: 'Received', date: '2026-08-01T00:00:00', total: 6 },
      { status: 'aNalyzed', date: '2026-08-02T00:00:00', total: 3 },
    ]);

    expect(result).toEqual([
      { status: 'Recibido', date: '2026-08-01', total: 6 },
      { status: 'Analizado', date: '2026-08-02', total: 3 },
    ]);
  });

  it('should send start_date/end_date in YYYYMMDD format', () => {
    service
      .getStatusByStatus({ startDate: '2026-08-01', endDate: '2026-08-31' })
      .subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260801');
    expect(req.request.params.get('end_date')).toBe('20260831');
    req.flush([]);
  });
});
