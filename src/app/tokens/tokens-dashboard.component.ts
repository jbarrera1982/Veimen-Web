import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { TokensService, type TokenUsage } from '../services/tokens.service';

interface ChartDatum {
  name: string;
  value: number;
}

const DEFAULT_RANGE_DAYS = 30;
// Tope de filas visibles en la tabla de detalle: un rango de 30 días puede traer
// cientos de combinaciones día × nodo y no queremos inflar el DOM.
const TABLE_PAGE_SIZE = 50;

// Paleta base; se extiende cíclicamente para cubrir la cantidad de nodos
// presentes. Con un dominio fijo de 5 colores, ngx-charts recicla tonos cuando
// hay más categorías y las barras quedan ambiguas.
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
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly tableLimit = signal(TABLE_PAGE_SIZE);

  private inFlight = false;

  constructor(private tokensService: TokensService) {}

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

    this.tokensService
      .getTokenUsage({
        startDate: this.startDate() ?? undefined,
        endDate: this.endDate() ?? undefined,
      })
      .subscribe({
        next: (data) => {
          this.rows.set(data);
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

  /** Totales por modelo LLM (llm_model); las trazas sin modelo caen en '—'. */
  readonly byModel = computed<ChartDatum[]>(() => {
    const totals = new Map<string, number>();
    for (const r of this.rows()) {
      const key = r.llmModel || '—';
      totals.set(key, (totals.get(key) ?? 0) + r.totalTokens);
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  });

  // La API agrupa por día × node × llm_model: un mismo nodo puede llegar
  // repetido el mismo día con distintos modelos, así que la tabla (que muestra
  // día × nodo) re-agrupa para no mostrar filas indistinguibles entre sí.
  readonly sortedDetail = computed<TokenUsage[]>(() => {
    const byDateNode = new Map<string, TokenUsage>();

    for (const r of this.rows()) {
      const key = `${r.date}|${r.node}`;
      const current = byDateNode.get(key);
      if (current) {
        current.inputTokens += r.inputTokens;
        current.outputTokens += r.outputTokens;
        current.totalTokens += r.totalTokens;
      } else {
        byDateNode.set(key, { ...r });
      }
    }

    return [...byDateNode.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || b.totalTokens - a.totalTokens,
    );
  });

  readonly detailRows = computed<TokenUsage[]>(() =>
    this.sortedDetail().slice(0, this.tableLimit()),
  );

  readonly hasMoreRows = computed<boolean>(
    () => this.sortedDetail().length > this.detailRows().length,
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

  readonly nodeScheme = computed<Color>(() => this.schemeFor(this.byNode().length));

  readonly modelScheme = computed<Color>(() => this.schemeFor(this.byModel().length));
}
