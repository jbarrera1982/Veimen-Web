import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { UsageService, type CompletionUsage } from '../services/usage.service';

interface ChartDatum {
  name: string;
  value: number;
}

// Fila del detalle: totales de un modelo en todo el rango seleccionado.
interface ModelDetailRow {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
}

const DEFAULT_RANGE_DAYS = 30;
// Tope de filas visibles en la tabla de detalle: un rango de 30 días puede traer
// muchas combinaciones día × modelo × proyecto × api_key y no queremos inflar el DOM.
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

// Consumo de completions reportado por la organización de OpenAI
// (GET /api/usage/completions). Mismo esqueleto de filtros/KPIs/gráficos que el
// dashboard de tokens, pero la fuente es OpenAI y no la traza de los requerimientos.
@Component({
  selector: 'app-consumo-dashboard',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './consumo-dashboard.html',
  styleUrl: './usage-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsumoDashboardComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly rows = signal<CompletionUsage[]>([]);
  readonly startDate = signal<string>('');
  readonly endDate = signal<string>('');
  readonly tableLimit = signal(TABLE_PAGE_SIZE);

  private inFlight = false;

  constructor(private usageService: UsageService) {}

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
    // start_date es obligatorio en este endpoint (lo exige la API de OpenAI), así
    // que sin "desde" no se dispara la petición para no comerse un 400.
    if (!this.startDate()) return;
    this.inFlight = true;

    if (auto) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.error.set(null);

    this.usageService
      .getCompletionsUsage({
        startDate: this.startDate(),
        endDate: this.endDate() || undefined,
      })
      .subscribe({
        next: (data) => {
          this.rows.set(data);
          this.tableLimit.set(TABLE_PAGE_SIZE);
          this.lastUpdated.set(new Date());
        },
        error: () => {
          this.error.set(
            'No se pudo cargar el consumo de OpenAI. Verifica tu sesión e inténtalo de nuevo.',
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
    let cached = 0;
    let output = 0;
    let total = 0;
    let requests = 0;
    const days = new Set<string>();

    for (const r of this.rows()) {
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
        name: 'Entrada',
        series: sorted.map((date) => ({ name: date, value: input.get(date) ?? 0 })),
      },
      {
        name: 'Salida',
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

  /**
   * El detalle agrupa por modelo en todo el rango: OpenAI devuelve una fila por
   * día × modelo × proyecto × api_key × usuario, así que hay que sumar todas las
   * combinaciones del mismo modelo. Las filas sin modelo caen en '—'.
   */
  readonly modelDetail = computed<ModelDetailRow[]>(() => {
    const byModel = new Map<string, ModelDetailRow>();

    for (const r of this.rows()) {
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
    domain: ['#2196F3', '#F44336'],
  };

  // Leyenda propia en HTML en vez de la de ngx-charts: con legendPosition=Below
  // la librería no descuenta el alto de la leyenda del SVG (el SVG mide view[1]
  // completo y la leyenda se desborda sobre la tarjeta siguiente). Se deriva de
  // seriesScheme para que el color de cada muestra sea el de su línea.
  readonly legendItems = computed(() => {
    const domain = this.seriesScheme.domain ?? [];
    return this.timelineSeries().map((series, i) => ({
      name: series.name,
      color: domain[i % Math.max(domain.length, 1)] ?? '#6b7280',
    }));
  });

  readonly modelScheme = computed<Color>(() => this.schemeFor(this.byModel().length));

  readonly requestScheme = computed<Color>(() => this.schemeFor(this.requestsByModel().length));
}
