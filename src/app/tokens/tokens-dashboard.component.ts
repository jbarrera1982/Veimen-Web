import {
  Component,
  OnInit,
  signal,
  computed,
  effect,
  inject,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, catchError } from 'rxjs';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { TokensService, type TokenUsage } from '../services/tokens.service';
import { UsageService, type CostEntry } from '../services/usage.service';
import { ClientContextService } from '../services/client-context.service';
import { PermissionsService, PERMISSIONS } from '../services/permissions.service';

interface ChartDatum {
  name: string;
  value: number;
}

// Fila del detalle: totales de un modelo LLM en todo el rango seleccionado.
interface ModelDetailRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const DEFAULT_RANGE_DAYS = 30;
// Tope de filas visibles en la tabla de detalle: un rango de 30 días puede traer
// cientos de combinaciones día × nodo y no queremos inflar el DOM.
const TABLE_PAGE_SIZE = 50;

// Paleta base; se extiende cíclicamente para cubrir la cantidad de nodos
// presentes. Con un dominio fijo de 5 colores, ngx-charts recicla tonos cuando
// hay más categorías y las barras quedan ambiguas.
// Tonos derivados de la marca (navy + teal) con el mismo orden de familia que
// la paleta del dashboard de uso, para que un modelo tenga el mismo color en
// ambas pantallas.
const BASE_PALETTE = [
  '#2bb8a3',
  '#3d7dd8',
  '#d99a2b',
  '#d95f5a',
  '#8b7bc7',
  '#3aa7b8',
  '#7d9c5f',
  '#c76b98',
  '#6b8ca8',
  '#a87c5b',
];

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-tokens-dashboard',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './tokens-dashboard.html',
  styleUrl: './tokens-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokensDashboardComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly rows = signal<TokenUsage[]>([]);
  readonly costRows = signal<CostEntry[]>([]);
  readonly costError = signal<string | null>(null);
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly tableLimit = signal(TABLE_PAGE_SIZE);

  private inFlight = false;
  // La carga inicial la hace ngOnInit; el primer disparo del effect del cliente no recarga.
  private isFirstClientEffect = true;

  private readonly clientContext = inject(ClientContextService);
  private readonly usageService = inject(UsageService);
  private readonly permissions = inject(PermissionsService);

  // El filtro de cliente es global (cabecera del menú). "Todos" (null) no filtra.
  readonly clientId = computed<number | undefined>(
    () => this.clientContext.selectedClient()?.clientId,
  );

  /**
   * El cliente del menú decide también por qué proyecto de OpenAI se filtran los
   * costos (project_ids), igual que en Uso OpenAI. "Todos" (null) no envía nada y
   * un cliente sin projectId tampoco filtra.
   */
  readonly projectIds = computed<string[]>(() => {
    const projectId = this.clientContext.selectedClient()?.projectId.trim() ?? '';
    return projectId ? [projectId] : [];
  });

  // /api/usage/costs exige usage.read (RBAC del backend): sin ese permiso no se
  // pide nada y las cards quedan ocultas, en vez de exponer un 403 permanente.
  private readonly canReadUsage = computed(() => this.permissions.has(PERMISSIONS.usageRead));

  constructor(private tokensService: TokensService) {
    // Recarga al cambiar el cliente del menú. `untracked` evita que el efecto se
    // dispare por las señales que lee load() (fechas, errores, ...).
    effect(() => {
      this.clientContext.selectedClient();
      untracked(() => {
        if (this.isFirstClientEffect) {
          this.isFirstClientEffect = false;
          return;
        }
        this.load(true);
      });
    });
  }

  ngOnInit(): void {
    this.applyDefaultRange();
    this.load();
  }

  private applyDefaultRange(): void {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - DEFAULT_RANGE_DAYS);
    this.startDate.set(toDateInputValue(start));
    this.endDate.set(toDateInputValue(end));
  }

  setStartDate(value: string): void {
    this.startDate.set(value || null);
  }

  setEndDate(value: string): void {
    this.endDate.set(value || null);
  }

  applyDateRange(): void {
    this.load(true);
  }

  load(auto = false): void {
    if (this.inFlight) return;
    this.inFlight = true;

    if (auto) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.error.set(null);
    this.costError.set(null);

    const tokens$ = this.tokensService.getTokenUsage({
      startDate: this.startDate() ?? undefined,
      endDate: this.endDate() ?? undefined,
      clientId: this.clientId(),
    });

    // Los costos se piden en paralelo con la misma lógica que Uso OpenAI.
    // start_date es obligatorio en /api/usage/costs (lo exige la API de OpenAI),
    // así que sin "Desde" —o sin permiso usage.read— no se dispara la petición y
    // of(null) limpia las filas de costo.
    const startDate = this.startDate();
    const costs$ =
      this.canReadUsage() && startDate
        ? this.usageService
            .getCosts({
              startDate,
              endDate: this.endDate() || undefined,
              projectIds: this.projectIds(),
            })
            .pipe(
              catchError(() => {
                this.costError.set(
                  'No se pudieron cargar los costos de OpenAI. Verifica tu sesión e inténtalo de nuevo.',
                );
                return of(null);
              }),
            )
        : of(null);

    // Error por fuente: si fallan los costos, los tokens se siguen mostrando.
    forkJoin({ usage: tokens$, costs: costs$ }).subscribe({
      next: ({ usage, costs }) => {
        this.rows.set(usage);
        this.costRows.set(costs ?? []);
        this.tableLimit.set(TABLE_PAGE_SIZE);
        this.lastUpdated.set(new Date());
      },
      error: () => {
        this.error.set(
          'No se pudo cargar el consumo de tokens. Verifica tu sesión e inténtalo de nuevo.',
        );
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.inFlight = false;
      },
      complete: () => {
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.inFlight = false;
      },
    });
  }

  readonly totals = computed(() => {
    let input = 0;
    let output = 0;
    let total = 0;
    const days = new Set<string>();

    for (const r of this.rows()) {
      input += r.inputTokens;
      output += r.outputTokens;
      // Se usa totalTokens de la fila (ya agregado por la API) y no input+output:
      // es el mismo criterio que aplicó el backend al agrupar.
      total += r.totalTokens;
      days.add(r.date);
    }

    const dayCount = days.size;
    return {
      input,
      output,
      total,
      dayCount,
      avgPerDay: dayCount === 0 ? 0 : Math.round(total / dayCount),
    };
  });

  // -----------------------
  // Costos (mismos cálculos que Uso OpenAI)
  // -----------------------

  // Los importes NO son sumables entre monedas: 10 USD + 10 EUR no es "20".
  // Toda la agregación se hace sobre la moneda principal y el resto se informa aparte.
  private currencyTotals = computed(() => {
    const byCurrency = new Map<string, { amount: number; dayCount: Set<string> }>();
    for (const r of this.costRows()) {
      const key = r.currency || '—';
      const current = byCurrency.get(key);
      if (current) {
        current.amount += r.amount;
        current.dayCount.add(r.date);
      } else {
        byCurrency.set(key, { amount: r.amount, dayCount: new Set([r.date]) });
      }
    }
    return [...byCurrency.entries()]
      .map(([currency, v]) => ({ currency, amount: v.amount, dayCount: v.dayCount.size }))
      .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
  });

  /** Moneda con mayor importe: es la única que se totaliza en las cards. */
  readonly primaryCurrency = computed<string>(() => this.currencyTotals()[0]?.currency ?? '—');

  /** Importes de las demás monedas, para avisar que hay más de una. */
  readonly otherCurrencies = computed(() => this.currencyTotals().slice(1));

  readonly rowsInPrimaryCurrency = computed<CostEntry[]>(() => {
    const currency = this.primaryCurrency();
    if (currency === '—' && this.currencyTotals().length === 0) return [];
    return this.costRows().filter((r) => (r.currency || '—') === currency);
  });

  readonly costTotals = computed(() => {
    let amount = 0;
    const days = new Set<string>();

    for (const r of this.rowsInPrimaryCurrency()) {
      amount += r.amount;
      days.add(r.date);
    }

    const dayCount = days.size;
    return {
      amount,
      dayCount,
      // Igual que en Uso OpenAI: promedio por día CON costo, no por día calendario.
      avgPerDay: dayCount === 0 ? 0 : amount / dayCount,
    };
  });

  /** Las cards de costo solo se ven con permiso, con "Desde" y si la petición no falló. */
  readonly showCostCards = computed<boolean>(
    () => this.canReadUsage() && !!this.startDate() && this.costError() === null,
  );

  /** Rótulo de moneda para los títulos de las cards: USD se muestra "US$". */
  costCurrencyLabel(): string {
    const currency = this.primaryCurrency().toUpperCase();
    return currency === 'USD' || currency === '—' ? 'US$' : currency;
  }

  /** Dos series (Input / Output) para la línea de evolución diaria. */
  readonly timelineSeries = computed(() => {
    const input = new Map<string, number>();
    const output = new Map<string, number>();
    const dates = new Set<string>();

    for (const r of this.rows()) {
      if (!r.date) continue;
      dates.add(r.date);
      input.set(r.date, (input.get(r.date) ?? 0) + r.inputTokens);
      output.set(r.date, (output.get(r.date) ?? 0) + r.outputTokens);
    }

    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    return [
      {
        name: 'Input',
        series: sorted.map((date) => ({ name: date, value: input.get(date) ?? 0 })),
      },
      {
        name: 'Output',
        series: sorted.map((date) => ({ name: date, value: output.get(date) ?? 0 })),
      },
    ];
  });

  readonly hasTimelineData = computed<boolean>(() => this.timelineSeries()[0].series.length > 0);

  readonly timelineTicks = computed(() => {
    const dates = this.timelineSeries()[0].series.map((s) => s.name);
    const step = Math.max(1, Math.ceil(dates.length / 8));
    return dates.filter((_, i) => i % step === 0);
  });

  readonly byNode = computed<ChartDatum[]>(() => {
    const totals = new Map<string, number>();
    for (const r of this.rows()) {
      const key = r.node || '—';
      totals.set(key, (totals.get(key) ?? 0) + r.totalTokens);
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  });

  // El detalle agrupa por modelo (llm_model) en todo el rango; las trazas sin
  // modelo caen en '—'. Ordenado por total descendente.
  readonly modelDetail = computed<ModelDetailRow[]>(() => {
    const byModel = new Map<string, ModelDetailRow>();

    for (const r of this.rows()) {
      const key = r.llmModel || '—';
      const current = byModel.get(key);
      if (current) {
        current.inputTokens += r.inputTokens;
        current.outputTokens += r.outputTokens;
        current.totalTokens += r.totalTokens;
      } else {
        byModel.set(key, {
          model: key,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
        });
      }
    }

    return [...byModel.values()].sort(
      (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
    );
  });

  /** Totales por modelo para el gráfico, derivados del detalle. */
  readonly byModel = computed<ChartDatum[]>(() =>
    this.modelDetail().map((r) => ({ name: r.model, value: r.totalTokens })),
  );

  readonly detailRows = computed<ModelDetailRow[]>(() =>
    this.modelDetail().slice(0, this.tableLimit()),
  );

  readonly hasMoreRows = computed<boolean>(
    () => this.modelDetail().length > this.detailRows().length,
  );

  showMore(): void {
    this.tableLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  refresh(): void {
    this.load(true);
  }

  formatNumber(value: number): string {
    return value.toLocaleString('es');
  }

  /** Importe con decimales: los costos por día suelen ser fracciones de centavo. */
  formatAmount(value: number): string {
    return new Intl.NumberFormat('es', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  }

  /** Versión compacta para ejes: 12 400 → "12,4 k". */
  formatYAxis(value: number): string {
    return new Intl.NumberFormat('es', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }

  formatXAxis(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private schemeFor(size: number): Color {
    const count = Math.max(size, 1);
    return {
      name: 'veimen-web',
      selectable: true,
      group: ScaleType.Ordinal,
      domain: Array.from({ length: count }, (_, i) => BASE_PALETTE[i % BASE_PALETTE.length]),
    };
  }

  /** La línea tiene exactamente 2 series, así que su dominio es fijo. */
  readonly seriesScheme: Color = {
    name: 'veimen-web-series',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#3d7dd8', '#2bb8a3'],
  };

  // Leyenda propia en HTML en vez de la de ngx-charts: con legendPosition=Below
  // la librería no descuenta el alto de la leyenda del SVG (el SVG mide view[1]
  // completo y la leyenda se desborda sobre la tarjeta siguiente). Se deriva de
  // seriesScheme para que el color de cada muestra sea el de su línea.
  readonly legendItems = computed(() => {
    const domain = this.seriesScheme.domain ?? [];
    return this.timelineSeries().map((series, i) => ({
      name: series.name,
      color: domain[i % Math.max(domain.length, 1)] ?? '#8ba1b4',
    }));
  });

  readonly nodeScheme = computed<Color>(() => this.schemeFor(this.byNode().length));

  readonly modelScheme = computed<Color>(() => this.schemeFor(this.byModel().length));
}
