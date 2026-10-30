import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { ClientContextService } from '../services/client-context.service';
import { MailService, type MailComparison } from '../services/mail.service';

interface ChartSeries {
  name: string;
  series: { name: string; value: number }[];
}

interface BarGroup {
  name: string;
  series: { name: string; value: number }[];
}

const DEFAULT_RANGE_DAYS = 30;
const TABLE_PAGE_SIZE = 50;
const Y_TICK_COUNT = 5;

// Ticks enteros "bonitos" para el eje Y ([0..top] con paso 1/2/5×10ⁿ). Se fijan
// de forma explícita para romper el bucle de medición de ngx-charts (#349 "Chart
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
  selector: 'app-processing-dashboard',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './processing-dashboard.component.html',
  styleUrl: './processing-dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProcessingDashboardComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly rows = signal<MailComparison[]>([]);
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly tableLimit = signal(TABLE_PAGE_SIZE);

  private inFlight = false;
  // La carga inicial la hace ngOnInit; el primer disparo del effect del cliente no recarga.
  private isFirstClientEffect = true;

  private readonly mailService = inject(MailService);
  private readonly clientContext = inject(ClientContextService);

  /**
   * Filtro por cliente: el del usuario asociado si lo tiene (claim `client_id`), si no
   * el elegido en el filtro global del menú. `undefined` = "Todos" (sin filtro).
   * El backend además fuerza el cliente asociado, así que un usuario con cliente
   * nunca puede consultar otro.
   */
  readonly clientId = computed<number | undefined>(
    () => this.clientContext.effectiveClientId() ?? undefined,
  );

  constructor() {
    // Recarga al cambiar el cliente (menú o carga del cliente asociado). `untracked`
    // evita que el efecto se dispare por las señales que lee load() (fechas, errores, ...).
    effect(() => {
      this.clientId();
      untracked(() => {
        if (this.isFirstClientEffect) {
          this.isFirstClientEffect = false;
          return;
        }
        this.load(true);
      });
    });
  }

  readonly scheme: Color = {
    name: 'veimen-web-processing',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#3d7dd8', '#2bb8a3'],
  };

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

    this.mailService
      .getComparison({
        startDate: this.startDate() ?? undefined,
        endDate: this.endDate() ?? undefined,
        clientId: this.clientId(),
      })
      .subscribe({
        next: (data) => {
          this.rows.set(data);
          this.tableLimit.set(TABLE_PAGE_SIZE);
          this.lastUpdated.set(new Date());
        },
        error: () => {
          this.error.set(
            'No se pudo cargar la comparativa de procesamiento. Verifica tu sesión e inténtalo de nuevo.',
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
    let mails = 0;
    let requests = 0;
    const mailDays = new Set<string>();
    const requestDays = new Set<string>();

    for (const row of this.rows()) {
      mails += row.mails;
      requests += row.requests;
      if (row.mails > 0) mailDays.add(row.date);
      if (row.requests > 0) requestDays.add(row.date);
    }

    return {
      mails,
      requests,
      balance: requests - mails,
      // Sin correos no hay base para calcular la conversión: se muestra "—".
      conversion: mails === 0 ? null : (requests / mails) * 100,
      mailDays: mailDays.size,
      requestDays: requestDays.size,
    };
  });

  /** Dos series (Correos / Requerimientos) para la línea de evolución diaria. */
  readonly timelineSeries = computed<ChartSeries[]>(() => {
    const sorted = [...this.rows()].sort((a, b) => a.date.localeCompare(b.date));
    return [
      {
        name: 'Correos',
        series: sorted.map((row) => ({ name: row.date, value: row.mails })),
      },
      {
        name: 'Requerimientos',
        series: sorted.map((row) => ({ name: row.date, value: row.requests })),
      },
    ];
  });

  readonly hasTimelineData = computed<boolean>(() => this.timelineSeries()[0].series.length > 0);

  readonly timelineTicks = computed(() => {
    const dates = this.timelineSeries()[0].series.map((point) => point.name);
    const step = Math.max(1, Math.ceil(dates.length / 8));
    return dates.filter((_, i) => i % step === 0);
  });

  /**
   * ngx-charts-bar-vertical-2d espera los grupos al revés que la línea: cada
   * elemento es una categoría del eje X y su `series` son las dos métricas.
   */
  readonly barGroups = computed<BarGroup[]>(() => {
    const sorted = [...this.rows()].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((row) => ({
      name: row.date,
      series: [
        { name: 'Correos', value: row.mails },
        { name: 'Requerimientos', value: row.requests },
      ],
    }));
  });

  // Set de ticks fijo para el eje Y del gráfico de barras (ver niceIntegerTicks).
  readonly barYTicks = computed<number[]>(() => {
    const max = Math.max(0, ...this.rows().flatMap((row) => [row.mails, row.requests]));
    return niceIntegerTicks(max);
  });

  /**
   * Techo del eje Y = tick más alto de `barYTicks()`. Sin fijarlo, cuando el máximo
   * real no es múltiplo del paso (p. ej. 7 con ticks 0..8) el tick 8 queda fuera del
   * dominio, ngx-charts lo dibuja por encima del área de trazado y, como el SVG usa
   * `overflow: visible`, se solapa con el título de la tarjeta.
   */
  readonly barScaleMax = computed<number>(() => {
    const ticks = this.barYTicks();
    return ticks[ticks.length - 1] ?? 0;
  });

  readonly legendItems = computed(() => {
    const domain = this.scheme.domain ?? [];
    return this.timelineSeries().map((series, i) => ({
      name: series.name,
      color: domain[i % Math.max(domain.length, 1)] ?? '#8ba1b4',
    }));
  });

  // El detalle se muestra con la fecha más reciente primero.
  readonly dailyDetail = computed<MailComparison[]>(() =>
    [...this.rows()].sort((a, b) => b.date.localeCompare(a.date)),
  );

  readonly detailRows = computed<MailComparison[]>(() =>
    this.dailyDetail().slice(0, this.tableLimit()),
  );

  readonly hasMoreRows = computed<boolean>(
    () => this.dailyDetail().length > this.detailRows().length,
  );

  showMore(): void {
    this.tableLimit.update((n) => n + TABLE_PAGE_SIZE);
  }

  refresh(): void {
    this.load(true);
  }

  /** Conversión de una fila: requerimientos / correos. null cuando no hay correos. */
  conversionFor(row: MailComparison): number | null {
    return row.mails === 0 ? null : (row.requests / row.mails) * 100;
  }

  formatNumber(value: number): string {
    return value.toLocaleString('es');
  }

  /** Balance con signo explícito cuando es positivo (+2). */
  formatBalance(value: number): string {
    const formatted = this.formatNumber(value);
    return value > 0 ? `+${formatted}` : formatted;
  }

  formatConversion(value: number | null): string {
    if (value === null) return '—';
    return `${value.toLocaleString('es', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} %`;
  }

  /** Eje Y de ngx-charts: siempre entero. */
  formatYAxis(value: number): string {
    return String(Math.round(value));
  }

  /** Eje X de la línea/barras: "2026-10-20" → "20/10". */
  formatXAxis(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value;
  }

  /** Tabla: "2026-10-20" → "20/10/2026". */
  formatDate(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
