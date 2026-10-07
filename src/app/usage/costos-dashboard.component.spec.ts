import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CostosDashboardComponent } from './costos-dashboard.component';
import { UsageService } from '../services/usage.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/usage/costs`;

// Epoch (segundos) de 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z.
const SEP_01 = 1788220800;
const SEP_02 = 1788307200;

function cost(
  value: number,
  currency: string | null,
  opts: { lineItem?: string | null; quantity?: number | null; unit?: string | null } = {},
) {
  return {
    amount: currency === null ? null : { value, currency },
    line_item: opts.lineItem === undefined ? 'gpt-5' : opts.lineItem,
    quantity: opts.quantity ?? null,
    quantity_unit: opts.unit === undefined ? 'tokens' : opts.unit,
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
      cost(10.5, 'usd', { lineItem: 'gpt-5', quantity: 1000 }),
      cost(4.25, 'usd', { lineItem: 'gpt-4o', quantity: 500, unit: 'requests' }),
    ],
  },
  { startTime: SEP_02, results: [cost(2.25, 'usd', { lineItem: 'gpt-5', quantity: 200 })] },
]);

describe('CostosDashboardComponent', () => {
  let component: CostosDashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [CostosDashboardComponent],
      providers: [UsageService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CostosDashboardComponent);
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

  it('should sum the cost in the only currency present', () => {
    load();

    expect(component.primaryCurrency()).toBe('usd');
    expect(component.totals().amount).toBeCloseTo(17, 6);
    expect(component.totals().dayCount).toBe(2);
    expect(component.totals().avgPerDay).toBeCloseTo(8.5, 6);
    expect(component.totals().max).toBeCloseTo(10.5, 6);
    expect(component.otherCurrencies()).toEqual([]);
  });

  // 10 USD + 25 EUR no son "35": los importes de otra moneda no se suman ni se
  // mezclan en los gráficos, solo se informan aparte.
  it('should not add amounts from different currencies', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [
            cost(10, 'usd', { lineItem: 'gpt-5' }),
            cost(25, 'eur', { lineItem: 'gpt-4o' }),
          ],
        },
      ]),
    );

    expect(component.primaryCurrency()).toBe('eur');
    expect(component.totals().amount).toBe(25);
    expect(component.totals().dayCount).toBe(1);
    expect(component.otherCurrencies()).toEqual([{ currency: 'usd', amount: 10, dayCount: 1 }]);
    // Solo entra la moneda principal en el detalle.
    expect(component.lineItemDetail().map((r) => r.lineItem)).toEqual(['gpt-4o']);

    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('no se suman entre monedas');
    expect(rendered).toContain('USD 10');
  });

  // Empate de importes: el desempate es alfabético, para que sea determinista.
  it('should break a tie between currencies alphabetically', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [
            cost(10, 'usd', { lineItem: 'gpt-5' }),
            cost(10, 'eur', { lineItem: 'gpt-4o' }),
          ],
        },
      ]),
    );

    expect(component.primaryCurrency()).toBe('eur');
    expect(component.totals().amount).toBe(10);
  });

  it('should pick the currency with the highest total as the primary one', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [cost(5, 'usd', { lineItem: 'a' }), cost(50, 'eur', { lineItem: 'b' })],
        },
      ]),
    );

    expect(component.primaryCurrency()).toBe('eur');
    expect(component.totals().amount).toBe(50);
    expect(component.otherCurrencies()).toEqual([{ currency: 'usd', amount: 5, dayCount: 1 }]);
  });

  it('should group the detail rows by line item with quantity and unit', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [cost(10, 'usd', { lineItem: 'gpt-5', quantity: 1000 })],
        },
        {
          startTime: SEP_02,
          results: [cost(5, 'usd', { lineItem: 'gpt-5', quantity: 500 })],
        },
      ]),
    );

    expect(component.lineItemDetail()).toEqual([
      { lineItem: 'gpt-5', amount: 15, quantity: 1500, quantityUnit: 'tokens' },
    ]);
    expect(component.byLineItem()).toEqual([{ name: 'gpt-5', value: 15 }]);
  });

  // Sumar 1000 tokens + 3 requests no significa nada: si un mismo concepto trae
  // unidades distintas se deja de exponer la cantidad.
  it('should hide the quantity when a line item mixes units', () => {
    load(
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

  it('should bucket rows without a line item under a placeholder', () => {
    load(page([{ startTime: SEP_01, results: [cost(1.5, 'usd', { lineItem: null })] }]));

    expect(component.byLineItem()).toEqual([{ name: '—', value: 1.5 }]);
  });

  it('should build a single daily cost series sorted by date', () => {
    load();

    const series = component.timelineSeries();
    expect(series.length).toBe(1);
    expect(series[0].name).toBe('usd');
    expect(series[0].series).toEqual([
      { name: '2026-09-01', value: 14.75 },
      { name: '2026-09-02', value: 2.25 },
    ]);
    expect(component.hasTimelineData()).toBe(true);
  });

  it('should sort the detail rows by amount descending', () => {
    load(
      page([
        {
          startTime: SEP_01,
          results: [
            cost(1, 'usd', { lineItem: 'Chico' }),
            cost(100, 'usd', { lineItem: 'Grande' }),
            cost(50, 'usd', { lineItem: 'Medio' }),
          ],
        },
      ]),
    );

    expect(component.lineItemDetail().map((r) => r.lineItem)).toEqual(['Grande', 'Medio', 'Chico']);
  });

  it('should render the detail table grouped by line item with a totals row', () => {
    load();

    const headers = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Concepto', 'Cantidad', 'Unidad', 'Costo']);

    const itemCells = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.detail-table tbody tr td:first-child'),
    ).map((td) => td.textContent?.trim());
    expect(itemCells).toEqual(['gpt-5', 'gpt-4o']);

    expect(fixture.nativeElement.querySelector('.detail-table tfoot tr')?.textContent).toContain(
      'Total',
    );
  });

  it('should cap the detail table and grow it on demand', () => {
    const many = Array.from({ length: 60 }, (_, i) => cost(i, 'usd', { lineItem: `Item${i}` }));
    load(page([{ startTime: SEP_01, results: many }]));

    expect(component.detailRows().length).toBe(50);
    expect(component.hasMoreRows()).toBe(true);

    component.showMore();
    expect(component.detailRows().length).toBe(60);
    expect(component.hasMoreRows()).toBe(false);
  });

  it('should extend the line item color domain to cover every concept', () => {
    const wide = Array.from({ length: 7 }, (_, i) => cost(i, 'usd', { lineItem: `Item${i}` }));
    load(page([{ startTime: SEP_01, results: wide }]));

    expect(component.lineItemScheme().domain?.length).toBe(7);
  });

  it('should show an empty state when there are no costs in the range', () => {
    load(page([]));

    expect(component.rows().length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain(
      'No se registraron costos en el rango seleccionado.',
    );
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
