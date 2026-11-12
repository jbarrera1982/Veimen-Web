import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PromptsService, Prompt } from '../services/prompts.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { ClientContextService } from '../services/client-context.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';
import { TranslationService } from '../i18n/translation.service';

type SortColumn =
  | 'promptId'
  | 'secuence'
  | 'code'
  | 'name'
  | 'description'
  | 'agentGroup'
  | 'type'
  | 'llmModel'
  | 'version';
type SortDirection = 'asc' | 'desc';

const NUMERIC_COLUMNS: ReadonlySet<SortColumn> = new Set(['promptId', 'secuence']);

const PAGE_SIZE = 10;

// El texto de búsqueda se recuerda entre visitas a la pantalla (se hidrata en ngOnInit).
const SEARCH_STORAGE_KEY = 'veimen-web.prompts.searchText';

function readStoredSearch(): string {
  try {
    return localStorage.getItem(SEARCH_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-prompts-list',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective],
  templateUrl: './prompts-list.html',
  styleUrl: './prompts-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptsListComponent implements OnInit {
  private readonly i18n = inject(TranslationService);
  readonly t = this.i18n.t;

  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly prompts = signal<Prompt[]>([]);

  readonly searchText = signal(readStoredSearch());
  readonly typeFilter = signal('all');
  readonly groupFilter = signal('all');
  readonly statusFilter = signal('active');
  readonly sortColumn = signal<SortColumn>('agentGroup');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly page = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly sortOptions = computed<{ value: SortColumn; label: string }[]>(() => [
    { value: 'promptId', label: 'ID' },
    { value: 'secuence', label: this.t('prompts.sequence') },
    { value: 'code', label: this.t('prompts.code') },
    { value: 'name', label: this.t('prompts.name') },
    { value: 'description', label: this.t('prompts.description') },
    { value: 'agentGroup', label: this.t('prompts.group') },
    { value: 'type', label: this.t('prompts.type') },
    { value: 'llmModel', label: this.t('prompts.model') },
    { value: 'version', label: this.t('prompts.version') },
  ]);

  readonly filteredPrompts = computed(() => {
    const term = this.searchText().trim().toLowerCase();
    const type = this.typeFilter();
    const group = this.groupFilter();
    const status = this.statusFilter();

    return this.prompts().filter((p) => {
      if (type !== 'all' && p.type !== type) return false;
      if (group !== 'all' && p.agentGroup !== group) return false;
      if (status === 'active' && !p.active) return false;
      if (status === 'inactive' && p.active) return false;
      if (term) {
        const haystack =
          `${p.code} ${p.name} ${p.description} ${p.agentGroup} ${p.type} ${p.llmModel} ${p.version}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  });

  readonly sortedPrompts = computed(() => {
    const column = this.sortColumn();
    const direction = this.sortDirection();
    const numeric = NUMERIC_COLUMNS.has(column);

    return [...this.filteredPrompts()].sort((a, b) => {
      let cmp = numeric
        ? Number(a[column]) - Number(b[column])
        : String(a[column]).localeCompare(String(b[column]));
      if (direction === 'desc') cmp = -cmp;
      if (cmp !== 0) return cmp;
      cmp = a.secuence - b.secuence;
      if (cmp !== 0) return cmp;
      cmp = Number(b.active) - Number(a.active);
      if (cmp !== 0) return cmp;
      return a.promptId - b.promptId;
    });
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.sortedPrompts().length / this.pageSize)),
  );

  readonly pagedPrompts = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.sortedPrompts().slice(start, start + this.pageSize);
  });

  readonly pageInfo = computed(() => {
    const total = this.sortedPrompts().length;
    if (total === 0) return '';
    const start = (this.page() - 1) * this.pageSize + 1;
    const end = Math.min(this.page() * this.pageSize, total);
    return this.t('prompts.pageInfo', { start, end, total });
  });

  readonly types = computed(() => [...new Set(this.prompts().map((p) => p.type))].sort());

  readonly groups = computed(() =>
    [...new Set(this.prompts().map((p) => p.agentGroup))].filter(Boolean).sort(),
  );

  readonly hasActiveFilters = computed(
    () =>
      this.searchText().trim().length > 0 ||
      this.typeFilter() !== 'all' ||
      this.groupFilter() !== 'all' ||
      this.statusFilter() !== 'active',
  );

  // Cada carga lleva un número: una respuesta vieja (otro cliente) se descarta.
  private loadSeq = 0;
  private isFirstClientEffect = true;

  private readonly permissions = inject(PermissionsService);
  private readonly clientContext = inject(ClientContextService);

  readonly PERMISSIONS = PERMISSIONS;

  readonly canWritePrompts = computed(() => this.permissions.has(PERMISSIONS.promptsWrite));

  constructor(
    private promptsService: PromptsService,
    private router: Router,
  ) {
    // Recarga al cambiar el cliente del menú (la API filtra por client_id). La carga inicial
    // la hace ngOnInit, así que el primer valor del efecto no cuenta.
    effect(() => {
      this.clientContext.effectiveClientId();
      untracked(() => {
        if (this.isFirstClientEffect) {
          this.isFirstClientEffect = false;
          return;
        }
        this.page.set(1);
        this.load(true);
      });
    });
  }

  ngOnInit(): void {
    this.load();
  }

  load(auto = false): void {
    const seq = ++this.loadSeq;

    if (auto) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.error.set(null);

    this.promptsService.getPrompts(this.clientContext.effectiveClientId()).subscribe({
      next: (data) => {
        if (seq === this.loadSeq) this.prompts.set(data);
      },
      error: () => {
        if (seq !== this.loadSeq) return;
        this.error.set(this.t('prompts.loadError'));
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      complete: () => {
        if (seq !== this.loadSeq) return;
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  refresh(): void {
    this.load(true);
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.persistSearch(value);
    this.page.set(1);
  }

  onTypeChange(event: Event): void {
    this.typeFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
  }

  onGroupChange(event: Event): void {
    this.groupFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
  }

  onStatusChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
  }

  resetFilters(): void {
    this.searchText.set('');
    this.typeFilter.set('all');
    this.groupFilter.set('all');
    this.statusFilter.set('active');
    this.page.set(1);
    this.persistSearch('');
  }

  // Guarda (o borra) el texto de búsqueda para restaurarlo al volver a la pantalla.
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

  onSortChange(event: Event): void {
    this.sortColumn.set((event.target as HTMLSelectElement).value as SortColumn);
    this.page.set(1);
  }

  toggleSortDirection(): void {
    this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    this.page.set(1);
  }

  prevPage(): void {
    if (this.page() > 1) this.page.update((p) => p - 1);
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update((p) => p + 1);
  }

  newPrompt(): void {
    void this.router.navigate(['/prompts', 'nuevo']);
  }

  openPrompt(prompt: Prompt): void {
    // prompts/:id es solo edición (prompts.write): los lectores no abren el formulario.
    if (!this.canWritePrompts()) {
      return;
    }
    void this.router.navigate(['/prompts', prompt.promptId]);
  }

  removePrompt(prompt: Prompt): void {
    if (!window.confirm(this.t('prompts.confirmDelete', { name: prompt.name }))) {
      return;
    }

    this.error.set(null);
    this.promptsService.deletePrompt(prompt.promptId).subscribe({
      next: () => this.prompts.update((list) => list.filter((p) => p.promptId !== prompt.promptId)),
      error: () => this.error.set(this.t('prompts.deleteErrorName', { name: prompt.name })),
    });
  }
}
