import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DashboardComponent } from './dashboard.component';
import { DashboardService, StatusCount } from '../services/dashboard.service';
import { ClientContextService } from '../services/client-context.service';
import { type Client } from '../services/clients.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests/dashboard`;

function client(partial: Partial<Client>): Client {
  return {
    clientId: 1,
    name: '',
    inboundEmail: '',
    outboundEmail: '',
    analystEmail: '',
    projectId: '',
    active: true,
    ...partial,
  };
}

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;
  let clientContext: ClientContextService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [DashboardService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    clientContext = TestBed.inject(ClientContextService);
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function flushResponse(data: StatusCount[]): void {
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    req.flush(data);
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load data from the webhook with default date range', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('start_date')).toBeTruthy();
    expect(req.request.params.get('end_date')).toBeTruthy();

    req.flush([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'Rejected', date: '2026-08-01', total: 40 },
    ]);

    expect(component.isLoading()).toBeFalsy();
    expect(component.total()).toBe(127);
    expect(component.error()).toBeNull();
  });

  it('should translate the "aNalyzed" status to "Analizado"', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'aNalyzed', date: '2026-08-01', total: 8 },
    ]);

    const analyzed = component.statusCounts().find((c) => c.status === 'Analizado');
    expect(analyzed).toEqual({
      status: 'Analizado',
      date: '2026-08-01',
      total: 8,
    });
  });

  it('should filter out a status from charts and totals when toggled', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'Rejected', date: '2026-08-01', total: 40 },
    ]);
    expect(component.total()).toBe(127);

    component.toggleStatus('Recibido');

    expect(component.total()).toBe(40);
  });

  it('should group chart data by status across dates', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 10 },
      { status: 'Received', date: '2026-08-02', total: 20 },
      { status: 'Rejected', date: '2026-08-01', total: 5 },
    ]);

    expect(component.barData()).toEqual([
      { name: 'Recibido', value: 30 },
      { name: 'Rechazado', value: 5 },
    ]);
    expect(component.total()).toBe(35);
    expect(component.visibleByStatus()).toHaveLength(2);
  });

  it('should build a single total series grouped by date', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 10 },
      { status: 'Rejected', date: '2026-08-01', total: 5 },
      { status: 'Received', date: '2026-08-02', total: 3 },
    ]);

    expect(component.timelineSeries()).toEqual([
      {
        name: 'Total',
        series: [
          { name: '2026-08-01', value: 15 },
          { name: '2026-08-02', value: 3 },
        ],
      },
    ]);
  });

  it('should exclude hidden statuses from the timeline total', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 10 },
      { status: 'Rejected', date: '2026-08-01', total: 5 },
    ]);

    component.toggleStatus('Recibido');

    expect(component.timelineSeries()[0].series).toEqual([{ name: '2026-08-01', value: 5 }]);
  });

  it('should compute received total and closed percentage from all statuses', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 80 },
      { status: 'Closed', date: '2026-08-01', total: 40 },
      { status: 'Rejected', date: '2026-08-01', total: 80 },
    ]);

    expect(component.receivedTotal()).toBe(200);
    expect(component.closedTotal()).toBe(40);
    expect(component.closedPercentage()).toBeCloseTo(20, 5);
  });

  it('should compute a zero closed percentage when there is no data', () => {
    fixture.detectChanges();
    flushResponse([]);

    expect(component.receivedTotal()).toBe(0);
    expect(component.closedPercentage()).toBe(0);
  });

  it('should keep the stat totals independent of hidden status chips', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 80 },
      { status: 'Closed', date: '2026-08-01', total: 40 },
    ]);
    expect(component.receivedTotal()).toBe(120);

    component.toggleStatus('Recibido');
    expect(component.total()).toBe(40);
    expect(component.receivedTotal()).toBe(120);
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
    req.flush([]);
  });

  it('should trigger a new request on refresh', () => {
    fixture.detectChanges();
    flushResponse([]);

    component.refresh();

    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush([{ status: 'Received', date: '2026-08-01', total: 10 }]);
    expect(component.total()).toBe(10);
  });

  it('should set an error when the request fails', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeTruthy();
  });

  it('should persist hidden statuses to localStorage', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'Rejected', date: '2026-08-01', total: 40 },
    ]);

    component.toggleStatus('Recibido');

    const stored = JSON.parse(localStorage.getItem('veimen-web.hiddenStatuses') ?? '[]');
    expect(stored).toEqual(['Recibido']);
  });

  it('should restore hidden statuses from localStorage on init', () => {
    localStorage.setItem('veimen-web.hiddenStatuses', JSON.stringify(['Rechazado']));

    fixture.destroy();

    const freshFixture = TestBed.createComponent(DashboardComponent);
    const fresh = freshFixture.componentInstance;
    freshFixture.detectChanges();

    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'Rejected', date: '2026-08-01', total: 40 },
    ]);

    expect(fresh.total()).toBe(87);
  });

  it('should reset hidden statuses and clear persisted filter', () => {
    fixture.detectChanges();
    flushResponse([
      { status: 'Received', date: '2026-08-01', total: 87 },
      { status: 'Rejected', date: '2026-08-01', total: 40 },
    ]);

    component.toggleStatus('Recibido');
    expect(component.hasHiddenFilters()).toBeTruthy();

    component.resetFilters();

    expect(component.hasHiddenFilters()).toBeFalsy();
    expect(component.total()).toBe(127);
    expect(component.hiddenStatuses().size).toBe(0);
    expect(localStorage.getItem('veimen-web.hiddenStatuses')).toBe('[]');
  });

  // El filtro de cliente es global (cabecera del menú): "Todos" no envía client_id.
  it('should not send client_id on init when no client is selected', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('client_id')).toBe(false);
    req.flush([]);
  });

  it('should send client_id for the selected client and reload when it changes', () => {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush([]);

    clientContext.clients.set([client({ clientId: 7, name: 'Cliente Siete' })]);
    clientContext.selectClient(7);
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('client_id')).toBe('7');
    req.flush([{ status: 'Received', date: '2026-08-01', total: 10 }]);

    expect(component.total()).toBe(10);
  });
});
