import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PromptsService, Prompt } from '../services/prompts.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';

type SortColumn =
  | 'promptId'
  | 'secuence'
  | 'code'
  | 'name'
  | 'description'
  | 'agent'
  | 'agentGroup'
  | 'type'
  | 'llmModel'
  | 'version';
type SortDirection = 'asc' | 'desc';

const NUMERIC_COLUMNS: ReadonlySet<SortColumn> = new Set(['promptId', 'secuence']);

const PAGE_SIZE = 10;

@Component({
  selector: 'app-prompts-list',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective],
  templateUrl: './prompts-list.html',
  styleUrl: './prompts-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptsListComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly prompts = signal<Prompt[]>([]);

  readonly searchText = signal('');
  readonly typeFilter = signal('all');
  readonly groupFilter = signal('all');
  readonly statusFilter = signal('active');
  readonly sortColumn = signal<SortColumn>('agentGroup');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly page = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly sortOptions: { value: SortColumn; label: string }[] = [
    { value: 'promptId', label: 'ID' },
    { value: 'secuence', label: 'Secuencia' },
    { value: 'code', label: 'Código' },
    { value: 'name', label: 'Nombre' },
    { value: 'description', label: 'Descripción' },
    { value: 'agent', label: 'Agente' },
    { value: 'agentGroup', label: 'Grupo' },
    { value: 'type', label: 'Tipo' },
    { value: 'llmModel', label: 'Modelo' },
    { value: 'version', label: 'Versión' },
  ];

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
          `${p.code} ${p.name} ${p.description} ${p.agent} ${p.agentGroup} ${p.type} ${p.llmModel} ${p.version}`.toLowerCase();
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
    return `Mostrando ${start}–${end} de ${total}`;
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

  private inFlight = false;

  private readonly permissions = inject(PermissionsService);

  readonly PERMISSIONS = PERMISSIONS;

  readonly canWritePrompts = computed(() => this.permissions.has(PERMISSIONS.promptsWrite));

  constructor(
    private promptsService: PromptsService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
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

    this.promptsService.getPrompts().subscribe({
      next: (data) => this.prompts.set(data),
      error: () => {
        this.error.set('No se pudieron cargar los prompts. Verifica la conexión con el webhook.');
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

  onSearch(event: Event): void {
    this.searchText.set((event.target as HTMLInputElement).value);
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
}
