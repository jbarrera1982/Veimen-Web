import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailEvaluationDatasetService } from './email-evaluation-dataset.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/email-evaluation-dataset`;

describe('EmailEvaluationDatasetService', () => {
  let service: EmailEvaluationDatasetService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EmailEvaluationDatasetService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('getCases envía client_id, scenario, search y paginación, y normaliza la página', () => {
    let result: unknown;
    service
      .getCases({ clientId: 3, scenario: 'Facturación', search: ' pendiente ', page: 2 })
      .subscribe((page) => (result = page));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('client_id')).toBe('3');
    expect(req.request.params.get('scenario')).toBe('Facturación');
    expect(req.request.params.get('search')).toBe('pendiente');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');

    req.flush({
      items: [
        {
          id: 7,
          case: 'Saldo pendiente',
          scenario: 'Facturación',
          from: 'a@b.com',
          subject: null,
          contentPreview: 'Hola',
          clientId: 3,
        },
      ],
      totalCount: 1,
      page: 2,
      pageSize: 20,
    });

    expect(result).toEqual({
      items: [
        {
          id: 7,
          case: 'Saldo pendiente',
          scenario: 'Facturación',
          from: 'a@b.com',
          subject: '',
          contentPreview: 'Hola',
          clientId: 3,
          createdAt: '',
          updatedAt: '',
        },
      ],
      totalCount: 1,
      page: 2,
      pageSize: 20,
    });
  });

  it('getCases omite client_id cuando es null ("Todos")', () => {
    service.getCases({ clientId: null }).subscribe();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('client_id')).toBe(false);
    req.flush({ items: [], totalCount: 0, page: 1, pageSize: 20 });
  });

  it('updateCase usa PUT con el id en la ruta', () => {
    service
      .updateCase(7, {
        case: 'Caso con símbolos / y espacios',
        scenario: 'S',
        from: 'a@b.com',
        subject: null,
        content: '<p>x</p>',
        clientId: 1,
      })
      .subscribe();

    const req = httpTesting.expectOne(`${API_URL}/7`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.case).toBe('Caso con símbolos / y espacios');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('evaluateCase parsea la respuesta JSON del webhook', () => {
    let result: unknown;
    service.evaluateCase(7).subscribe((value) => (result = value));

    const req = httpTesting.expectOne(`${API_URL}/7/evaluate`);
    expect(req.request.method).toBe('POST');
    req.flush('{"intent":"pago"}');

    expect(result).toEqual({ intent: 'pago' });
  });

  it('evaluateCase devuelve el texto plano cuando no es JSON', () => {
    let result: unknown;
    service.evaluateCase(7).subscribe((value) => (result = value));

    httpTesting.expectOne(`${API_URL}/7/evaluate`).flush('OK');

    expect(result).toBe('OK');
  });
});
