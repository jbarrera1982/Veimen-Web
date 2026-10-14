import {
  Component,
  OnInit,
  HostListener,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, catchError } from 'rxjs';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { UsageService, type CompletionUsage, type CostEntry } from '../services/usage.service';
import { ClientsService, type Client } from '../services/clients.service';
import { AuthService } from '../services/auth.service';

interface ChartDatum {
  name: string;
  value: number;
}

// Fila de detalle por modelo: totales de un modelo en todo el rango seleccionado.
interface ModelDetailRow {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
}

// Fila del detalle por concepto (line_item) en la moneda principal.
interface LineItemDetailRow {
  lineItem: string;
  amount: number;
  quantity: number | null;
  quantityUnit: string;
}

// Fila del detalle diario: consumo de tokens de un día + su costo asociado.
interface DayDetailRow {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cost: number;
}

// Fila del detalle por proyecto: consumo y costo consolidados por project_id.
interface ProjectDetailRow {
  project: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cost: number;
}

const DEFAULT_RANGE_DAYS = 30;
// Tope de filas visibles por tabla: un rango largo puede traer muchas combinaciones
// día × modelo/proyecto/concepto y no queremos inflar el DOM.
const TABLE_PAGE_SIZE = 50;

// Paleta base; se extiende cíclicamente para cubrir la cantidad de categorías
// presentes. Con un dominio fijo de 5 colores, ngx-charts reciclaría tonos
// cuando hay más categorías y las barras quedarían ambiguas.
const BASE_PALETTE = [
  '#2196F3',
  '#F44336',
  '#4CAF50',
  '#FF9800',
  '#9C27B0',
  '#00BCD4',
  '#8BC34A',
  '#FF5722',
  '#607D8B',
  '#E91E63',
];

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Dashboard unificado de uso de OpenAI ("Uso OpenAI"): consulta en paralelo el
// consumo de completions (GET /api/usage/completions) y los costos
// (GET /api/usage/costs) de la organización y los presenta en una sola vista:
// evolución diaria de consumo, evolución diaria de costo, detalle diario
// (tokens + costo) y desgloses por proyecto, modelo y concepto.
@Component({
  selector: 'app-uso-openai',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './uso-openai.component.html',
  styleUrl: './usage-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsoOpenAiComponent implements OnInit {
  private readonly usageService = inject(UsageService);
  private readonly clientsService = inject(ClientsService);
  private readonly auth = inject(AuthService);

  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly lastUpdated = signal<Date | null>(null);

  // Errores por fuente: si una falla, la otra se sigue mostrando (resultado parcial).
  readonly usageError = signal<string | null>(null);
  readonly costError = signal<string | null>(null);

  readonly usageRows = signal<CompletionUsage[]>([]);
  readonly costRows = signal<CostEntry[]>([]);
  readonly startDate = signal<string>('');
  readonly endDate = signal<string>('');

  // Filtro por cliente (proyectos de OpenAI). El usuario solo puede elegir proyectos si NO
  // tiene un cliente asociado; con cliente asociado el backend restringe el acceso, así que
  // el filtro no se muestra ni se envían project_ids.
  readonly clients = signal<Client[]>([]);
  readonly selectedProjectIds = signal<Set<string>>(new Set());
  readonly projectDropdownOpen = signal(false);
  readonly hasAssociatedClient = signal(false);

  // Un tope de filas independiente por tabla.
  readonly dailyLimit = signal(TABLE_PAGE_SIZE);
  readonly projectLimit = signal(TABLE_PAGE_SIZE);
  readonly modelLimit = signal(TABLE_PAGE_SIZE);
  readonly lineItemLimit = signal(TABLE_PAGE_SIZE);

  private inFlight = false;

  ngOnInit(): void {
    this.applyDefaultRange();
    this.initProjectFilter();
  }

  /**
   * Siempre se cargan los clientes: sirven para rotular con su nombre los proyectos que
   * aparecen en gráficos/tablas (y, sin cliente asociado, para poblar el filtro). Si el
   * usuario tiene un cliente asociado (client_id) el backend ya restringe el acceso a su
   * proyecto, por lo que el filtro no se muestra ni se envían project_ids. Si la carga falla
   * (p. ej. sin permiso clients.read) se cae al projectId y el filtro se oculta.
   */
  private initProjectFilter(): void {
    this.hasAssociatedClient.set((this.auth.currentUser()?.clientId ?? null) !== null);

    this.clientsService.getClients().subscribe({
      next: (clients) => {
        this.clients.set(clients);
        this.load();
      },
      error: () => {
        this.clients.set([]);
        this.load();
      },
    });
  }

  /** Clientes que aportan un proyecto de OpenAI (activos y con project_id no vacío). */
  readonly projectOptions = computed<Client[]>(() =>
    this.clients().filter((c) => c.active && c.projectId.trim().length > 0),
  );

  /** El filtro solo se muestra sin cliente asociado y con al menos un cliente seleccionable. */
  readonly showProjectFilter = computed<boolean>(
    () => !this.hasAssociatedClient() && this.projectOptions().length > 0,
  );

  readonly projectButtonLabel = computed<string>(() => {
    const selected = this.selectedProjectIds();
    if (selected.size === 0) return 'Todos';
    if (selected.size === 1) {
      const id = [...selected][0];
      return this.projectOptions().find((c) => c.projectId === id)?.name || '1 cliente';
    }
    return `${selected.size} clientes`;
  });

  isAllProjects(): boolean {
    return this.selectedProjectIds().size === 0;
  }

  toggleProjectDropdown(): void {
    this.projectDropdownOpen.update((v) => !v);
  }

  toggleAllProjects(): void {
    this.selectedProjectIds.set(new Set());
  }

  toggleProjectOption(projectId: string): void {
    this.selectedProjectIds.update((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.projectDropdownOpen.set(false);
  }

  private applyDefaultRange(): void {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - DEFAULT_RANGE_DAYS);
    this.startDate.set(toDateInputValue(start));
    this.endDate.set(toDateInputValue(end));
  }

  setStartDate(value: string): void {
    this.startDate.set(value);
  }

  setEndDate(value: string): void {
    this.endDate.set(value);
  }

  applyDateRange(): void {
    this.load(true);
  }

  load(auto = false): void {
    if (this.inFlight) return;
    // start_date es obligatorio en estos endpoints (lo exige la API de OpenAI), así
    // que sin "desde" no se disparan las peticiones para no comerse un 400.
    if (!this.startDate()) return;
    this.inFlight = true;

    if (auto) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.usageError.set(null);
    this.costError.set(null);

    const range = {
      startDate: this.startDate(),
      endDate: this.endDate() || undefined,
      // Con cliente asociado el backend impone el proyecto: no se envía project_ids.
      projectIds: this.hasAssociatedClient() ? undefined : [...this.selectedProjectIds()],
    };

    // Ambas peticiones en paralelo; cada una captura su error por separado para
    // poder renderizar un resultado parcial si la otra falla.
    forkJoin({
      usage: this.usageService.getCompletionsUsage(range).pipe(
        catchError(() => {
          this.usageError.set(
            'No se pudo cargar el consumo de OpenAI. Verifica tu sesión e inténtalo de nuevo.',
          );
          return of(null);
        }),
      ),
      costs: this.usageService.getCosts(range).pipe(
        catchError(() => {
          this.costError.set(
            'No se pudieron cargar los costos de OpenAI. Verifica tu sesión e inténtalo de nuevo.',
          );
          return of(null);
        }),
      ),
    }).subscribe({
      next: ({ usage, costs }) => {
        this.usageRows.set(usage ?? []);
        this.costRows.set(costs ?? []);
        this.dailyLimit.set(TABLE_PAGE_SIZE);
        this.projectLimit.set(TABLE_PAGE_SIZE);
        this.modelLimit.set(TABLE_PAGE_SIZE);
        this.lineItemLimit.set(TABLE_PAGE_SIZE);
        this.lastUpdated.set(new Date());
      },
      complete: () => {
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.inFlight = false;
      },
    });
  }

  /** true cuando fallaron las dos fuentes: no hay nada que mostrar, solo el error. */
  readonly allFailed = computed<boolean>(
    () => this.usageError() !== null && this.costError() !== null,
  );

  // -----------------------
  // Consumo (completions)
  // -----------------------

  readonly totals = computed(() => {
    let input = 0;
    let cached = 0;
    let output = 0;
    let total = 0;
    let requests = 0;
    const days = new Set<string>();

    for (const r of this.usageRows()) {
      input += r.inputTokens;
      cached += r.cachedInputTokens;
      output += r.outputTokens;
      total += r.totalTokens;
      requests += r.requests;
      days.add(r.date);
    }

    const dayCount = days.size;
    return {
      input,
      cached,
      output,
      total,
      requests,
      dayCount,
      avgPerDay: dayCount === 0 ? 0 : Math.round(total / dayCount),
    };
  });

  /** Dos series (Entrada / Salida) para la línea de evolución diaria de consumo. */
  readonly dailyUsageSeries = computed(() => {
    const input = new Map<string, number>();
    const output = new Map<string, number>();
    const dates = new Set<string>();

    for (const r of this.usageRows()) {
      if (!r.date) continue;
      dates.add(r.date);
      input.set(r.date, (input.get(r.date) ?? 0) + r.inputTokens);
      output.set(r.date, (output.get(r.date) ?? 0) + r.outputTokens);
    }

    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    return [
      {
        name: 'Entrada',
        series: sorted.map((date) => ({ name: date, value: input.get(date) ?? 0 })),
      },
      {
        name: 'Salida',
        series: sorted.map((date) => ({ name: date, value: output.get(date) ?? 0 })),
      },
    ];
  });

  readonly hasTimelineData = computed<boolean>(() => this.dailyUsageSeries()[0].series.length > 0);

  readonly timelineTicks = computed(() => {
    const dates = this.dailyUsageSeries()[0].series.map((s) => s.name);
    const step = Math.max(1, Math.ceil(dates.length / 8));
    return dates.filter((_, i) => i % step === 0);
  });

  /**
   * Detalle por modelo: OpenAI devuelve una fila por día × proyecto × modelo, así
   * que hay que sumar todas las combinaciones del mismo modelo. Sin modelo caen en '—'.
   */
  readonly modelDetail = computed<ModelDetailRow[]>(() => {
    const byModel = new Map<string, ModelDetailRow>();

    for (const r of this.usageRows()) {
      const key = r.model || '—';
      const current = byModel.get(key);
      if (current) {
        current.inputTokens += r.inputTokens;
        current.cachedInputTokens += r.cachedInputTokens;
        current.outputTokens += r.outputTokens;
        current.totalTokens += r.totalTokens;
        current.requests += r.requests;
      } else {
        byModel.set(key, {
          model: key,
          inputTokens: r.inputTokens,
          cachedInputTokens: r.cachedInputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          requests: r.requests,
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

  /** Solicitudes (num_model_requests) por modelo. */
  readonly requestsByModel = computed<ChartDatum[]>(() =>
    this.modelDetail()
      .map((r) => ({ name: r.model, value: r.requests }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
  );

  // -----------------------
  // Costos
  // -----------------------

  // Los importes NO son sumables entre monedas: 10 USD + 10 EUR no es "20".
  // Toda agregación se hace sobre la moneda principal y el resto se informa aparte.
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

  /** Moneda con mayor importe; es la única que se grafica y se totaliza. */
  readonly primaryCurrency = computed<string>(() => this.currencyTotals()[0]?.currency ?? '—');

  /** Importes de las demás monedas, para poder avisar que hay más de una. */
  readonly otherCurrencies = computed(() => this.currencyTotals().slice(1));

  readonly rowsInPrimaryCurrency = computed<CostEntry[]>(() => {
    const currency = this.primaryCurrency();
    if (currency === '—' && this.currencyTotals().length === 0) return [];
    return this.costRows().filter((r) => (r.currency || '—') === currency);
  });

  readonly costTotals = computed(() => {
    let amount = 0;
    const days = new Set<string>();
    const projects = new Set<string>();

    for (const r of this.rowsInPrimaryCurrency()) {
      amount += r.amount;
      days.add(r.date);
      projects.add(r.projectId || '—');
    }

    const dayCount = days.size;
    return {
      amount,
      dayCount,
      projectCount: projects.size,
      avgPerDay: dayCount === 0 ? 0 : amount / dayCount,
      max: this.rowsInPrimaryCurrency().reduce((m, r) => Math.max(m, r.amount), 0),
    };
  });

  /** Una sola serie: el costo diario en la moneda principal. */
  readonly dailyCostSeries = computed(() => {
    const byDate = new Map<string, number>();
    for (const r of this.rowsInPrimaryCurrency()) {
      if (!r.date) continue;
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
    }
    const sorted = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
    return [
      {
        name: this.primaryCurrency(),
        series: sorted.map((date) => ({ name: date, value: byDate.get(date) ?? 0 })),
      },
    ];
  });

  readonly hasCostTimelineData = computed<boolean>(
    () => this.dailyCostSeries()[0].series.length > 0,
  );

  /**
   * Agrupa por line_item en toda la moneda principal. `quantity` se muestra solo si
   * todas las filas del concepto comparten la misma unidad: OpenAI mezcla tokens,
   * requests, imágenes, etc., y sumar eso no significa nada.
   */
  readonly lineItemDetail = computed<LineItemDetailRow[]>(() => {
    const byItem = new Map<string, LineItemDetailRow & { units: Set<string>; mixed: boolean }>();

    for (const r of this.rowsInPrimaryCurrency()) {
      const key = r.lineItem || '—';
      const unit = r.quantityUnit || '';
      const current = byItem.get(key);
      if (current) {
        current.amount += r.amount;
        current.quantity = (current.quantity ?? 0) + r.quantity;
        current.units.add(unit);
        if (current.units.size > 1) {
          // Unidades incompatibles: se deja de exponer una cantidad engañosa.
          current.mixed = true;
          current.quantity = null;
          current.quantityUnit = '';
        }
      } else {
        byItem.set(key, {
          lineItem: key,
          amount: r.amount,
          quantity: r.quantity,
          quantityUnit: unit,
          units: new Set([unit]),
          mixed: false,
        });
      }
    }

    return [...byItem.values()]
      .map(({ units: _units, mixed: _mixed, ...row }) => row)
      .sort((a, b) => b.amount - a.amount || a.lineItem.localeCompare(b.lineItem));
  });

  readonly byLineItem = computed<ChartDatum[]>(() =>
    this.lineItemDetail().map((r) => ({ name: r.lineItem, value: r.amount })),
  );

  // -----------------------
  // Detalle diario (tokens + costo)
  // -----------------------

  /** Costo diario (moneda principal) indexado por fecha, sin importar el proyecto. */
  private costByDate = computed(() => {
    const byDate = new Map<string, number>();
    for (const r of this.rowsInPrimaryCurrency()) {
      if (!r.date) continue;
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
    }
    return byDate;
  });

  /**
   * Detalle diario: una fila por cada día CON consumo de tokens, con el costo total
   * de ese día (0 si no hubo costo). La base es el consumo (no la unión con los días
   * que solo tienen costo) y se ordena por fecha descendente (lo más reciente arriba).
   */
  readonly dailyDetail = computed<DayDetailRow[]>(() => {
    const cost = this.costByDate();
    const byDate = new Map<string, DayDetailRow>();

    for (const r of this.usageRows()) {
      if (!r.date) continue;
      const current = byDate.get(r.date);
      if (current) {
        current.inputTokens += r.inputTokens;
        current.outputTokens += r.outputTokens;
        current.totalTokens += r.totalTokens;
        current.requests += r.requests;
      } else {
        byDate.set(r.date, {
          date: r.date,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          requests: r.requests,
          cost: 0,
        });
      }
    }

    return [...byDate.values()]
      .map((row) => ({ ...row, cost: cost.get(row.date) ?? 0 }))
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  // -----------------------
  // Detalle por proyecto
  // -----------------------

  /** Costo (moneda principal) indexado por proyecto. */
  private costByProject = computed(() => {
    const byProject = new Map<string, number>();
    for (const r of this.rowsInPrimaryCurrency()) {
      const key = r.projectId || '—';
      byProject.set(key, (byProject.get(key) ?? 0) + r.amount);
    }
    return byProject;
  });

  /**
   * Detalle por proyecto: consolida tokens y costo por project_id. Se incluye la
   * unión de proyectos presentes en consumo o en costo (un proyecto puede gastar sin
   * tener completions, p. ej. imágenes) y se ordena por total de tokens descendente.
   */
  readonly projectDetail = computed<ProjectDetailRow[]>(() => {
    const cost = this.costByProject();
    const byProject = new Map<string, ProjectDetailRow>();

    for (const r of this.usageRows()) {
      const key = r.projectId || '—';
      const current = byProject.get(key);
      if (current) {
        current.inputTokens += r.inputTokens;
        current.outputTokens += r.outputTokens;
        current.totalTokens += r.totalTokens;
        current.requests += r.requests;
      } else {
        byProject.set(key, {
          project: key,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          requests: r.requests,
          cost: 0,
        });
      }
    }

    for (const key of cost.keys()) {
      if (!byProject.has(key)) {
        byProject.set(key, {
          project: key,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requests: 0,
          cost: 0,
        });
      }
    }

    return [...byProject.values()]
      .map((row) => ({ ...row, cost: cost.get(row.project) ?? 0 }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.project.localeCompare(b.project));
  });

  /**
   * Mapa projectId → nombre del cliente, para rotular los gráficos con el nombre real en
   * vez del id de OpenAI. Se construye con todos los clientes cargados (activos o no): un
   * proyecto histórico de un cliente inactivo igual debe mostrar su nombre. Si un proyecto
   * no corresponde a ningún cliente (o el usuario no pudo listarlos) se conserva el id.
   */
  private readonly projectNameById = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const client of this.clients()) {
      const projectId = client.projectId.trim();
      if (projectId && !map.has(projectId)) {
        map.set(projectId, client.name.trim() || projectId);
      }
    }
    return map;
  });

  /** Nombre del cliente dueño del proyecto, o el propio projectId si no se conoce. */
  projectLabel(project: string): string {
    return this.projectNameById().get(project) ?? project;
  }

  readonly byProjectTokens = computed<ChartDatum[]>(() =>
    this.projectDetail()
      .map((r) => ({ name: this.projectLabel(r.project), value: r.totalTokens }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
  );

  readonly byProjectCost = computed<ChartDatum[]>(() =>
    this.projectDetail()
      .map((r) => ({ name: this.projectLabel(r.project), value: r.cost }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
  );

  // -----------------------
  // Filas visibles (tope + Ver más)
  // -----------------------

  readonly dailyRows = computed<DayDetailRow[]>(() =>
    this.dailyDetail().slice(0, this.dailyLimit()),
  );
  readonly hasMoreDaily = computed<boolean>(
    () => this.dailyDetail().length > this.dailyRows().length,
  );

  readonly projectRows = computed<ProjectDetailRow[]>(() =>
    this.projectDetail().slice(0, this.projectLimit()),
  );
  readonly hasMoreProjects = computed<boolean>(
    () => this.projectDetail().length > this.projectRows().length,
  );

  readonly modelRows = computed<ModelDetailRow[]>(() =>
    this.modelDetail().slice(0, this.modelLimit()),
  );
  readonly hasMoreModels = computed<boolean>(
    () => this.modelDetail().length > this.modelRows().length,
  );

  readonly lineItemRows = computed<LineItemDetailRow[]>(() =>
    this.lineItemDetail().slice(0, this.lineItemLimit()),
  );
  readonly hasMoreLineItems = computed<boolean>(
    () => this.lineItemDetail().length > this.lineItemRows().length,
  );

  showMoreDaily(): void {
    this.dailyLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  showMoreProjects(): void {
    this.projectLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  showMoreModels(): void {
    this.modelLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  showMoreLineItems(): void {
    this.lineItemLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  refresh(): void {
    this.load(true);
  }

  // -----------------------
  // Formato
  // -----------------------

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

  // -----------------------
  // Colores
  // -----------------------

  private schemeFor(size: number): Color {
    const count = Math.max(size, 1);
    return {
      name: 'veimen-web',
      selectable: true,
      group: ScaleType.Ordinal,
      domain: Array.from({ length: count }, (_, i) => BASE_PALETTE[i % BASE_PALETTE.length]),
    };
  }

  /** La línea de consumo tiene exactamente 2 series, así que su dominio es fijo. */
  readonly usageSeriesScheme: Color = {
    name: 'veimen-web-usage',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#2196F3', '#F44336'],
  };

  /** La línea de costo tiene una sola serie, así que su dominio es fijo. */
  readonly costSeriesScheme: Color = {
    name: 'veimen-web-cost',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#2196F3'],
  };

  // Leyenda propia en HTML en vez de la de ngx-charts: con legendPosition=Below
  // la librería no descuenta el alto de la leyenda del SVG. Se deriva de
  // usageSeriesScheme para que el color de cada muestra sea el de su línea.
  readonly legendItems = computed(() => {
    const domain = this.usageSeriesScheme.domain ?? [];
    return this.dailyUsageSeries().map((series, i) => ({
      name: series.name,
      color: domain[i % Math.max(domain.length, 1)] ?? '#6b7280',
    }));
  });

  readonly modelScheme = computed<Color>(() => this.schemeFor(this.byModel().length));
  readonly requestScheme = computed<Color>(() => this.schemeFor(this.requestsByModel().length));
  readonly lineItemScheme = computed<Color>(() => this.schemeFor(this.byLineItem().length));
  readonly projectTokenScheme = computed<Color>(() =>
    this.schemeFor(this.byProjectTokens().length),
  );
  readonly projectCostScheme = computed<Color>(() => this.schemeFor(this.byProjectCost().length));
}
