import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import {
  EmailEvaluationCaseListItem,
  EmailEvaluationDatasetService,
} from '../services/email-evaluation-dataset.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { ClientContextService } from '../services/client-context.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';
import { TranslationService } from '../i18n/translation.service';
import { EmailEvaluationResultComponent } from './evaluation-result.component';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

// El texto de búsqueda se recuerda entre visitas a la pantalla.
const SEARCH_STORAGE_KEY = 'veimen-web.emails.searchText';

function readStoredSearch(): string {
  try {
    return localStorage.getItem(SEARCH_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-email-evaluation-list',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective, EmailEvaluationResultComponent],
  templateUrl: './email-evaluation-list.component.html',
  styleUrl: './email-evaluation-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailEvaluationListComponent implements OnInit {
  private readonly i18n = inject(TranslationService);
  private readonly permissions = inject(PermissionsService);
  private readonly clientContext = inject(ClientContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datasetService = inject(EmailEvaluationDatasetService);
  private readonly router = inject(Router);

  readonly t = this.i18n.t;
  readonly PERMISSIONS = PERMISSIONS;
  readonly pageSize = PAGE_SIZE;

  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);

  readonly cases = signal<EmailEvaluationCaseListItem[]>([]);
  readonly totalCount = signal(0);
  readonly page = signal(1);

  readonly searchText = signal(readStoredSearch());
  readonly scenarioFilter = signal('all');
  readonly scenarios = signal<string[]>([]);

  readonly evaluationLabel = signal<string | null>(null);
  readonly evaluationResult = signal<unknown>(null);
  readonly evaluationError = signal<string | null>(null);
  readonly isEvaluating = signal(false);

  readonly selectedIds = signal<ReadonlySet<number>>(new Set());
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly allPageSelected = computed(
    () =>
      this.cases().length > 0 && this.cases().every((item) => this.selectedIds().has(item.id)),
  );
  readonly somePageSelected = computed(() => this.selectedCount() > 0 && !this.allPageSelected());

  readonly canWriteEmails = computed(() => this.permissions.has(PERMISSIONS.emailEvaluationWrite));

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  readonly pageInfo = computed(() => {
    const total = this.totalCount();
    if (total === 0) {
      return '';
    }
    const start = (this.page() - 1) * this.pageSize + 1;
    const end = Math.min(this.page() * this.pageSize, total);
    return this.t('emails.pageInfo', { start, end, total });
  });

  readonly hasActiveFilters = computed(
    () => this.searchText().trim().length > 0 || this.scenarioFilter() !== 'all',
  );

  // Cada carga lleva un número: una respuesta vieja (otro cliente o filtro) se descarta.
  private loadSeq = 0;
  private isFirstClientEffect = true;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Recarga al cambiar el cliente del menú (la API filtra por client_id).
    effect(() => {
      this.clientContext.effectiveClientId();
      untracked(() => {
        if (this.isFirstClientEffect) {
          this.isFirstClientEffect = false;
          return;
        }
        this.page.set(1);
        this.loadScenarios();
        this.loadCases(true);
      });
    });

    this.destroyRef.onDestroy(() => this.clearSearchTimer());
  }

  ngOnInit(): void {
    this.loadCases();
    this.loadScenarios();
  }

  loadCases(auto = false): void {
    const seq = ++this.loadSeq;

    if (auto) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.error.set(null);

    this.datasetService
      .getCases({
        clientId: this.clientContext.effectiveClientId(),
        scenario: this.scenarioFilter() === 'all' ? null : this.scenarioFilter(),
        search: this.searchText(),
        page: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (result) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.cases.set(result.items);
          this.totalCount.set(result.totalCount);
          // La selección es por página: al cambiar de página, filtro o búsqueda se limpia.
          this.selectedIds.set(new Set());
        },
        error: () => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.error.set(this.t('emails.loadError'));
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
        complete: () => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
      });
  }

  loadScenarios(): void {
    this.datasetService.getScenarios(this.clientContext.effectiveClientId()).subscribe({
      next: (scenarios) => this.scenarios.set(scenarios),
      error: () => this.scenarios.set([]),
    });
  }

  refresh(): void {
    this.loadCases(true);
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.persistSearch(value);
    this.page.set(1);

    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadCases(true);
    }, SEARCH_DEBOUNCE_MS);
  }

  onScenarioChange(event: Event): void {
    this.scenarioFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
    this.loadCases(true);
  }

  resetFilters(): void {
    this.clearSearchTimer();
    this.searchText.set('');
    this.scenarioFilter.set('all');
    this.page.set(1);
    this.persistSearch('');
    this.loadCases(true);
  }

  prevPage(): void {
    if (this.page() > 1) {
      this.page.update((current) => current - 1);
      this.loadCases(true);
    }
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) {
      this.page.update((current) => current + 1);
      this.loadCases(true);
    }
  }

  newCase(): void {
    void this.router.navigate(['/emails-evaluacion', 'nuevo']);
  }

  openCase(item: EmailEvaluationCaseListItem): void {
    if (!this.canWriteEmails()) {
      return;
    }
    void this.router.navigate(['/emails-evaluacion', item.id]);
  }

  // Abre el formulario de alta con el caso precargado (nuevo id autonumérico al guardar).
  duplicateCase(item: EmailEvaluationCaseListItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.canWriteEmails()) {
      return;
    }
    void this.router.navigate(['/emails-evaluacion', 'nuevo'], {
      state: { duplicateId: item.id },
    });
  }

  evaluate(item: EmailEvaluationCaseListItem, event?: Event): void {
    event?.stopPropagation();

    this.evaluationLabel.set(`#${item.id}`);
    this.evaluationResult.set(null);
    this.evaluationError.set(null);
    this.isEvaluating.set(true);

    this.datasetService.evaluateCase(item.id).subscribe({
      next: (result) => this.evaluationResult.set(result),
      error: (err: unknown) => this.evaluationError.set(this.extractError(err)),
      complete: () => this.isEvaluating.set(false),
    });
  }

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  toggleSelected(id: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  // Marca o desmarca solo los casos de la página visible.
  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.set(checked ? new Set(this.cases().map((item) => item.id)) : new Set());
  }

  // Evalúa todos los casos seleccionados en paralelo; un fallo no corta al resto.
  evaluateSelected(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0 || this.isEvaluating()) {
      return;
    }

    this.evaluationLabel.set(this.t('emails.selectedCount', { count: ids.length }));
    this.evaluationResult.set(null);
    this.evaluationError.set(null);
    this.isEvaluating.set(true);

    forkJoin(
      ids.map((id) =>
        this.datasetService.evaluateCase(id).pipe(
          map((result) => ({ id, result })),
          catchError((err: unknown) => of({ id, error: this.extractError(err) })),
        ),
      ),
    ).subscribe({
      next: (results) => this.evaluationResult.set(results),
      complete: () => this.isEvaluating.set(false),
    });
  }

  closeEvaluation(): void {
    this.evaluationLabel.set(null);
    this.evaluationResult.set(null);
    this.evaluationError.set(null);
    this.isEvaluating.set(false);
  }

  clientLabel(clientId: number): string {
    const client = this.clientContext.clients().find((item) => item.clientId === clientId);
    return client?.name?.trim() || this.t('common.clientNumber', { id: clientId });
  }

  removeCase(item: EmailEvaluationCaseListItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.canWriteEmails()) {
      return;
    }
    if (!window.confirm(this.t('emails.confirmDelete', { id: item.id }))) {
      return;
    }

    this.error.set(null);
    this.datasetService.deleteCase(item.id).subscribe({
      next: () => {
        // Si era la única fila de la página, se retrocede para no quedar en una vacía.
        if (this.cases().length === 1 && this.page() > 1) {
          this.page.update((current) => current - 1);
        }
        this.loadCases(true);
        this.loadScenarios();
      },
      error: () => this.error.set(this.t('emails.deleteError', { id: item.id })),
    });
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private persistSearch(value: string): void {
    try {
      if (value) {
        localStorage.setItem(SEARCH_STORAGE_KEY, value);
      } else {
        localStorage.removeItem(SEARCH_STORAGE_KEY);
      }
    } catch {
      // localStorage no disponible (p. ej. modo privado): la búsqueda sigue en memoria.
    }
  }

  private extractError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;

      if (typeof body === 'string' && body.trim()) {
        try {
          const parsed = JSON.parse(body) as { message?: unknown };
          if (typeof parsed.message === 'string' && parsed.message.trim()) {
            return parsed.message;
          }
        } catch {
          return body;
        }
      }

      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return message;
        }
      }

      if (err.status === 0) {
        return this.t('emails.evaluationConnectionError');
      }
      return this.t('emails.evaluationError');
    }

    return err instanceof Error && err.message ? err.message : this.t('emails.evaluationError');
  }
}
