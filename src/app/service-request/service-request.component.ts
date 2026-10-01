import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  computed,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs/operators';
import { RequestsService, RequestItem, TraceStep } from '../services/requests.service';
import { STATUS_LABELS } from '../services/dashboard.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-service-request',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective],
  templateUrl: './service-request.html',
  styleUrl: './service-request.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceRequestComponent implements OnInit, OnDestroy {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly requests = signal<RequestItem[]>([]);
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly search = signal<string>('');
  readonly selectedStatuses = signal<Set<string>>(new Set());
  readonly statusDropdownOpen = signal(false);

  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly totalCount = signal(0);
  readonly totalPages = signal(0);
  readonly hasPrevPage = computed(() => this.page() > 1);
  readonly hasNextPage = computed(() => this.totalPages() > 0 && this.page() < this.totalPages());

  readonly statusOptions = computed<string[]>(() => {
    const known = Object.values(STATUS_LABELS);
    const seen = new Set(known);
    const extra: string[] = [];
    for (const r of this.requests()) {
      if (!seen.has(r.status)) {
        seen.add(r.status);
        extra.push(r.status);
      }
    }
    return [...known, ...extra];
  });

  readonly visibleRequests = computed<RequestItem[]>(() => {
    const selected = this.selectedStatuses();
    if (selected.size === 0) return this.requests();
    return this.requests().filter((r) => selected.has(r.status));
  });

  readonly statusButtonLabel = computed(() => {
    const size = this.selectedStatuses().size;
    return size === 0 ? 'Todas' : `${size} ${size === 1 ? 'estado' : 'estados'}`;
  });

  readonly selectedRequest = signal<RequestItem | null>(null);
  readonly traceSteps = signal<TraceStep[]>([]);
  readonly isLoadingTrace = signal(false);
  readonly traceError = signal<string | null>(null);

  // Solicitudes en proceso de auditoría (request_number) y notificación toast.
  readonly auditing = signal<Set<number>>(new Set());
  readonly toast = signal<{ message: string; type: 'success' | 'error' } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private inFlight = false;
  private traceInFlight = false;

  private readonly permissions = inject(PermissionsService);

  readonly PERMISSIONS = PERMISSIONS;

  // La sección de traza solo se muestra (y se pide al backend) con el permiso 'trace.read'.
  readonly canSeeTrace = computed(() => this.permissions.has(PERMISSIONS.traceRead));

  constructor(private requestsService: RequestsService) {}

  ngOnInit(): void {
    this.applyDefaultRange();
    this.load();
  }

  ngOnDestroy(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  private applyDefaultRange(): void {
    const today = new Date();
    this.startDate.set(toDateInputValue(today));
    this.endDate.set(toDateInputValue(today));
  }

  setStartDate(value: string): void {
    this.startDate.set(value || null);
  }

  setEndDate(value: string): void {
    this.endDate.set(value || null);
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  clearSearch(): void {
    this.search.set('');
    this.applyDateRange();
  }

  applyDateRange(): void {
    this.page.set(1);
    this.load(true);
  }

  goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), Math.max(1, this.totalPages()));
    if (target === this.page()) return;
    this.page.set(target);
    this.load(true);
  }

  nextPage(): void {
    if (this.hasNextPage()) {
      this.goToPage(this.page() + 1);
    }
  }

  prevPage(): void {
    if (this.hasPrevPage()) {
      this.goToPage(this.page() - 1);
    }
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

    this.requestsService
      .getRequestsList({
        startDate: this.startDate() ?? undefined,
        endDate: this.endDate() ?? undefined,
        statuses: this.selectedStatuses().size ? [...this.selectedStatuses()] : undefined,
        search: this.search().trim() || undefined,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.requests.set(result.items);
          this.totalCount.set(result.totalCount);
          this.totalPages.set(result.totalPages);
          this.page.set(result.page);
          this.lastUpdated.set(new Date());
        },
        error: () => {
          this.error.set('No se pudieron cargar los datos. Verifica la conexión con el servidor.');
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

  refresh(): void {
    this.load(true);
  }

  toggleStatusDropdown(): void {
    this.statusDropdownOpen.update((v) => !v);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.statusDropdownOpen.set(false);
  }

  isAllStatuses(): boolean {
    return this.selectedStatuses().size === 0;
  }

  toggleAllStatuses(): void {
    this.selectedStatuses.set(new Set());
  }

  toggleStatusOption(status: string): void {
    this.selectedStatuses.update((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  openDetail(item: RequestItem): void {
    this.selectedRequest.set(item);
    this.traceSteps.set([]);
    this.traceError.set(null);
    // Sin permiso de traza no se llama a la API: el modal abre sin la sección.
    if (this.canSeeTrace()) {
      this.loadTrace(item.requestNumber);
    }
  }

  closeDetail(): void {
    this.selectedRequest.set(null);
    this.traceSteps.set([]);
    this.traceError.set(null);
    this.isLoadingTrace.set(false);
    this.traceInFlight = false;
  }

  isAuditing(requestNumber: number): boolean {
    return this.auditing().has(requestNumber);
  }

  runAudit(requestNumber: number): void {
    if (this.isAuditing(requestNumber)) return;
    this.auditing.update((current) => new Set(current).add(requestNumber));
    this.requestsService
      .auditRequest(requestNumber)
      .pipe(
        finalize(() => {
          this.auditing.update((current) => {
            const next = new Set(current);
            next.delete(requestNumber);
            return next;
          });
        }),
      )
      .subscribe({
        next: () =>
          this.showToast(
            `Informe de auditoría solicitado para el requerimiento ${requestNumber}.`,
            'success',
          ),
        error: () =>
          this.showToast(
            `No se pudo generar el informe de auditoría del requerimiento ${requestNumber}.`,
            'error',
          ),
      });
  }

  private showToast(message: string, type: 'success' | 'error'): void {
    this.toast.set({ message, type });
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.statusDropdownOpen()) {
      this.statusDropdownOpen.set(false);
      return;
    }
    if (this.selectedRequest()) {
      this.closeDetail();
    }
  }

  private loadTrace(requestNumber: number): void {
    if (this.traceInFlight) return;
    this.traceInFlight = true;
    this.isLoadingTrace.set(true);
    this.traceError.set(null);

    this.requestsService.getRequestTrace(requestNumber).subscribe({
      next: (steps) => {
        // Orden por trace_id (orden de inserción en service_request_trace), no por
        // 'sequence': ese campo es el orden lógico dentro del flujo y puede repetirse
        // entre corridas, lo que dejaba pasos fuera de su orden real.
        this.traceSteps.set([...steps].sort((a, b) => a.traceId - b.traceId));
      },
      error: () => {
        this.traceError.set('No se pudo cargar el detalle del requerimiento.');
        this.isLoadingTrace.set(false);
        this.traceInFlight = false;
      },
      complete: () => {
        this.isLoadingTrace.set(false);
        this.traceInFlight = false;
      },
    });
  }

  formatDateTime(value: string): string {
    const [date, time] = value.replace('T', ' ').split(' ');
    if (!time) return date;
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y} ${time.slice(0, 8)}`;
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  formatNumber(value: number): string {
    return value.toLocaleString('es');
  }

  formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  formatConfidence(confidence: string | null): string {
    if (!confidence) return '—';
    const value = Number(confidence);
    if (Number.isNaN(value)) return confidence;
    return `${Math.round(value * 100)}%`;
  }

  formatJson(value: unknown): string {
    if (value == null || value === '') return '';
    let parsed: unknown = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        return this.prettifyText(value);
      }
    }
    return this.prettifyText(JSON.stringify(this.unwrapNestedJson(parsed), null, 2));
  }

  // Convierte strings que en realidad contienen JSON anidado en objetos/arrays reales,
  // para renderizarlos tabulados (una propiedad bajo la otra) y sin las \ de escape.
  // Se aplica recursivamente por si hay varios niveles de anidamiento.
  private unwrapNestedJson(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => this.unwrapNestedJson(item));
    }
    if (node !== null && typeof node === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        result[key] = this.unwrapNestedJson(child);
      }
      return result;
    }
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(node);
          if (parsed !== null && typeof parsed === 'object') {
            return this.unwrapNestedJson(parsed);
          }
        } catch {
          // No es JSON válido: se conserva el texto original.
        }
      }
    }
    return node;
  }

  // Solo para visualización: convierte los escapes \n, \r y \t (los saltos de línea
  // estructurales del pretty print ya son caracteres reales) en saltos de línea reales,
  // para que los textos largos del LLM se lean con sus saltos de línea.
  private prettifyText(text: string): string {
    return text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }

  openJsonView(step: TraceStep): void {
    const html = this.buildJsonTabHtml(step);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) {
      return; // Si el bloqueador de pop-ups lo impide, no hacemos nada más.
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private buildJsonTabHtml(step: TraceStep): string {
    const input = step.inputJson ? this.formatJson(step.inputJson) : 'Sin datos';
    const output = step.outputJson ? this.formatJson(step.outputJson) : 'Sin datos';
    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Entrada / Salida · ${this.escapeHtml(step.node)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        display: flex;
        flex-direction: row;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
        background: #111827;
        color: #e5e7eb;
      }
      .pane {
        flex: 1 1 50%;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-left: 1px solid #1f2937;
      }
      .pane:first-child { border-left: none; }
      .pane-header {
        flex: 0 0 auto;
        padding: 0.5rem 1rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #9ca3af;
        background: #1f2937;
      }
      pre {
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        padding: 1rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.8rem;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <section class="pane">
      <header class="pane-header">Entrada</header>
      <pre>${this.escapeHtml(input)}</pre>
    </section>
    <section class="pane">
      <header class="pane-header">Salida</header>
      <pre>${this.escapeHtml(output)}</pre>
    </section>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
