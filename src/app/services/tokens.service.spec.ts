import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TokensService, type TokenUsage } from './tokens.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests/tokens`;

describe('TokensService', () => {
  let service: TokensService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TokensService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should map the API datetime to YYYY-MM-DD', () => {
    let result: TokenUsage[] | undefined;
    service.getTokenUsage().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush([
      {
        date: '2026-09-01T00:00:00',
        node: 'Clasificador',
        inputTokens: 1200,
        outputTokens: 340,
        totalTokens: 1540,
      },
    ]);

    expect(result).toEqual([
      {
        date: '2026-09-01',
        node: 'Clasificador',
        inputTokens: 1200,
        outputTokens: 340,
        totalTokens: 1540,
      },
    ]);
  });

  it('should send start_date/end_date in YYYYMMDD format', () => {
    service.getTokenUsage({ startDate: '2026-09-01', endDate: '2026-09-30' }).subscribe(() => {});

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260901');
    expect(req.request.params.get('end_date')).toBe('20260930');
  });

  it('should omit the date params when no range is given', () => {
    service.getTokenUsage().subscribe(() => {});

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('start_date')).toBe(false);
    expect(req.request.params.has('end_date')).toBe(false);
  });

  // 'agent' viene en la respuesta pero el dashboard no lo usa: el detalle se
  // re-agrupa por día × nodo. El servicio solo lo descarta.
  it('should drop the agent field returned by the API', () => {
    let result: TokenUsage[] | undefined;
    service.getTokenUsage().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush([
      {
        date: '2026-09-01T00:00:00',
        agent: 'AgenteUno',
        node: 'Clasificador',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    ]);

    expect(result?.[0]).not.toHaveProperty('agent');
  });

  it('should default missing token counts to zero', () => {
    let result: TokenUsage[] | undefined;
    service.getTokenUsage().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush([
      {
        date: '2026-09-01T00:00:00',
        node: 'Clasificador',
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    ]);

    expect(result?.[0]).toEqual(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    );
  });

  it('should return an empty array when the API responds with null', () => {
    let result: TokenUsage[] | undefined;
    service.getTokenUsage().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush(null);

    expect(result).toEqual([]);
  });
});
