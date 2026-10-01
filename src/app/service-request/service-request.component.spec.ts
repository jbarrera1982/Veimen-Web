import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ServiceRequestComponent } from './service-request.component';
import { RequestsService, TraceStep } from '../services/requests.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests`;
const TRACE_URL = `${environment.apiBaseUrl}/api/ServiceRequests/trace`;
const WEBHOOK_URL = environment.auditWebhookUrl;

const emptyPage = { items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0 };

interface RawRequest {
  requestNumber: number;
  channel: string;
  from: string;
  subject: string;
  originalMessage: string;
  receiptDate: string;
  n8nWorkflow: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  otpCode: string | null;
  otpVerifiedAt: string | null;
  detectedIntent: string | null;
}

function rawRequest(partial: Partial<RawRequest> = {}): RawRequest {
  return {
    requestNumber: 197,
    channel: 'EMAIL',
    from: 'barrerajc@hotmail.com',
    subject: 'asunto',
    originalMessage: 'mensaje',
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
    ...partial,
  };
}

describe('ServiceRequestComponent', () => {
  let component: ServiceRequestComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;
  let permissions: PermissionsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceRequestComponent],
      providers: [RequestsService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.serviceRequestsRead, PERMISSIONS.traceRead]);
    permissions.loaded.set(true);
    fixture = TestBed.createComponent(ServiceRequestComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function flushResponse(data: RawRequest[]): void {
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    req.flush({
      items: data,
      totalCount: data.length,
      page: 1,
      pageSize: 20,
      totalPages: data.length ? 1 : 0,
    });
  }

  function flushPage(
    data: RawRequest[],
    page: number,
    totalCount: number,
    totalPages: number,
  ): void {
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    req.flush({ items: data, totalCount, page, pageSize: 20, totalPages });
  }

  function rawTrace(partial: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      traceId: 987,
      requestNumber: 202,
      sequence: 2,
      node: 'Agente 2 - Inapropiados',
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
      ...partial,
    };
  }

  function flushTrace(data: Record<string, unknown>[]): void {
    const req = httpTesting.expectOne((r) => r.url === TRACE_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('request_number')).toBeTruthy();
    req.flush(data);
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load data from the webhook with default date range', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBeTruthy();
    expect(req.request.params.get('end_date')).toBeTruthy();

    req.flush({
      items: [rawRequest(), rawRequest({ requestNumber: 201, status: 'Rejected' })],
      totalCount: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeNull();
    expect(component.requests()).toHaveLength(2);
    expect(component.requests()[0].status).toBe('Recibido');
    expect(component.requests()[1].status).toBe('Rechazado');
  });

  it('should translate the "aNalyzed" status', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ status: 'aNalyzed' })]);

    expect(component.requests()[0].status).toBe('Analizado');
  });

  it('should send the selected date range on load', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.setStartDate('2026-01-01');
    component.setEndDate('2026-01-31');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260101');
    expect(req.request.params.get('end_date')).toBe('20260131');
    req.flush(emptyPage);
  });

  it('should trigger a new request on refresh', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.refresh();

    flushResponse([rawRequest({ requestNumber: 202 })]);
    expect(component.requests()).toHaveLength(1);
  });

  it('should treat an empty list as success', () => {
    fixture.detectChanges();
    flushResponse([]);

    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeNull();
    expect(component.requests()).toHaveLength(0);
  });

  it('should treat a non-array response as an empty list', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    req.flush({});

    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeNull();
    expect(component.requests()).toHaveLength(0);
  });

  it('should set an error when the request fails', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeTruthy();
  });

  it('should format datetime as dd/MM/yyyy HH:mm:ss', () => {
    expect(component.formatDateTime('2026-09-04 13:46:17')).toBe('04/09/2026 13:46:17');
    expect(component.formatDateTime('2026-09-04T13:46:17')).toBe('04/09/2026 13:46:17');
  });

  it('should pretty print JSON stored as string', () => {
    expect(component.formatJson('{"texto":"Hola"}')).toBe('{\n  "texto": "Hola"\n}');
    expect(component.formatJson('{ texto inválido')).toBe('{ texto inválido');
    expect(component.formatJson(null)).toBe('');
  });

  it('should turn newline escapes inside JSON values into real line breaks', () => {
    const result = component.formatJson('{"texto":"Línea 1\\nLínea 2"}');
    expect(result).toBe('{\n  "texto": "Línea 1\nLínea 2"\n}');
  });

  it('should unwrap nested JSON strings into indented properties', () => {
    const input = '{"texto":"{\\"titulo\\":\\"Solicitud de saldo\\"}"}';
    expect(component.formatJson(input)).toBe(
      '{\n  "texto": {\n    "titulo": "Solicitud de saldo"\n  }\n}',
    );
  });

  it('should keep plain text values as strings when nested JSON is invalid', () => {
    expect(component.formatJson('{"texto":"{ no es json }"}')).toBe(
      '{\n  "texto": "{ no es json }"\n}',
    );
  });

  it('should build a tab page with entrada and salida side by side', () => {
    const step: TraceStep = {
      traceId: 987,
      requestNumber: 202,
      sequence: 2,
      node: 'Agente 2 - Inapropiados',
      nodeType: 'LLM',
      llmModel: 'GPT-5.5',
      promptVersion: '2.0.0',
      startDate: '2026-09-04 13:51:25',
      endDate: '2026-09-04 13:51:33',
      durationMs: 8386,
      status: 'completed',
      confidence: '0.9800',
      inputJson: '{"texto":"Línea 1\\nLínea 2"}',
      outputJson: '{"texto":"ok"}',
      observations: 'Continuar con el flujo: true',
      createdAt: '2026-09-04 13:51:33',
      promptId: 203,
      promptResult: '[...]',
    };
    const tabHtml = (
      component as unknown as { buildJsonTabHtml: (step: TraceStep) => string }
    ).buildJsonTabHtml(step);

    expect(tabHtml).toContain('flex-direction: row');
    expect(tabHtml).toContain('flex: 1 1 50%');
    expect(tabHtml).toContain('Entrada');
    expect(tabHtml).toContain('Salida');
    expect(tabHtml).toContain('&quot;texto&quot;: &quot;Línea 1\nLínea 2&quot;');
    expect(tabHtml).toContain('&quot;texto&quot;: &quot;ok&quot;');
  });

  it('should escape HTML entities in the tab page', () => {
    const step: TraceStep = {
      traceId: 1,
      requestNumber: 202,
      sequence: 1,
      node: 'Node <script>alert(1)</script>',
      nodeType: 'LLM',
      llmModel: 'GPT-5.5',
      promptVersion: null,
      startDate: '2026-09-04 13:51:25',
      endDate: null,
      durationMs: 10,
      status: 'completed',
      confidence: null,
      inputJson: '{"a":"<b>&"}',
      outputJson: null,
      observations: null,
      createdAt: '2026-09-04 13:51:33',
      promptId: null,
      promptResult: null,
    };
    const tabHtml = (
      component as unknown as { buildJsonTabHtml: (step: TraceStep) => string }
    ).buildJsonTabHtml(step);

    expect(tabHtml).toContain('&lt;script&gt;');
    expect(tabHtml).not.toContain('<script>');
    expect(tabHtml).toContain('Sin datos');
  });

  it('should open the detail modal and load the trace for the clicked request', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);

    expect(component.selectedRequest()).toEqual(component.requests()[0]);
    expect(component.isLoadingTrace()).toBeTruthy();

    flushTrace([rawTrace()]);

    expect(component.isLoadingTrace()).toBeFalsy();
    expect(component.traceError()).toBeNull();
    expect(component.traceSteps()).toHaveLength(1);
    expect(component.traceSteps()[0].node).toBe('Agente 2 - Inapropiados');
  });

  it('should sort trace steps by traceId, not by sequence', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);
    // 'sequence' va a propósito en sentido inverso a 'traceId': este test falla si
    // alguien vuelve a ordenar por sequence.
    flushTrace([rawTrace({ traceId: 988, sequence: 1 }), rawTrace({ traceId: 986, sequence: 3 })]);

    expect(component.traceSteps().map((s) => s.traceId)).toEqual([986, 988]);
  });

  it('should set a trace error when the detail request fails', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);
    const req = httpTesting.expectOne((r) => r.url === TRACE_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.isLoadingTrace()).toBeFalsy();
    expect(component.traceError()).toBeTruthy();
  });

  it('should close the detail modal and clear the trace', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);
    flushTrace([rawTrace()]);
    expect(component.selectedRequest()).toBeTruthy();

    component.closeDetail();

    expect(component.selectedRequest()).toBeNull();
    expect(component.traceSteps()).toHaveLength(0);
  });

  it('should render the trace section when the user has the trace.read permission', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.trace-section')).toBeTruthy();

    flushTrace([rawTrace()]);
  });

  it('should not request or render the trace without the trace.read permission', () => {
    permissions.permissions.set([PERMISSIONS.serviceRequestsRead]);
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);

    component.openDetail(component.requests()[0]);
    fixture.detectChanges();

    expect(component.canSeeTrace()).toBe(false);
    expect(component.selectedRequest()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.trace-section')).toBeNull();
    httpTesting.expectNone((r) => r.url === TRACE_URL);
  });

  it('should format duration and confidence', () => {
    expect(component.formatDuration(9451)).toBe('9.5 s');
    expect(component.formatDuration(450)).toBe('450 ms');
    expect(component.formatDuration(null)).toBe('—');
    expect(component.formatConfidence('0.9800')).toBe('98%');
    expect(component.formatConfidence(null)).toBe('—');
  });

  it('should default the status multiselect to Todas', () => {
    fixture.detectChanges();
    flushResponse([]);

    expect(component.isAllStatuses()).toBeTruthy();
    expect(component.statusButtonLabel()).toBe('Todas');
    expect(component.selectedStatuses().size).toBe(0);
  });

  it('should filter the list client-side when a status is selected', () => {
    fixture.detectChanges();
    flushResponse([
      rawRequest({ requestNumber: 200, status: 'Received' }),
      rawRequest({ requestNumber: 201, status: 'Rejected' }),
    ]);
    expect(component.visibleRequests()).toHaveLength(2);

    component.toggleStatusOption('Recibido');

    expect(component.isAllStatuses()).toBeFalsy();
    expect(component.statusButtonLabel()).toBe('1 estado');
    const visible = component.visibleRequests();
    expect(visible).toHaveLength(1);
    expect(visible[0].status).toBe('Recibido');
  });

  it('should restore Todas and clear the filter when all statuses are cleared', () => {
    fixture.detectChanges();
    flushResponse([
      rawRequest({ requestNumber: 200, status: 'Received' }),
      rawRequest({ requestNumber: 201, status: 'Rejected' }),
    ]);

    component.toggleStatusOption('Recibido');
    component.toggleStatusOption('Recibido');
    expect(component.isAllStatuses()).toBeTruthy();
    expect(component.visibleRequests()).toHaveLength(2);

    component.toggleStatusOption('Rechazado');
    component.toggleAllStatuses();
    expect(component.isAllStatuses()).toBeTruthy();
  });

  it('should send the selected statuses as filter params on apply', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.toggleStatusOption('Recibido');
    component.toggleStatusOption('Rechazado');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.getAll('status')).toEqual(['Received', 'Rejected']);
    req.flush(emptyPage);
  });

  it('should not send status params when Todas is selected', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('status')).toBeFalsy();
    req.flush(emptyPage);
  });

  it('should send the search string as a filter param', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.setSearch('jbarreraccs');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('search')).toBe('jbarreraccs');
    req.flush(emptyPage);
  });

  it('should not send the search param when search is empty or whitespace', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.setSearch('   ');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('search')).toBeFalsy();
    req.flush(emptyPage);
  });

  it('should clear the search and reload', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.setSearch('algo');
    component.applyDateRange();
    const req1 = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req1.request.params.get('search')).toBe('algo');
    req1.flush(emptyPage);

    component.clearSearch();
    const req2 = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req2.request.params.has('search')).toBeFalsy();
    req2.flush(emptyPage);
  });

  it('should call the audit webhook with the request number and show a success toast', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.runAudit(202);

    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('request_number')).toBe('202');
    req.flush({});

    expect(component.toast()?.type).toBe('success');
    expect(component.toast()?.message).toContain('202');
    expect(component.isAuditing(202)).toBe(false);
  });

  it('should ignore duplicate audit calls while one is in flight', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.runAudit(202);
    expect(component.isAuditing(202)).toBe(true);

    component.runAudit(202); // se ignora: ya hay una en curso

    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    expect(req.request.params.get('request_number')).toBe('202');
    req.flush({});
    expect(component.isAuditing(202)).toBe(false);
  });

  it('should show an error toast when the audit webhook fails', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.runAudit(202);

    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    req.flush({}, { status: 500, statusText: 'Server Error' });

    expect(component.toast()?.type).toBe('error');
    expect(component.isAuditing(202)).toBe(false);
  });

  it('should not open the detail modal when clicking the row audit button', () => {
    fixture.detectChanges();
    flushResponse([rawRequest({ requestNumber: 202 })]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.audit-btn');
    expect(button).toBeTruthy();
    button.click();

    expect(component.selectedRequest()).toBeNull();
    const req = httpTesting.expectOne((r) => r.url === WEBHOOK_URL);
    expect(req.request.params.get('request_number')).toBe('202');
    req.flush({});
  });

  it('should send page and pageSize params on load', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(emptyPage);
  });

  it('should update pagination metadata and totals from the response', () => {
    fixture.detectChanges();
    flushPage([rawRequest({ requestNumber: 200 })], 1, 25, 2);

    expect(component.page()).toBe(1);
    expect(component.totalCount()).toBe(25);
    expect(component.totalPages()).toBe(2);
    expect(component.hasPrevPage()).toBeFalsy();
    expect(component.hasNextPage()).toBeTruthy();
  });

  it('should go to the next page and update the page state', () => {
    fixture.detectChanges();
    flushPage([rawRequest({ requestNumber: 200 })], 1, 25, 2);

    component.nextPage();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush({
      items: [rawRequest({ requestNumber: 201 })],
      totalCount: 25,
      page: 2,
      pageSize: 20,
      totalPages: 2,
    });

    expect(component.page()).toBe(2);
    expect(component.requests()).toEqual([expect.objectContaining({ requestNumber: 201 })]);
    expect(component.hasPrevPage()).toBeTruthy();
    expect(component.hasNextPage()).toBeFalsy();
  });

  it('should go to the previous page', () => {
    fixture.detectChanges();
    flushPage([rawRequest({ requestNumber: 200 })], 2, 25, 2);

    component.prevPage();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('page')).toBe('1');
    req.flush(emptyPage);

    expect(component.page()).toBe(1);
  });

  it('should not paginate beyond the last page', () => {
    fixture.detectChanges();
    flushPage([rawRequest()], 1, 1, 1);

    component.nextPage();
    httpTesting.expectNone((r) => r.url === API_URL);
    expect(component.page()).toBe(1);
  });

  it('should reset to the first page when applying filters', () => {
    fixture.detectChanges();
    flushPage([rawRequest({ requestNumber: 200 })], 2, 25, 2);
    expect(component.page()).toBe(2);

    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('page')).toBe('1');
    req.flush(emptyPage);
  });
});
