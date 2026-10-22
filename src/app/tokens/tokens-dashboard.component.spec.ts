import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TokensDashboardComponent } from './tokens-dashboard.component';
import { TokensService } from '../services/tokens.service';
import { ClientContextService } from '../services/client-context.service';
import { PermissionsService, PERMISSIONS } from '../services/permissions.service';
import { type Client } from '../services/clients.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests/tokens`;
const COSTS_URL = `${environment.apiBaseUrl}/api/usage/costs`;

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

function raw(
  date: string,
  node: string,
  input: number,
  output: number,
  total: number,
  llmModel?: string,
) {
  return {
    date: `${date}T00:00:00`,
    node,
    llmModel: llmModel ?? null,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
  };
}

const SAMPLE = [
  raw('2026-09-01', 'Clasificador', 1000, 100, 1100, 'GPT-5.5'),
  raw('2026-09-01', 'Redactor', 2000, 400, 2400, 'GPT-4o'),
  raw('2026-09-02', 'Clasificador', 500, 50, 550, 'GPT-5.5'),
];

// Epoch (segundos) de 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z.
const SEP_01 = 1788220800;
const SEP_02 = 1788307200;

function cost(value: number, currency: string | null) {
  return {
    amount: currency === null ? null : { value, currency },
    line_item: 'gpt-5',
    quantity: 100,
    quantity_unit: 'tokens',
    project_id: 'proj_a',
  };
}

// Envoltura page → bucket → results tal como la devuelve el backend de usage.
function page(buckets: { startTime: number; results: unknown[] }[]): Record<string, unknown> {
  return {
    object: 'page',
    has_more: false,
    next_page: null,
    data: buckets.map((b) => ({
      object: 'bucket',
      start_time: b.startTime,
      end_time: b.startTime + 86400,
      results: b.results,
    })),
  };
}

// 10.5 + 4.25 (2026-09-01) + 2.25 (2026-09-02) = 17 USD en 2 días con costo.
const COST_SAMPLE = page([
  { startTime: SEP_01, results: [cost(10.5, 'usd'), cost(4.25, 'usd')] },
  { startTime: SEP_02, results: [cost(2.25, 'usd')] },
]);

describe('TokensDashboardComponent', () => {
  let component: TokensDashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;
  let clientContext: ClientContextService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [TokensDashboardComponent],
      providers: [TokensService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    clientContext = TestBed.inject(ClientContextService);
    // /tokens solo exige tokens.read; se siembra usage.read para que además se
    // dispare la petición de costos (sin él el componente la omite a propósito).
    TestBed.inject(PermissionsService).permissions.set([
      PERMISSIONS.tokensRead,
      PERMISSIONS.usageRead,
    ]);
    fixture = TestBed.createComponent(TokensDashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function flushTokens(data: unknown[] = SAMPLE): void {
    httpTesting.expectOne((r) => r.url === API_URL).flush(data);
  }

  function flushCosts(data: Record<string, unknown> = COST_SAMPLE): void {
    httpTesting.expectOne((r) => r.url === COSTS_URL).flush(data);
  }

  // On init the component requests the tokens endpoint and the usage costs endpoint.
  function load(tokens: unknown[] = SAMPLE, costs: Record<string, unknown> = COST_SAMPLE): void {
    fixture.detectChanges();
    flushTokens(tokens);
    flushCosts(costs);
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

    // Los costos se piden en paralelo con el mismo rango.
    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(costReq.request.method).toBe('GET');
    expect(costReq.request.params.get('start_date')).toMatch(/^\d{8}$/);
    expect(costReq.request.params.get('end_date')).toMatch(/^\d{8}$/);
    costReq.flush(page([]));
  });

  // API date convention: los endpoints reciben start_date/end_date sin guiones.
  it('should resend the range in YYYYMMDD to both endpoints when the filters are applied', () => {
    load();

    component.setStartDate('2026-09-01');
    component.setEndDate('2026-09-30');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260901');
    expect(req.request.params.get('end_date')).toBe('20260930');
    req.flush([]);

    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(costReq.request.params.get('start_date')).toBe('20260901');
    expect(costReq.request.params.get('end_date')).toBe('20260930');
    costReq.flush(page([]));
  });

  it('should sum the KPIs from every row', () => {
    load();

    // 1100 + 2400 + 550
    expect(component.totals().total).toBe(4050);
    expect(component.totals().input).toBe(3500);
    expect(component.totals().output).toBe(550);
    expect(component.totals().dayCount).toBe(2);
    expect(component.totals().avgPerDay).toBe(2025);
  });

  it('should build one timeline series per token direction', () => {
    load();

    const series = component.timelineSeries();
    expect(series.map((s) => s.name)).toEqual(['Input', 'Output']);
    expect(series[0].series).toEqual([
      { name: '2026-09-01', value: 3000 },
      { name: '2026-09-02', value: 500 },
    ]);
    expect(series[1].series).toEqual([
      { name: '2026-09-01', value: 500 },
      { name: '2026-09-02', value: 50 },
    ]);
  });

  it('should aggregate totals by node, sorted descending', () => {
    load();

    expect(component.byNode()).toEqual([
      { name: 'Redactor', value: 2400 },
      { name: 'Clasificador', value: 1650 },
    ]);
  });

  it('should aggregate totals by model, sorted descending', () => {
    load();

    expect(component.byModel()).toEqual([
      { name: 'GPT-4o', value: 2400 },
      { name: 'GPT-5.5', value: 1650 },
    ]);
  });

  it('should bucket rows without a model under a placeholder', () => {
    load([raw('2026-09-01', 'Clasificador', 10, 5, 15)]);

    expect(component.byModel()).toEqual([{ name: '—', value: 15 }]);
  });

  // El detalle agrupa por modelo en todo el rango: varias filas del mismo
  // modelo (distintos días o nodos) se suman en una sola fila.
  it('should group the detail rows by model with input/output/total', () => {
    load([
      raw('2026-09-01', 'Clasificador', 1000, 100, 1100, 'GPT-5.5'),
      raw('2026-09-02', 'Clasificador', 500, 50, 550, 'GPT-5.5'),
      raw('2026-09-01', 'Redactor', 300, 30, 330, 'GPT-4o'),
    ]);

    expect(component.modelDetail()).toEqual([
      { model: 'GPT-5.5', inputTokens: 1500, outputTokens: 150, totalTokens: 1650 },
      { model: 'GPT-4o', inputTokens: 300, outputTokens: 30, totalTokens: 330 },
    ]);
    // El regrouping no debe alterar los KPIs ni el agregado por nodo.
    expect(component.totals().total).toBe(1980);
    expect(component.byNode()).toEqual([
      { name: 'Clasificador', value: 1650 },
      { name: 'Redactor', value: 330 },
    ]);
  });

  it('should not mutate the source rows when grouping the detail', () => {
    load([
      raw('2026-09-01', 'Clasificador', 1000, 100, 1100, 'GPT-5.5'),
      raw('2026-09-02', 'Clasificador', 500, 50, 550, 'GPT-5.5'),
    ]);

    expect(component.rows()[0].totalTokens).toBe(1100);
    expect(component.modelDetail()[0].totalTokens).toBe(1650);
  });

  it('should sort the detail rows by total descending', () => {
    load([
      raw('2026-09-01', 'Chico', 10, 1, 11, 'ModeloA'),
      raw('2026-09-03', 'Grande', 5000, 500, 5500, 'ModeloB'),
      raw('2026-09-02', 'Medio', 500, 50, 550, 'ModeloC'),
    ]);

    expect(component.modelDetail().map((r) => r.model)).toEqual(['ModeloB', 'ModeloC', 'ModeloA']);
  });

  it('should render the detail table grouped by model with a totals row', () => {
    load();

    const headers = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Modelo', 'Input', 'Output', 'Total']);

    const modelCells = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table tbody tr td:first-child'),
    ).map((td) => td.textContent?.trim());
    expect(modelCells).toEqual(['GPT-4o', 'GPT-5.5']);

    const totalRow = fixture.nativeElement.querySelector('.detail-table tfoot tr');
    expect(totalRow?.textContent).toContain('Total');
  });

  // La leyenda es HTML propio: la de ngx-charts con position=Below no descuenta
  // su alto del SVG y terminaba superponiéndose sobre la tarjeta siguiente.
  it('should build the legend from the series and their scheme colors', () => {
    load();

    expect(component.legendItems()).toEqual([
      { name: 'Input', color: component.seriesScheme.domain?.[0] },
      { name: 'Output', color: component.seriesScheme.domain?.[1] },
    ]);
  });

  it('should render the legend next to the title and not inside the chart', () => {
    load();

    const items = fixture.nativeElement.querySelectorAll('.mini-legend li');
    expect(Array.from<Element>(items).map((li) => li.textContent?.trim())).toEqual([
      'Input',
      'Output',
    ]);
    // La leyenda interna de ngx-charts queda desactivada para evitar el desborde.
    expect(fixture.nativeElement.querySelector('.chart-legend')).toBeNull();
  });

  it('should cap the detail table and grow it on demand', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      raw('2026-09-01', `Nodo${i}`, i, i, 2 * i, `Modelo${i}`),
    );
    load(many);

    expect(component.detailRows().length).toBe(50);
    expect(component.hasMoreRows()).toBe(true);

    component.showMore();
    expect(component.detailRows().length).toBe(60);
    expect(component.hasMoreRows()).toBe(false);
  });

  it('should extend the color domain to cover every node', () => {
    load();
    expect(component.nodeScheme().domain?.length).toBe(2);

    // Más nodos que colores base: el dominio debe crecer, no reciclar tonos.
    const wide = Array.from({ length: 7 }, (_, i) =>
      raw(`2026-09-0${(i % 9) + 1}`, `Nodo${i}`, 10, 5, 15),
    );
    component.load();
    flushTokens(wide);
    flushCosts();

    expect(component.nodeScheme().domain?.length).toBe(7);
  });

  it('should extend the model color domain to cover every model', () => {
    const wide = Array.from({ length: 7 }, (_, i) =>
      raw(`2026-09-0${(i % 9) + 1}`, 'Nodo', 10, 5, 15, `Modelo${i}`),
    );
    load(wide);

    expect(component.modelScheme().domain?.length).toBe(7);
  });

  it('should show an error message when the request fails', () => {
    fixture.detectChanges();
    // Primero la de costos: si la de tokens fallara antes, forkJoin cancelaría la
    // petición de costos y flush posterior lanzaría "Cannot flush a cancelled request".
    flushCosts();
    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBe(false);
    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('Reintentar');
  });

  // El filtro de cliente es global (cabecera del menú): "Todos" no envía client_id.
  it('should not send client_id on init when no client is selected', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.has('client_id')).toBe(false);
    req.flush([]);

    // Tampoco se envía project_ids: sin cliente no hay proyecto de OpenAI que filtrar.
    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(costReq.request.params.has('project_ids')).toBe(false);
    costReq.flush(page([]));
  });

  it('should send client_id for the selected client and reload when it changes', () => {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush([]);
    httpTesting.expectOne((r) => r.url === COSTS_URL).flush(page([]));

    clientContext.clients.set([
      client({ clientId: 7, name: 'Cliente Siete', projectId: 'proj_7' }),
    ]);
    clientContext.selectClient(7);
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('client_id')).toBe('7');
    req.flush([raw('2026-09-01', 'Clasificador', 10, 5, 15, 'GPT-5.5')]);

    // Los costos viajan con el project_id del cliente elegido (igual que Uso OpenAI).
    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(costReq.request.params.getAll('project_ids')).toEqual(['proj_7']);
    costReq.flush(page([]));

    expect(component.totals().total).toBe(15);
  });

  // -----------------------
  // Cards de costo (GET /api/usage/costs, misma lógica que Uso OpenAI)
  // -----------------------

  it('should show the two cost cards with the daily average and the accumulated amount', () => {
    load();

    // 10.5 + 4.25 + 2.25 = 17 USD repartidos en 2 días con costo.
    expect(component.costTotals().amount).toBe(17);
    expect(component.costTotals().dayCount).toBe(2);
    expect(component.costTotals().avgPerDay).toBe(8.5);
    expect(component.primaryCurrency()).toBe('usd');
    expect(component.costCurrencyLabel()).toBe('US$');

    const cards = fixture.nativeElement.querySelectorAll('.stats-row-costs .stat-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('span').textContent.trim()).toBe(
      'Promedio diario de consumo en US$',
    );
    expect(cards[0].querySelector('.stat-value').textContent.trim()).toBe('8,50');
    expect(cards[0].querySelector('.stat-hint').textContent.trim()).toBe('2 días con costo');
    expect(cards[1].querySelector('span').textContent.trim()).toBe(
      'Monto acumulado en el mes en US$',
    );
    expect(cards[1].querySelector('.stat-value').textContent.trim()).toBe('17,00');
  });

  // Los importes no son sumables entre monedas: solo se totaliza la principal
  // y el resto se informa en el aviso (.notice), como en Uso OpenAI.
  it('should not sum amounts across currencies', () => {
    load(SAMPLE, page([{ startTime: SEP_01, results: [cost(50, 'usd'), cost(10, 'eur')] }]));

    expect(component.primaryCurrency()).toBe('usd');
    expect(component.costTotals().amount).toBe(50);
    expect(component.costTotals().dayCount).toBe(1);
    expect(component.otherCurrencies().map((c) => c.currency)).toEqual(['eur']);

    const notice = fixture.nativeElement.querySelector('.notice');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('USD');
    expect(notice.textContent).toContain('EUR 10,00');
    expect(fixture.nativeElement.querySelectorAll('.stats-row-costs .stat-card').length).toBe(2);
  });

  // Si fallan los costos, los tokens se siguen mostrando: solo se ocultan las
  // cards y aparece el aviso de error parcial.
  it('should keep tokens visible and hide the cost cards when costs fail', () => {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush(SAMPLE);
    httpTesting
      .expectOne((r) => r.url === COSTS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.costError()).toBeTruthy();
    expect(component.error()).toBeNull();
    expect(component.isLoading()).toBe(false);
    expect(component.totals().total).toBe(4050);
    expect(component.showCostCards()).toBe(false);

    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('Las tarjetas de costo no están disponibles.');
    expect(fixture.nativeElement.querySelector('.stats-row-costs')).toBeNull();
    expect(fixture.nativeElement.querySelector('.stats-row')).toBeTruthy();
  });

  // /api/usage/costs exige usage.read: sin ese permiso no se pide nada (el
  // backend devolvería 403) y las cards quedan ocultas.
  it('should not request costs nor show the cards without usage.read', () => {
    TestBed.inject(PermissionsService).permissions.set([PERMISSIONS.tokensRead]);

    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush([]);
    httpTesting.expectNone((r) => r.url === COSTS_URL);
    fixture.detectChanges();

    expect(component.showCostCards()).toBe(false);
    expect(fixture.nativeElement.querySelector('.stats-row-costs')).toBeNull();
  });

  // start_date es obligatorio en /api/usage/costs: sin "Desde" solo se piden tokens.
  it('should keep requesting tokens but not costs when the start date is cleared', () => {
    load();

    component.setStartDate('');
    component.applyDateRange();

    httpTesting.expectOne((r) => r.url === API_URL).flush([]);
    httpTesting.expectNone((r) => r.url === COSTS_URL);
    fixture.detectChanges();

    expect(component.showCostCards()).toBe(false);
    expect(fixture.nativeElement.querySelector('.stats-row-costs')).toBeNull();
  });
});
