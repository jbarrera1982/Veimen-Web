import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsoOpenAiComponent } from './uso-openai.component';
import { UsageService } from '../services/usage.service';
import { environment } from '../../environments/environment';

const COMPLETIONS_URL = `${environment.apiBaseUrl}/api/usage/completions`;
const COSTS_URL = `${environment.apiBaseUrl}/api/usage/costs`;

// Epoch (segundos) de 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z.
const SEP_01 = 1788220800;
const SEP_02 = 1788307200;

function usage(
  input: number,
  output: number,
  opts: {
    model?: string | null;
    requests?: number | null;
    cached?: number | null;
    project?: string | null;
  } = {},
) {
  return {
    input_tokens: input,
    output_tokens: output,
    input_cached_tokens: opts.cached ?? null,
    num_model_requests: opts.requests ?? null,
    model: opts.model === undefined ? 'gpt-5' : opts.model,
    project_id: opts.project === undefined ? 'proj_a' : opts.project,
  };
}

function cost(
  value: number,
  currency: string | null,
  opts: {
    lineItem?: string | null;
    quantity?: number | null;
    unit?: string | null;
    project?: string | null;
  } = {},
) {
  return {
    amount: currency === null ? null : { value, currency },
    line_item: opts.lineItem === undefined ? 'gpt-5' : opts.lineItem,
    quantity: opts.quantity ?? null,
    quantity_unit: opts.unit === undefined ? 'tokens' : opts.unit,
    project_id: opts.project === undefined ? 'proj_a' : opts.project,
  };
}

// Envoltura page → bucket → results tal como la devuelve el backend.
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

const USAGE_SAMPLE = page([
  {
    startTime: SEP_01,
    results: [
      usage(1000, 100, { requests: 4 }),
      usage(2000, 400, { model: 'gpt-4o', requests: 6 }),
    ],
  },
  { startTime: SEP_02, results: [usage(500, 50, { requests: 2 })] },
]);

const COST_SAMPLE = page([
  {
    startTime: SEP_01,
    results: [
      cost(10.5, 'usd', { lineItem: 'gpt-5', quantity: 1000 }),
      cost(4.25, 'usd', { lineItem: 'gpt-4o', quantity: 500, unit: 'requests' }),
    ],
  },
  { startTime: SEP_02, results: [cost(2.25, 'usd', { lineItem: 'gpt-5', quantity: 200 })] },
]);

describe('UsoOpenAiComponent', () => {
  let component: UsoOpenAiComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [UsoOpenAiComponent],
      providers: [UsageService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UsoOpenAiComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function load(
    usageData: Record<string, unknown> = USAGE_SAMPLE,
    costData: Record<string, unknown> = COST_SAMPLE,
  ): void {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === COMPLETIONS_URL).flush(usageData);
    httpTesting.expectOne((r) => r.url === COSTS_URL).flush(costData);
    fixture.detectChanges();
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  // Los dos endpoints exigen start_date: sin "desde" no se debe disparar la petición.
  it('should request both endpoints with a date range on init', () => {
    fixture.detectChanges();

    const usageReq = httpTesting.expectOne((r) => r.url === COMPLETIONS_URL);
    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(usageReq.request.method).toBe('GET');
    expect(costReq.request.method).toBe('GET');
    expect(usageReq.request.params.get('start_date')).toMatch(/^\d{8}$/);
    expect(usageReq.request.params.get('end_date')).toMatch(/^\d{8}$/);
    expect(costReq.request.params.get('start_date')).toMatch(/^\d{8}$/);

    usageReq.flush(page([]));
    costReq.flush(page([]));
  });

  it('should not request anything when the start date is cleared', () => {
    load();

    component.setStartDate('');
    component.applyDateRange();
    httpTesting.expectNone((r) => r.url === COMPLETIONS_URL);
    httpTesting.expectNone((r) => r.url === COSTS_URL);
  });

  it('should resend the range in YYYYMMDD to both endpoints when the filters are applied', () => {
    load();

    component.setStartDate('2026-09-01');
    component.setEndDate('2026-09-30');
    component.applyDateRange();

    const usageReq = httpTesting.expectOne((r) => r.url === COMPLETIONS_URL);
    expect(usageReq.request.params.get('start_date')).toBe('20260901');
    expect(usageReq.request.params.get('end_date')).toBe('20260930');
    usageReq.flush(page([]));

    const costReq = httpTesting.expectOne((r) => r.url === COSTS_URL);
    expect(costReq.request.params.get('start_date')).toBe('20260901');
    expect(costReq.request.params.get('end_date')).toBe('20260930');
    costReq.flush(page([]));
  });

  // -----------------------
  // Consumo
  // -----------------------

  it('should sum the token KPIs from every row', () => {
    load();

    expect(component.totals().input).toBe(3500);
    expect(component.totals().output).toBe(550);
    expect(component.totals().total).toBe(4050);
    expect(component.totals().requests).toBe(12);
    expect(component.totals().dayCount).toBe(2);
    expect(component.totals().avgPerDay).toBe(2025);
  });

  it('should report cached tokens separately without inflating the total', () => {
    load(page([{ startTime: SEP_01, results: [usage(1000, 100, { cached: 800 })] }]));

    expect(component.totals().cached).toBe(800);
    expect(component.totals().total).toBe(1100);
  });

  it('should build one daily usage series per token direction', () => {
    load();

    const series = component.dailyUsageSeries();
    expect(series.map((s) => s.name)).toEqual(['Entrada', 'Salida']);
    expect(series[0].series).toEqual([
      { name: '2026-09-01', value: 3000 },
      { name: '2026-09-02', value: 500 },
    ]);
    expect(series[1].series).toEqual([
      { name: '2026-09-01', value: 500 },
      { name: '2026-09-02', value: 50 },
    ]);
  });

  it('should group the model detail across days and dimensions', () => {
    load();

    expect(component.modelDetail()).toEqual([
      {
        model: 'gpt-4o',
        inputTokens: 2000,
        cachedInputTokens: 0,
        outputTokens: 400,
        totalTokens: 2400,
        requests: 6,
      },
      {
        model: 'gpt-5',
        inputTokens: 1500,
        cachedInputTokens: 0,
        outputTokens: 150,
        totalTokens: 1650,
        requests: 6,
      },
    ]);
    expect(component.byModel()).toEqual([
      { name: 'gpt-4o', value: 2400 },
      { name: 'gpt-5', value: 1650 },
    ]);
  });

  it('should bucket rows without a model under a placeholder', () => {
    load(page([{ startTime: SEP_01, results: [usage(10, 5, { model: null })] }]));

    expect(component.byModel()).toEqual([{ name: '—', value: 15 }]);
  });

  it('should aggregate requests by model', () => {
    load();

    expect(component.requestsByModel()).toEqual([
      { name: 'gpt-4o', value: 6 },
      { name: 'gpt-5', value: 6 },
    ]);
  });

  // -----------------------
  // Costos
  // -----------------------

  it('should sum the cost in the only currency present', () => {
    load();

    expect(component.primaryCurrency()).toBe('usd');
    expect(component.costTotals().amount).toBeCloseTo(17, 6);
    expect(component.costTotals().dayCount).toBe(2);
    expect(component.costTotals().avgPerDay).toBeCloseTo(8.5, 6);
    expect(component.costTotals().max).toBeCloseTo(10.5, 6);
    expect(component.otherCurrencies()).toEqual([]);
  });

  // 10 USD + 25 EUR no son "35": los importes de otra moneda no se suman.
  it('should not add amounts from different currencies', () => {
    load(
      USAGE_SAMPLE,
      page([
        {
          startTime: SEP_01,
          results: [cost(10, 'usd', { lineItem: 'gpt-5' }), cost(25, 'eur', { lineItem: 'gpt-4o' })],
        },
      ]),
    );

    expect(component.primaryCurrency()).toBe('eur');
    expect(component.costTotals().amount).toBe(25);
    expect(component.otherCurrencies()).toEqual([{ currency: 'usd', amount: 10, dayCount: 1 }]);

    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('no se suman entre monedas');
    expect(rendered).toContain('USD 10');
  });

  it('should pick the currency with the highest total as the primary one', () => {
    load(
      USAGE_SAMPLE,
      page([
        {
          startTime: SEP_01,
          results: [cost(5, 'usd', { lineItem: 'a' }), cost(50, 'eur', { lineItem: 'b' })],
        },
      ]),
    );

    expect(component.primaryCurrency()).toBe('eur');
    expect(component.costTotals().amount).toBe(50);
  });

  it('should build a single daily cost series sorted by date', () => {
    load();

    const series = component.dailyCostSeries();
    expect(series.length).toBe(1);
    expect(series[0].name).toBe('usd');
    expect(series[0].series).toEqual([
      { name: '2026-09-01', value: 14.75 },
      { name: '2026-09-02', value: 2.25 },
    ]);
    expect(component.hasCostTimelineData()).toBe(true);
  });

  it('should group the line item detail with quantity and unit', () => {
    load();

    expect(component.lineItemDetail()).toEqual([
      { lineItem: 'gpt-5', amount: 12.75, quantity: 1200, quantityUnit: 'tokens' },
      { lineItem: 'gpt-4o', amount: 4.25, quantity: 500, quantityUnit: 'requests' },
    ]);
    expect(component.byLineItem()).toEqual([
      { name: 'gpt-5', value: 12.75 },
      { name: 'gpt-4o', value: 4.25 },
    ]);
  });

  // Sumar 1000 tokens + 3 requests no significa nada: unidades distintas → sin cantidad.
  it('should hide the quantity when a line item mixes units', () => {
    load(
      USAGE_SAMPLE,
      page([
        {
          startTime: SEP_01,
          results: [
            cost(10, 'usd', { lineItem: 'gpt-5', quantity: 1000, unit: 'tokens' }),
            cost(5, 'usd', { lineItem: 'gpt-5', quantity: 3, unit: 'requests' }),
          ],
        },
      ]),
    );

    expect(component.lineItemDetail()).toEqual([
      { lineItem: 'gpt-5', amount: 15, quantity: null, quantityUnit: '' },
    ]);
  });

  // -----------------------
  // Detalle diario (tokens + costo)
  // -----------------------

  it('should join daily token consumption with the day cost, newest first', () => {
    load();

    expect(component.dailyDetail()).toEqual([
      {
        date: '2026-09-02',
        inputTokens: 500,
        outputTokens: 50,
        totalTokens: 550,
        requests: 2,
        cost: 2.25,
      },
      {
        date: '2026-09-01',
        inputTokens: 3000,
        outputTokens: 500,
        totalTokens: 3500,
        requests: 10,
        cost: 14.75,
      },
    ]);
  });

  // El detalle diario se basa en el consumo: un día con costo pero sin tokens no aparece.
  it('should only include days with token consumption in the daily detail', () => {
    load(
      page([{ startTime: SEP_01, results: [usage(1000, 100, { requests: 4 })] }]),
      page([
        { startTime: SEP_01, results: [cost(10.5, 'usd')] },
        { startTime: SEP_02, results: [cost(9.99, 'usd')] },
      ]),
    );

    expect(component.dailyDetail().map((r) => r.date)).toEqual(['2026-09-01']);
    expect(component.dailyDetail()[0].cost).toBe(10.5);
  });

  it('should default the daily cost to zero when there are no costs', () => {
    load(page([{ startTime: SEP_01, results: [usage(1000, 100)] }]), page([]));

    expect(component.dailyDetail()).toEqual([
      {
        date: '2026-09-01',
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        requests: 0,
        cost: 0,
      },
    ]);
  });

  // -----------------------
  // Detalle por proyecto
  // -----------------------

  it('should consolidate tokens and cost per project', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [
            usage(1000, 100, { requests: 4, project: 'proj_a' }),
            usage(2000, 400, { requests: 6, project: 'proj_b' }),
          ],
        },
      ]),
      page([
        {
          startTime: SEP_01,
          results: [
            cost(10.5, 'usd', { project: 'proj_a' }),
            cost(4.25, 'usd', { project: 'proj_b' }),
          ],
        },
      ]),
    );

    expect(component.projectDetail()).toEqual([
      {
        project: 'proj_b',
        inputTokens: 2000,
        outputTokens: 400,
        totalTokens: 2400,
        requests: 6,
        cost: 4.25,
      },
      {
        project: 'proj_a',
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        requests: 4,
        cost: 10.5,
      },
    ]);
    expect(component.byProjectTokens()).toEqual([
      { name: 'proj_b', value: 2400 },
      { name: 'proj_a', value: 1100 },
    ]);
    expect(component.byProjectCost()).toEqual([
      { name: 'proj_a', value: 10.5 },
      { name: 'proj_b', value: 4.25 },
    ]);
  });

  // Un proyecto puede gastar sin tener completions (p. ej. imágenes): debe aparecer.
  it('should include projects that only have cost', () => {
    load(
      page([{ startTime: SEP_01, results: [usage(1000, 100, { requests: 4, project: 'proj_a' })] }]),
      page([{ startTime: SEP_01, results: [cost(7.5, 'usd', { project: 'proj_only_cost' })] }]),
    );

    expect(component.projectDetail().map((r) => r.project).sort()).toEqual([
      'proj_a',
      'proj_only_cost',
    ]);
    const onlyCost = component
      .projectDetail()
      .find((r) => r.project === 'proj_only_cost');
    expect(onlyCost).toEqual({
      project: 'proj_only_cost',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      cost: 7.5,
    });
  });

  it('should bucket rows without a project under a placeholder', () => {
    load(
      page([{ startTime: SEP_01, results: [usage(10, 5, { project: null })] }]),
      page([{ startTime: SEP_01, results: [cost(1.5, 'usd', { project: null })] }]),
    );

    expect(component.projectDetail()).toEqual([
      {
        project: '—',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        requests: 0,
        cost: 1.5,
      },
    ]);
  });

  // -----------------------
  // Render y estados
  // -----------------------

  it('should render the daily detail table with a totals row', () => {
    load();

    const headers = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers).toContain('Fecha');
    expect(headers).toContain('Costo');

    const firstRow = fixture.nativeElement.querySelector('.detail-table tbody tr');
    expect(firstRow.textContent).toContain('2026-09-02');
  });

  it('should render the legend next to the consumption chart title', () => {
    load();

    const items = fixture.nativeElement.querySelectorAll('.mini-legend li');
    expect(Array.from<Element>(items).map((li) => li.textContent?.trim())).toEqual([
      'Entrada',
      'Salida',
    ]);
  });

  it('should cap the detail tables and grow them on demand', () => {
    const manyUsage = Array.from({ length: 60 }, (_, i) =>
      usage(10, 5, { model: `Modelo${i}`, requests: 1 }),
    );
    load(page([{ startTime: SEP_01, results: manyUsage }]));

    expect(component.modelRows().length).toBe(50);
    expect(component.hasMoreModels()).toBe(true);

    component.showMoreModels();
    expect(component.modelRows().length).toBe(60);
    expect(component.hasMoreModels()).toBe(false);
  });

  it('should extend the project color domain to cover every project', () => {
    const wide = Array.from({ length: 7 }, (_, i) =>
      usage(10, 5, { project: `proj_${i}` }),
    );
    load(page([{ startTime: SEP_01, results: wide }]));

    expect(component.projectTokenScheme().domain?.length).toBe(7);
  });

  it('should show an empty state when there is no usage or cost in the range', () => {
    load(page([]), page([]));

    expect(component.usageRows().length).toBe(0);
    expect(component.costRows().length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain(
      'No se registró uso de OpenAI en el rango seleccionado.',
    );
  });

  // Si solo falla una fuente, se muestra la otra con un aviso.
  it('should render a partial result when only one endpoint fails', () => {
    fixture.detectChanges();
    httpTesting
      .expectOne((r) => r.url === COMPLETIONS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    httpTesting.expectOne((r) => r.url === COSTS_URL).flush(COST_SAMPLE);
    fixture.detectChanges();

    expect(component.usageError()).toBeTruthy();
    expect(component.costError()).toBeNull();
    expect(component.costRows().length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain('pueden estar incompletas');
    expect(component.costTotals().amount).toBeCloseTo(17, 6);
  });

  it('should show an error with retry when both endpoints fail', () => {
    fixture.detectChanges();
    httpTesting
      .expectOne((r) => r.url === COMPLETIONS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    httpTesting
      .expectOne((r) => r.url === COSTS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.allFailed()).toBe(true);
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Reintentar');
  });
});
