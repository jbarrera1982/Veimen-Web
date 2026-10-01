import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TokensDashboardComponent } from './tokens-dashboard.component';
import { TokensService } from '../services/tokens.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/ServiceRequests/tokens`;

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

describe('TokensDashboardComponent', () => {
  let component: TokensDashboardComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [TokensDashboardComponent],
      providers: [TokensService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TokensDashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function load(data: unknown[] = SAMPLE): void {
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === API_URL).flush(data);
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

  // La API agrupa por día × node × llm_model: un mismo nodo que usó dos
  // modelos el mismo día llega como filas separadas. La tabla (día × nodo)
  // tiene que sumarlas para no mostrar filas indistinguibles entre sí.
  it('should merge rows that share the same date and node', () => {
    load([
      raw('2026-09-01', 'Clasificador', 1000, 100, 1100, 'GPT-5.5'),
      raw('2026-09-01', 'Clasificador', 300, 30, 330, 'GPT-4o'),
    ]);

    expect(component.sortedDetail()).toEqual([
      {
        date: '2026-09-01',
        node: 'Clasificador',
        llmModel: 'GPT-5.5',
        inputTokens: 1300,
        outputTokens: 130,
        totalTokens: 1430,
      },
    ]);
    // El regrouping no debe alterar los KPIs ni el agregado por nodo.
    expect(component.totals().total).toBe(1430);
    expect(component.byNode()).toEqual([{ name: 'Clasificador', value: 1430 }]);
  });

  it('should not mutate the source rows when merging', () => {
    load([
      raw('2026-09-01', 'Clasificador', 1000, 100, 1100, 'GPT-5.5'),
      raw('2026-09-01', 'Clasificador', 300, 30, 330, 'GPT-4o'),
    ]);

    expect(component.rows()[0].totalTokens).toBe(1100);
    expect(component.sortedDetail()[0].totalTokens).toBe(1430);
  });

  it('should sort the detail rows by date descending then total', () => {
    load([
      raw('2026-09-01', 'Chico', 10, 1, 11),
      raw('2026-09-03', 'Grande', 5000, 500, 5500),
      raw('2026-09-02', 'Medio', 500, 50, 550),
    ]);

    expect(component.sortedDetail().map((r) => r.node)).toEqual(['Grande', 'Medio', 'Chico']);
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
      raw(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, `Nodo${i}`, i, i, 2 * i),
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
    httpTesting.expectOne((r) => r.url === API_URL).flush(wide);

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
    httpTesting
      .expectOne((r) => r.url === API_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBe(false);
    const rendered: string = fixture.nativeElement.textContent;
    expect(rendered).toContain('Reintentar');
  });
});
