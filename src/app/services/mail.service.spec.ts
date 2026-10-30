import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MailService } from './mail.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/mail/comparison`;

describe('MailService', () => {
  let service: MailService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(MailService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  // Convención de la API: start_date/end_date viajan sin guiones (YYYYMMDD).
  it('should send the date range in YYYYMMDD format', () => {
    service.getComparison({ startDate: '2026-01-01', endDate: '2026-12-31' }).subscribe();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('start_date')).toBe('20260101');
    expect(req.request.params.get('end_date')).toBe('20261231');
    req.flush([]);
  });

  it('should omit absent dates', () => {
    service.getComparison().subscribe();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('start_date')).toBe(false);
    expect(req.request.params.has('end_date')).toBe(false);
    req.flush([]);
  });

  // Filtro por cliente: el endpoint acota correos y requerimientos por client_id.
  it('should send client_id when a client is given and omit it otherwise', () => {
    service.getComparison({ clientId: 7 }).subscribe();
    const filtered = httpTesting.expectOne((r) => r.url === API_URL);
    expect(filtered.request.params.get('client_id')).toBe('7');
    filtered.flush([]);

    service.getComparison().subscribe();
    const all = httpTesting.expectOne((r) => r.url === API_URL);
    expect(all.request.params.has('client_id')).toBe(false);
    all.flush([]);
  });

  // El backend devuelve la fecha como YYYYMMDD; el resto de la app usa YYYY-MM-DD.
  it('should normalize the API date to YYYY-MM-DD and null numbers to zero', () => {
    let result: unknown;
    service.getComparison().subscribe((rows) => (result = rows));

    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush([
        { date: '20261020', mails: 4, requests: 5 },
        { date: null, mails: null, requests: null },
      ]);

    expect(result).toEqual([
      { date: '2026-10-20', mails: 4, requests: 5 },
      { date: '', mails: 0, requests: 0 },
    ]);
  });

  it('should keep an ISO date truncated to the day', () => {
    let result: unknown;
    service.getComparison().subscribe((rows) => (result = rows));

    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush([{ date: '2026-10-20T00:00:00', mails: 1, requests: 1 }]);

    expect(result).toEqual([{ date: '2026-10-20', mails: 1, requests: 1 }]);
  });
});
