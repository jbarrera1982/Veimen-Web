import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RequestsService, RequestItem, RequestsPage, TraceStep } from './requests.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests`;
const TRACE_URL = `${environment.apiBaseUrl}/api/ServiceRequests/trace`;
const WEBHOOK_URL = environment.auditWebhookUrl;

const emptyPage = { items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0 };

describe('RequestsService', () => {
  let service: RequestsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RequestsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should map API fields and translate statuses', () => {
    let result: RequestsPage | undefined;
    service.getRequestsList().subscribe((page) => (result = page));

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush({
      items: [
        {
          requestNumber: 197,
          channel: 'EMAIL',
          from: 'barrerajc@hotmail.com',
          subject: 'as',
          originalMessage: 'Prueba 2',
          receiptDate: '2026-09-04T13:46:17',
          n8nWorkflow: 'AgenteAtencioAlClienteIntakeAS',
          status: 'Received',
          priority: 'Normal',
          createdAt: '2026-09-04T13:46:17',
          updatedAt: '2026-09-04T13:46:17',
          description: null,
          otpCode: null,
          otpVerifiedAt: null,
          detectedIntent: null,
        },
        {
          requestNumber: 201,
          channel: 'EMAIL',
          from: 'jbarreraccs@gmail.com',
          subject: 'Informacion',
          originalMessage: 'Quiero saber los requisitos para solicitar un credito.',
          receiptDate: '2026-09-04T17:22:17',
          n8nWorkflow: 'AgenteAtencioAlClienteIntakeAS',
          status: 'aNalyzed',
          priority: 'Normal',
          createdAt: '2026-09-04T17:22:17',
          updatedAt: '2026-09-04T17:22:43',
          description: 'Cliente identificado',
          otpCode: '382561',
          otpVerifiedAt: '2026-09-04T17:01:51',
          detectedIntent: 'payment_history',
        },
      ],
      totalCount: 42,
      page: 1,
      pageSize: 20,
    });

    expect(result?.items[0]).toEqual({
      requestNumber: 197,
      channel: 'EMAIL',
      from: 'barrerajc@hotmail.com',
      subject: 'as',
      originalMessage: 'Prueba 2',
      receiptDate: '2026-09-04T13:46:17',
      n8nWorkflow: 'AgenteAtencioAlClienteIntakeAS',
      status: 'Recibido',
      priority: 'Normal',
      createdAt: '2026-09-04T13:46:17',
      updatedAt: '2026-09-04T13:46:17',
      description: null,
      otpCode: null,
      otpVerifiedAt: null,
      detectedIntent: null,
    });
    expect(result?.items[1].status).toBe('Analizado');
    expect(result?.items[1].description).toBe('Cliente identificado');
    expect(result?.items[1].otpCode).toBe('382561');
    expect(result?.totalCount).toBe(42);
    // totalPages no viene en la respuesta; se calcula como ceil(42 / 20).
    expect(result?.totalPages).toBe(3);
  });

  it('should send page and pageSize params', () => {
    service.getRequestsList({ page: 2, pageSize: 50 }).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ items: [], totalCount: 0, page: 2, pageSize: 50, totalPages: 0 });
  });

  it('should default to an empty page when items is missing or not an array', () => {
    let result: RequestsPage | undefined;
    service.getRequestsList().subscribe((page) => (result = page));
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush({});
    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 0, totalPages: 0 });
  });

  it('should send start_date/end_date in YYYYMMDD format', () => {
    service.getRequestsList({ startDate: '2026-08-01', endDate: '2026-08-31' }).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260801');
    expect(req.request.params.get('end_date')).toBe('20260831');
    req.flush(emptyPage);
  });

  it('should send no date params when range is empty', () => {
    service.getRequestsList({}).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('start_date')).toBeFalsy();
    expect(req.request.params.has('end_date')).toBeFalsy();
    expect(req.request.params.has('status')).toBeFalsy();
    expect(req.request.params.has('search')).toBeFalsy();
    req.flush(emptyPage);
  });

  it('should send the search param with the raw value', () => {
    service.getRequestsList({ search: 'jbarreraccs' }).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('search')).toBe('jbarreraccs');
    req.flush(emptyPage);
  });

  it('should POST the audit webhook with request_number and the logged user email', () => {
    TestBed.inject(AuthService).currentUser.set({
      userId: 1,
      username: 'bob',
      email: 'bob@example.com',
      fullName: 'Bob',
      active: true,
      lastLoginAt: null,
    });

    service.auditRequest(202).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('request_number')).toBe('202');
    expect(req.request.params.get('email')).toBe('bob@example.com');
    req.flush({});
  });

  it('should POST the audit webhook without email when there is no logged user', () => {
    service.auditRequest(202).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('request_number')).toBe('202');
    expect(req.request.params.has('email')).toBe(false);
    req.flush({});
  });

  it('should send repeated status params with raw values', () => {
    service.getRequestsList({ statuses: ['Recibido', 'Rechazado'] }).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.getAll('status')).toEqual(['Received', 'Rejected']);
    req.flush(emptyPage);
  });

  it('should pass unknown statuses as-is', () => {
    service.getRequestsList({ statuses: ['Investigación'] }).subscribe(() => {});
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.getAll('status')).toEqual(['Investigación']);
    req.flush(emptyPage);
  });

  it('should get the request trace by request number', () => {
    let result: TraceStep[] | undefined;
    service.getRequestTrace(202).subscribe((steps) => (result = steps));

    const req = httpTesting.expectOne((r) => r.url === TRACE_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('request_number')).toBe('202');

    req.flush([
      {
        traceId: 987,
        requestNumber: 202,
        sequence: 2,
        node: 'Agente 2 - Inapropiados',
        agent: 'Agente 2 - Inapropiados',
        nodeType: 'LLM',
        llmModel: 'GPT-5.5',
        promptVersion: '2.0.0',
        startDate: '2026-09-04 13:51:25',
        endDate: '2026-09-04 13:51:33',
        durationMs: 8386,
        status: 'completed',
        confidence: '0.9800',
        inputJson: '{"texto":"Hola"}',
        outputJson: '{"texto":"ok"}',
        observations: 'Continuar con el flujo: true',
        createdAt: '2026-09-04 13:51:33',
        promptId: 203,
        promptResult: '[...]',
      },
    ]);

    expect(result).toEqual([
      {
        traceId: 987,
        requestNumber: 202,
        sequence: 2,
        node: 'Agente 2 - Inapropiados',
        agent: 'Agente 2 - Inapropiados',
        nodeType: 'LLM',
        llmModel: 'GPT-5.5',
        promptVersion: '2.0.0',
        startDate: '2026-09-04 13:51:25',
        endDate: '2026-09-04 13:51:33',
        durationMs: 8386,
        status: 'completed',
        confidence: '0.9800',
        inputJson: '{"texto":"Hola"}',
        outputJson: '{"texto":"ok"}',
        observations: 'Continuar con el flujo: true',
        createdAt: '2026-09-04 13:51:33',
        promptId: 203,
        promptResult: '[...]',
      },
    ]);
  });
});
