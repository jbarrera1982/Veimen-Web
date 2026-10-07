import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import type { Color } from '@swimlane/ngx-charts';
import { ScaleType } from '@swimlane/ngx-charts';
import { ChartViewDirective } from '../dashboard/chart-view.directive';
import { UsageService, type CostEntry } from '../services/usage.service';

interface ChartDatum {
  name: string;
  value: number;
}

// Fila del detalle: totales de un line_item en toda la moneda indicada.
interface LineItemDetailRow {
  lineItem: string;
  amount: number;
  quantity: number | null;
  quantityUnit: string;
}

const DEFAULT_RANGE_DAYS = 30;
const TABLE_PAGE_SIZE = 50;

// Paleta base; se extiende cíclicamente para cubrir la cantidad de conceptos.
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

// Costos reportados por la organización de OpenAI (GET /api/usage/costs).
@Component({
  selector: 'app-costos-dashboard',
  standalone: true,
  imports: [CommonModule, NgxChartsModule, ChartViewDirective],
  templateUrl: './costos-dashboard.html',
  styleUrl: './usage-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostosDashboardComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly rows = signal<CostEntry[]>([]);
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
      .getCosts({
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
            'No se pudieron cargar los costos de OpenAI. Verifica tu sesión e inténtalo de nuevo.',
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

  // Los importes NO son sumables entre monedas: 10 USD + 10 EUR no es "20".
  // Toda agregación se hace sobre la moneda principal y el resto se informa aparte.
  private currencyTotals = computed(() => {
    const byCurrency = new Map<string, { amount: number; dayCount: Set<string> }>();
    for (const r of this.rows()) {
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
    return this.rows().filter((r) => (r.currency || '—') === currency);
  });

  readonly totals = computed(() => {
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
      avgPerDay: dayCount === 0 ? 0 : amount / dayCount,
      max: this.rowsInPrimaryCurrency().reduce((m, r) => Math.max(m, r.amount), 0),
    };
  });

  /** Una sola serie: el costo diario en la moneda principal. */
  readonly timelineSeries = computed(() => {
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

  readonly hasTimelineData = computed<boolean>(() => this.timelineSeries()[0].series.length > 0);

  readonly timelineTicks = computed(() => {
    const dates = this.timelineSeries()[0].series.map((s) => s.name);
    const step = Math.max(1, Math.ceil(dates.length / 8));
    return dates.filter((_, i) => i % step === 0);
  });

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

  readonly detailRows = computed<LineItemDetailRow[]>(() =>
    this.lineItemDetail().slice(0, this.tableLimit()),
  );

  readonly hasMoreRows = computed<boolean>(
    () => this.lineItemDetail().length > this.detailRows().length,
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
      maximumFractionDigits: 2,
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

  /** Una sola serie, así que el dominio es fijo. */
  readonly seriesScheme: Color = {
    name: 'veimen-web-series',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#2196F3'],
  };

  readonly lineItemScheme = computed<Color>(() => this.schemeFor(this.byLineItem().length));
}
