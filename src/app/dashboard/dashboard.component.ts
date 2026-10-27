import {
  Component,
  OnInit,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { ChartViewDirective } from './chart-view.directive';
import { DashboardService, StatusCount } from '../services/dashboard.service';
import { ClientContextService } from '../services/client-context.service';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';

interface ChartDatum {
  name: string;
  value: number;
}

interface DailyDetailRow {
  date: string;
  total: number;
}

const HIDDEN_STATUSES_KEY = 'veimen-web.hiddenStatuses';
const DEFAULT_RANGE_DAYS = 30;
const Y_TICK_COUNT = 5;
const TABLE_PAGE_SIZE = 50;

// Ticks enteros "bonitos" para el eje Y ([0..top] con paso 1/2/5×10ⁿ). Se fijan de
// forma explícita para romper el bucle de medición de ngx-charts (#349 "Chart
// Flickering"): el ángulo de los labels del eje X depende del ancho del plot; sin
// ticks fijos, el eje Y deriva su cantidad de ticks del alto del plot
// (floor(height/50)), lo que cambia el ancho del eje Y, realimenta el ángulo y
// hace "temblar" los labels sin converger. Con un set de ticks estable el ancho
// del eje Y (y por tanto el del plot) queda constante y el ángulo se elige una vez.
function niceIntegerTicks(max: number, targetCount = Y_TICK_COUNT): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const roughStep = max / targetCount;
  const mag = 10 ** Math.floor(Math.log10(roughStep));
  const norm = roughStep / mag;
  const step = Math.max(1, (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly statusCounts = signal<StatusCount[]>([]);
  readonly hiddenStatuses = signal<Set<string>>(this.loadPersistedHidden());
  readonly disabledStatuses = signal<Set<string>>(new Set());
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly tableLimit = signal(TABLE_PAGE_SIZE);

  private readonly colorScheme: Color = {
    name: 'veimen-web',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#3d7dd8', '#d95f5a', '#2bb8a3', '#d99a2b', '#8b7bc7'],
  };

  private inFlight = false;
  // La carga inicial la hace ngOnInit; el primer disparo del effect del cliente no recarga.
  private isFirstClientEffect = true;

  // El filtro de cliente es global (cabecera del menú). "Todos" (null) no filtra.
  readonly clientId = computed<number | undefined>(
    () => this.clientContext.selectedClient()?.clientId,
  );

  constructor(
    private dashboardService: DashboardService,
    private clientContext: ClientContextService,
  ) {
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

    this.dashboardService
      .getStatusByStatus({
        startDate: this.startDate() ?? undefined,
        endDate: this.endDate() ?? undefined,
        clientId: this.clientId(),
      })
      .subscribe({
        next: (data) => {
          this.applyFreshStatuses(data);
          this.statusCounts.set(data);
          this.tableLimit.set(TABLE_PAGE_SIZE);
          this.lastUpdated.set(new Date());
        },
        error: () => {
          this.error.set('No se pudieron cargar los datos. Verifica la conexión con el webhook.');
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

  private applyFreshStatuses(counts: StatusCount[]): void {
    const fresh = new Set(counts.map((c) => c.status));

    this.hiddenStatuses.update((hidden) => {
      const next = new Set<string>();
      for (const h of hidden) {
        if (fresh.has(h)) next.add(h);
      }
      return next;
    });
    this.persistHidden(this.hiddenStatuses());

    this.disabledStatuses.set(fresh);
  }

  private loadPersistedHidden(): Set<string> {
    try {
      const raw = localStorage.getItem(HIDDEN_STATUSES_KEY);
      if (!raw) return new Set();
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((s) => typeof s === 'string'));
      }
    } catch {
      /* ignore storage errors */
    }
    return new Set();
  }

  private persistHidden(hidden: Set<string>): void {
    try {
      localStorage.setItem(HIDDEN_STATUSES_KEY, JSON.stringify([...hidden]));
    } catch {
      /* ignore storage errors */
    }
  }

  visibleCounts(): StatusCount[] {
    return this.statusCounts().filter((c) => !this.hiddenStatuses().has(c.status));
  }

  visibleByStatus(): StatusCount[] {
    const byStatus = new Map<string, number>();
    for (const c of this.visibleCounts()) {
      byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + c.total);
    }
    return [...byStatus.entries()].map(([status, total]) => ({
      status,
      date: '',
      total,
    }));
  }
  readonly barData = computed<ChartDatum[]>(() =>
    this.visibleByStatus().map((d) => ({ name: d.status, value: d.total })),
  );

  readonly pieData = computed<ChartDatum[]>(() =>
    this.visibleByStatus().map((d) => ({ name: d.status, value: d.total })),
  );

  // Set de ticks fijo para el eje Y del gráfico de barras (ver niceIntegerTicks).
  readonly barYTicks = computed<number[]>(() =>
    niceIntegerTicks(Math.max(0, ...this.barData().map((d) => d.value))),
  );

  readonly total = computed<number>(() =>
    this.visibleByStatus().reduce((sum, d) => sum + d.total, 0),
  );

  readonly receivedTotal = computed<number>(() =>
    this.statusCounts().reduce((sum, c) => sum + c.total, 0),
  );

  readonly closedTotal = computed<number>(() =>
    this.statusCounts()
      .filter((c) => c.status === 'Cerrado')
      .reduce((sum, c) => sum + c.total, 0),
  );

  readonly closedPercentage = computed<number>(() =>
    this.receivedTotal() === 0 ? 0 : (this.closedTotal() / this.receivedTotal()) * 100,
  );

  readonly filterChips = computed(() => {
    const byStatus = new Map<string, number>();
    for (const c of this.statusCounts()) {
      byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + c.total);
    }
    return [...byStatus.entries()].map(([status, total]) => ({
      status,
      total,
      hidden: this.hiddenStatuses().has(status),
    }));
  });

  readonly timelineSeries = computed(() => {
    const byDate = new Map<string, number>();
    for (const c of this.visibleCounts()) {
      if (!c.date) continue;
      byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.total);
    }
    const series = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ name: date, value }));
    return [{ name: 'Total', series }];
  });

  readonly timelineTicks = computed(() => {
    const dates = this.timelineSeries()[0].series.map((s) => s.name);
    const step = Math.max(1, Math.ceil(dates.length / 8));
    return dates.filter((_, i) => i % step === 0);
  });

  // Detalle diario bajo los gráficos: misma agregación que la línea de tiempo
  // (respeta los estados ocultos), ordenada por fecha descendente.
  readonly dailyDetail = computed<DailyDetailRow[]>(() => {
    const byDate = new Map<string, number>();
    for (const c of this.visibleCounts()) {
      if (!c.date) continue;
      byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.total);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, total]) => ({ date, total }));
  });

  readonly detailRows = computed<DailyDetailRow[]>(() =>
    this.dailyDetail().slice(0, this.tableLimit()),
  );

  readonly hasMoreRows = computed<boolean>(
    () => this.dailyDetail().length > this.detailRows().length,
  );

  showMore(): void {
    this.tableLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  hasHiddenFilters(): boolean {
    return this.hiddenStatuses().size > 0;
  }

  toggleStatus(status: string): void {
    this.hiddenStatuses.update((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
    this.persistHidden(this.hiddenStatuses());
  }

  resetFilters(): void {
    this.hiddenStatuses.set(new Set());
    this.persistHidden(new Set());
  }

  refresh(): void {
    this.load(true);
  }

  formatNumber(value: number): string {
    return value.toLocaleString('es');
  }

  formatXAxis(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
  }

  formatDate(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  formatYAxis(value: number): string {
    return String(Math.round(value));
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  get scheme(): Readonly<Color> {
    return this.colorScheme;
  }
}
