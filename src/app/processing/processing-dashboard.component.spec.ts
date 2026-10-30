import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProcessingDashboardComponent } from './processing-dashboard.component';
import { AuthService } from '../services/auth.service';
import { MailService } from '../services/mail.service';
import { ClientContextService } from '../services/client-context.service';
import { type Client } from '../services/clients.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/mail/comparison`;

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

const SAMPLE = [
  { date: '2026-10-20', mails: 4, requests: 5 },
  { date: '2026-10-21', mails: 1, requests: 1 },
  { date: '2026-10-23', mails: 2, requests: 3 },
];

describe('ProcessingDashboardComponent', () => {
  let component: ProcessingDashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;
  let clientContext: ClientContextService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ProcessingDashboardComponent],
      providers: [MailService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    clientContext = TestBed.inject(ClientContextService);
    fixture = TestBed.createComponent(ProcessingDashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function flushComparison(data: unknown[] = SAMPLE): void {
    httpTesting.expectOne((r) => r.url === API_URL).flush(data);
  }

  function load(data: unknown[] = SAMPLE): void {
    fixture.detectChanges();
    flushComparison(data);
    fixture.detectChanges();
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should request the default date range on init', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('start_date')).toMatch(/^\d{8}$/);
    expect(req.request.params.get('end_date')).toMatch(/^\d{8}$/);
    req.flush([]);
  });

  // Convención de la API: los endpoints reciben start_date/end_date sin guiones.
  it('should resend the range in YYYYMMDD when the filters are applied', () => {
    load();

    component.setStartDate('2026-09-01');
    component.setEndDate('2026-09-30');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260901');
    expect(req.request.params.get('end_date')).toBe('20260930');
    req.flush([]);
  });

  it('should compute the KPIs from every row', () => {
    load();

    expect(component.totals().mails).toBe(7);
    expect(component.totals().requests).toBe(9);
    expect(component.totals().balance).toBe(2);
    expect(component.totals().mailDays).toBe(3);
    expect(component.totals().requestDays).toBe(3);
    expect(component.totals().conversion).toBeCloseTo(128.571, 2);
  });

  it('should build one timeline series per metric, sorted by date', () => {
    load();

    const series = component.timelineSeries();
    expect(series.map((s) => s.name)).toEqual(['Correos', 'Requerimientos']);
    expect(series[0].series).toEqual([
      { name: '2026-10-20', value: 4 },
      { name: '2026-10-21', value: 1 },
      { name: '2026-10-23', value: 2 },
    ]);
    expect(series[1].series).toEqual([
      { name: '2026-10-20', value: 5 },
      { name: '2026-10-21', value: 1 },
      { name: '2026-10-23', value: 3 },
    ]);
  });

  // ngx-charts-bar-vertical-2d espera una entrada por categoría del eje X.
  it('should build the grouped bar data by date', () => {
    load();

    expect(component.barGroups()).toEqual([
      {
        name: '2026-10-20',
        series: [
          { name: 'Correos', value: 4 },
          { name: 'Requerimientos', value: 5 },
        ],
      },
      {
        name: '2026-10-21',
        series: [
          { name: 'Correos', value: 1 },
          { name: 'Requerimientos', value: 1 },
        ],
      },
      {
        name: '2026-10-23',
        series: [
          { name: 'Correos', value: 2 },
          { name: 'Requerimientos', value: 3 },
        ],
      },
    ]);
  });

  // Ticks fijos para romper el bucle de medición de ngx-charts (#349).
  it('should pin integer y-axis ticks for the bar chart', () => {
    load();

    expect(component.barYTicks()).toEqual([0, 2, 4, 6]);
  });

  it('should build the HTML legend from the scheme colors', () => {
    load();

    expect(component.legendItems()).toEqual([
      { name: 'Correos', color: '#3d7dd8' },
      { name: 'Requerimientos', color: '#2bb8a3' },
    ]);
  });

  it('should sort the detail rows by date descending', () => {
    load();

    expect(component.detailRows().map((r) => r.date)).toEqual([
      '2026-10-23',
      '2026-10-21',
      '2026-10-20',
    ]);
  });

  it('should render the detail table with a totals row', () => {
    load();

    const headers = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Fecha', 'Correos', 'Requerimientos', 'Conversión', 'Balance']);

    const firstRow = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table tbody tr:first-child td'),
    ).map((td) => td.textContent?.trim());
    expect(firstRow).toEqual(['23/10/2026', '2', '3', '150,0 %', '+1']);

    const totalRow = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table tfoot td'),
    ).map((td) => td.textContent?.trim());
    expect(totalRow).toEqual(['Total', '7', '9', '128,6 %', '+2']);
  });

  it('should show a dash for the conversion when there are no mails', () => {
    load([{ date: '2026-10-20', mails: 0, requests: 3 }]);

    expect(component.totals().conversion).toBeNull();
    expect(component.conversionFor(component.rows()[0])).toBeNull();
    expect(component.formatConversion(component.totals().conversion)).toBe('—');
  });

  it('should format dates and balances for the view', () => {
    load();

    expect(component.formatDate('2026-10-23')).toBe('23/10/2026');
    expect(component.formatXAxis('2026-10-23')).toBe('23/10');
    expect(component.formatBalance(2)).toBe('+2');
    expect(component.formatBalance(-1)).toBe('-1');
    expect(component.formatBalance(0)).toBe('0');
  });

  it('should cap the detail table and grow it on demand', () => {
    const many = Array.from({ length: 60 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      return { date, mails: i, requests: i + 1 };
    });
    load(many);

    expect(component.detailRows().length).toBe(50);
    expect(component.hasMoreRows()).toBe(true);

    component.showMore();
    expect(component.detailRows().length).toBe(60);
    expect(component.hasMoreRows()).toBe(false);
  });

  it('should show an empty state when there are no rows', () => {
    load([]);

    expect(component.rows().length).toBe(0);
    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('No se registró procesamiento en el rango seleccionado.');
  });

  it('should show an error message when the request fails', () => {
    fixture.detectChanges();
    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBe(false);
    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('Reintentar');
  });

  // Filtro por cliente: "Todos" (sin cliente) no envía client_id.
  it('should not send client_id on init when no client is selected', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('client_id')).toBe(false);
    req.flush([]);
  });

  it('should send client_id for the selected client and reload when it changes', () => {
    load();

    clientContext.clients.set([client({ clientId: 7, name: 'Cliente Siete' })]);
    clientContext.selectClient(7);
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('client_id')).toBe('7');
    req.flush(SAMPLE);

    expect(component.rows().length).toBe(SAMPLE.length);
  });

  // Usuario con cliente asociado (claim client_id): se filtra por el suyo aunque el
  // menú esté en "Todos" (el backend además lo fuerza).
  it('should filter by the client associated to the user', () => {
    TestBed.inject(AuthService).currentUser.set({
      userId: 1,
      username: 'alice',
      email: 'alice@example.com',
      fullName: null,
      active: true,
      clientId: 9,
      lastLoginAt: null,
    });

    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('client_id')).toBe('9');
    req.flush([]);
  });
});
