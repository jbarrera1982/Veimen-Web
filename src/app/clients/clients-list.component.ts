import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Client, ClientPayload, ClientsService } from '../services/clients.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';

type SortColumn =
  'clientId' | 'name' | 'inboundEmail' | 'outboundEmail' | 'analystEmail' | 'active';
type SortDirection = 'asc' | 'desc';

const NUMERIC_COLUMNS: ReadonlySet<SortColumn> = new Set(['clientId']);

const PAGE_SIZE = 10;

@Component({
  selector: 'app-clients-list',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective],
  templateUrl: './clients-list.html',
  styleUrl: './clients-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientsListComponent implements OnInit {
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly clients = signal<Client[]>([]);

  readonly searchText = signal('');
  readonly statusFilter = signal('all');
  readonly sortColumn = signal<SortColumn>('name');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly page = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly filteredClients = computed(() => {
    const term = this.searchText().trim().toLowerCase();
    const status = this.statusFilter();

    return this.clients().filter((c) => {
      if (status === 'active' && !c.active) return false;
      if (status === 'inactive' && c.active) return false;
      if (term) {
        if (!c.name.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  });

  readonly sortedClients = computed(() => {
    const column = this.sortColumn();
    const direction = this.sortDirection();
    const numeric = NUMERIC_COLUMNS.has(column);

    return [...this.filteredClients()].sort((a, b) => {
      let cmp = numeric
        ? Number(a[column]) - Number(b[column])
        : String(a[column]).localeCompare(String(b[column]));
      if (direction === 'desc') cmp = -cmp;
      if (cmp !== 0) return cmp;
      return a.clientId - b.clientId;
    });
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.sortedClients().length / this.pageSize)),
  );

  readonly pagedClients = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.sortedClients().slice(start, start + this.pageSize);
  });

  readonly pageInfo = computed(() => {
    const total = this.sortedClients().length;
    if (total === 0) return '';
    const start = (this.page() - 1) * this.pageSize + 1;
    const end = Math.min(this.page() * this.pageSize, total);
    return `Mostrando ${start}–${end} de ${total}`;
  });

  readonly hasActiveFilters = computed(
    () => this.searchText().trim().length > 0 || this.statusFilter() !== 'all',
  );

  private inFlight = false;
  private readonly permissions = inject(PermissionsService);

  readonly PERMISSIONS = PERMISSIONS;

  readonly canWriteClients = computed(() => this.permissions.has(PERMISSIONS.clientsWrite));

  constructor(
    private clientsService: ClientsService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.notice.set(this.readNavigationNotice());
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

    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data),
      error: (err) => {
        this.error.set(this.extractMessage(err));
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

  onStatusChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
  }

  resetFilters(): void {
    this.searchText.set('');
    this.statusFilter.set('all');
    this.page.set(1);
  }

  prevPage(): void {
    if (this.page() > 1) this.page.update((p) => p - 1);
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update((p) => p + 1);
  }

  newClient(): void {
    void this.router.navigate(['/clientes', 'nuevo']);
  }

  openClient(client: Client): void {
    // clientes/:id es solo edición (clients.write): los lectores no abren el formulario.
    if (!this.canWriteClients()) {
      return;
    }
    void this.router.navigate(['/clientes', client.clientId]);
  }

  toggleActive(client: Client): void {
    const activate = !client.active;
    if (!window.confirm(`¿${activate ? 'Activar' : 'Desactivar'} al cliente ${client.name}?`)) {
      return;
    }

    this.notice.set(null);
    this.error.set(null);

    this.clientsService
      .updateClient(client.clientId, this.toPayload({ ...client, active: activate }))
      .subscribe({
        next: () => {
          this.clients.update((list) =>
            list.map((c) => (c.clientId === client.clientId ? { ...c, active: activate } : c)),
          );
          this.notice.set(`Cliente ${client.name} ${activate ? 'activado' : 'desactivado'}.`);
        },
        error: (err) => this.error.set(this.extractMessage(err)),
      });
  }

  removeClient(client: Client): void {
    if (!window.confirm(`¿Eliminar al cliente ${client.name}?`)) {
      return;
    }

    this.notice.set(null);
    this.error.set(null);

    this.clientsService.deleteClient(client.clientId).subscribe({
      next: () => {
        this.clients.update((list) => list.filter((c) => c.clientId !== client.clientId));
        this.notice.set(`Cliente ${client.name} eliminado.`);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  private toPayload(client: Client): ClientPayload {
    return {
      clientId: client.clientId,
      name: client.name,
      inboundEmail: client.inboundEmail,
      outboundEmail: client.outboundEmail,
      analystEmail: client.analystEmail,
      openAIApiKey: client.openAIApiKey,
      active: client.active,
    };
  }

  private readNavigationNotice(): string | null {
    const fromNav = this.router.getCurrentNavigation()?.extras?.state?.['notice'];
    if (typeof fromNav === 'string' && fromNav) {
      return fromNav;
    }
    if (typeof history !== 'undefined') {
      const fromHistory = (history.state as { notice?: unknown } | null)?.notice;
      if (typeof fromHistory === 'string' && fromHistory) {
        return fromHistory;
      }
    }
    return null;
  }

  private extractMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string } | null;
      if (body?.message) {
        return body.message;
      }
      return err.status === 0
        ? 'No se pudo conectar con el servidor. Verifica tu conexión.'
        : 'Ocurrió un error. Inténtalo de nuevo.';
    }
    return 'Error inesperado. Inténtalo de nuevo.';
  }
}
