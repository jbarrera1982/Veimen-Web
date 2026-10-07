import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConsumoDashboardComponent } from './consumo-dashboard.component';
import { UsageService } from '../services/usage.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/usage/completions`;

// Epoch (segundos) de 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z.
const SEP_01 = 1788220800;
const SEP_02 = 1788307200;

function result(
  input: number,
  output: number,
  opts: {
    model?: string | null;
    requests?: number | null;
    cached?: number | null;
  } = {},
) {
  return {
    input_tokens: input,
    output_tokens: output,
    input_cached_tokens: opts.cached ?? null,
    num_model_requests: opts.requests ?? null,
    model: opts.model === undefined ? 'gpt-5' : opts.model,
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

const SAMPLE = page([
  {
    startTime: SEP_01,
    results: [
      result(1000, 100, { requests: 4 }),
      result(2000, 400, { model: 'gpt-4o', requests: 6 }),
    ],
  },
  { startTime: SEP_02, results: [result(500, 50, { requests: 2 })] },
]);

describe('ConsumoDashboardComponent', () => {
  let component: ConsumoDashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ConsumoDashboardComponent],
      providers: [UsageService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConsumoDashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function load(data: Record<string, unknown> = SAMPLE): void {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush(data);
    fixture.detectChanges();
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  // A diferencia de /api/ServiceRequests/tokens, este endpoint exige start_date:
  // sin "desde" no se debe disparar la petición para no comerse un 400.
  it('should always request a date range on init', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('start_date')).toMatch(/^\d{8}$/);
    expect(req.request.params.get('end_date')).toMatch(/^\d{8}$/);
    req.flush(page([]));
  });

  it('should not request anything when the start date is cleared', () => {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush(page([]));
    fixture.detectChanges();

    component.setStartDate('');
    component.applyDateRange();
    httpTesting.expectNone((r) => r.url === API_URL);
  });

  it('should resend the range in YYYYMMDD when the filters are applied', () => {
    load();

    component.setStartDate('2026-09-01');
    component.setEndDate('2026-09-30');
    component.applyDateRange();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.params.get('start_date')).toBe('20260901');
    expect(req.request.params.get('end_date')).toBe('20260930');
    req.flush(page([]));
  });

  it('should sum the KPIs from every row', () => {
    load();

    expect(component.totals().input).toBe(3500);
    expect(component.totals().output).toBe(550);
    expect(component.totals().total).toBe(4050);
    expect(component.totals().requests).toBe(12);
    expect(component.totals().dayCount).toBe(2);
    expect(component.totals().avgPerDay).toBe(2025);
  });

  it('should report cached tokens separately without inflating the total', () => {
    load(page([{ startTime: SEP_01, results: [result(1000, 100, { cached: 800 })] }]));

    expect(component.totals().cached).toBe(800);
    expect(component.totals().total).toBe(1100);
  });

  it('should build one timeline series per token direction', () => {
    load();

    const series = component.timelineSeries();
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

  // OpenAI devuelve una fila por día × modelo × proyecto × api_key × usuario, así
  // que varias filas del mismo modelo deben terminar en una sola fila del detalle.
  it('should group the detail rows by model across days and dimensions', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [result(1000, 100, { requests: 4 }), result(300, 30, { requests: 1 })],
        },
        { startTime: SEP_02, results: [result(500, 50, { requests: 2 })] },
      ]),
    );

    expect(component.modelDetail()).toEqual([
      {
        model: 'gpt-5',
        inputTokens: 1800,
        cachedInputTokens: 0,
        outputTokens: 180,
        totalTokens: 1980,
        requests: 7,
      },
    ]);
    expect(component.byModel()).toEqual([{ name: 'gpt-5', value: 1980 }]);
    // El regrouping no debe alterar los KPIs.
    expect(component.totals().total).toBe(1980);
  });

  it('should bucket rows without a model under a placeholder', () => {
    load(page([{ startTime: SEP_01, results: [result(10, 5, { model: null })] }]));

    expect(component.byModel()).toEqual([{ name: '—', value: 15 }]);
  });

  it('should not mutate the source rows when grouping the detail', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [result(1000, 100, { requests: 4 }), result(300, 30, { requests: 1 })],
        },
      ]),
    );

    expect(component.rows()[0].totalTokens).toBe(1100);
    expect(component.modelDetail()[0].totalTokens).toBe(1430);
  });

  it('should sort the detail rows by total descending', () => {
    load(
      page([
        { startTime: SEP_01, results: [result(10, 1, { model: 'Chico' })] },
        { startTime: SEP_02, results: [result(5000, 500, { model: 'Grande' })] },
        { startTime: SEP_02, results: [result(500, 50, { model: 'Medio' })] },
      ]),
    );

    expect(component.modelDetail().map((r) => r.model)).toEqual(['Grande', 'Medio', 'Chico']);
  });

  it('should aggregate requests by model', () => {
    load();

    expect(component.requestsByModel()).toEqual([
      { name: 'gpt-4o', value: 6 },
      { name: 'gpt-5', value: 6 },
    ]);
  });

  it('should render the detail table grouped by model with a totals row', () => {
    load();

    const headers = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Modelo', 'Entrada', 'De caché', 'Salida', 'Total', 'Solicitudes']);

    const modelCells = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table tbody tr td:first-child'),
    ).map((td) => td.textContent?.trim());
    expect(modelCells).toEqual(['gpt-4o', 'gpt-5']);

    expect(fixture.nativeElement.querySelector('.detail-table tfoot tr')?.textContent).toContain(
      'Total',
    );
  });

  // La leyenda es HTML propio: la de ngx-charts con position=Below no descuenta
  // su alto del SVG y terminaba superponiéndose sobre la tarjeta siguiente.
  it('should render the legend next to the title and not inside the chart', () => {
    load();

    const items = fixture.nativeElement.querySelectorAll('.mini-legend li');
    expect(Array.from<Element>(items).map((li) => li.textContent?.trim())).toEqual([
      'Entrada',
      'Salida',
    ]);
    expect(fixture.nativeElement.querySelector('.chart-legend')).toBeNull();
  });

  it('should cap the detail table and grow it on demand', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      result(10, 5, { model: `Modelo${i}`, requests: 1 }),
    );
    load(page([{ startTime: SEP_01, results: many }]));

    expect(component.detailRows().length).toBe(50);
    expect(component.hasMoreRows()).toBe(true);

    component.showMore();
    expect(component.detailRows().length).toBe(60);
    expect(component.hasMoreRows()).toBe(false);
  });

  it('should extend the model color domain to cover every model', () => {
    const wide = Array.from({ length: 7 }, (_, i) => result(10, 5, { model: `Modelo${i}` }));
    load(page([{ startTime: SEP_01, results: wide }]));

    expect(component.modelScheme().domain?.length).toBe(7);
  });

  it('should show an empty state when there is no usage in the range', () => {
    load(page([]));

    expect(component.rows().length).toBe(0);
    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('No se registró consumo en el rango seleccionado.');
  });

  it('should show an error message when the request fails', () => {
    fixture.detectChanges();
    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Reintentar');
  });
});
