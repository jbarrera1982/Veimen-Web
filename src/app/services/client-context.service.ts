import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { AuthService } from './auth.service';
import { Client, ClientsService } from './clients.service';

/**
 * Contexto global de cliente.
 *
 * Guarda la lista de clientes y el cliente seleccionado (objeto `Client` completo,
 * con `clientId`, `name`, `projectId`, ...) para que los filtros de cada componente
 * lo consuman sin volver a pedirlo ni duplicar el selector. `selectedClient() === null`
 * significa "Todos" (sin filtrar).
 *
 * Reglas:
 * - El usuario con `client_id` asociado (AuthService.currentUser().clientId) no elige:
 *   su cliente queda fijado en cuanto la lista carga. El menú lo muestra como texto.
 * - El usuario sin cliente asociado elige entre los clientes activos; el menú muestra
 *   el selector. `selectedClient` arranca en `null` ("Todos").
 *
 * El estado vive en memoria durante la sesión (providedIn: 'root'). El menú
 * (ShellComponent) dispara la carga y es el único que edita la selección. La carga
 * se rehace (y la selección se descarta) cuando cambia el usuario autenticado, así
 * el contexto no se arrastra de una sesión a la siguiente.
 */
@Injectable({ providedIn: 'root' })
export class ClientContextService {
  private readonly clientsService = inject(ClientsService);
  private readonly auth = inject(AuthService);

  readonly clients = signal<Client[]>([]);
  readonly selectedClient = signal<Client | null>(null);
  readonly isLoading = signal(false);

  // userId para el que ya se cargó la lista (null = sin cargar todavía).
  private loadedUserId: number | null = null;

  /** true cuando el usuario tiene un `client_id` asociado (no puede elegir cliente). */
  readonly hasAssociatedClient = computed(
    () => (this.auth.currentUser()?.clientId ?? null) !== null,
  );

  /** `client_id` del usuario asociado; sirve de respaldo si no se resuelve el nombre. */
  readonly associatedClientId = computed(() => this.auth.currentUser()?.clientId ?? null);

  /**
   * `client_id` que acota las pantallas: el del usuario si tiene uno asociado; si no,
   * el seleccionado en el menú. `null` = "Todos".
   */
  readonly effectiveClientId = computed(
    () => this.associatedClientId() ?? this.selectedClient()?.clientId ?? null,
  );

  /** Clientes elegibles en el selector: solo activos, ordenados por nombre. */
  readonly selectableClients = computed(() =>
    this.clients()
      .filter((client) => client.active)
      .sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId),
  );

  /** Nombre del cliente seleccionado, '' si no hay ninguno. */
  readonly selectedClientName = computed(() => this.selectedClient()?.name.trim() ?? '');

  /** Carga los clientes una sola vez por sesión (el menú la dispara en ngOnInit). */
  ensureLoaded(): void {
    const userId = this.auth.currentUser()?.userId ?? null;
    if (userId === null || this.loadedUserId === userId) {
      return;
    }
    // Sesión nueva o usuario distinto: se descarta la selección anterior.
    this.selectedClient.set(null);
    this.loadedUserId = userId;
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.clientsService
      .getClients()
      .pipe(catchError(() => of<Client[]>([])))
      .subscribe((clients) => {
        this.clients.set(clients);
        this.isLoading.set(false);
        this.applyAssociatedClient(clients);
      });
  }

  /**
   * Selecciona un cliente por id. `null` = "Todos". No tiene efecto si el usuario
   * tiene un cliente asociado (su selección la fija la carga).
   */
  selectClient(clientId: number | null): void {
    if (this.hasAssociatedClient()) {
      return;
    }
    const client =
      clientId === null ? null : (this.clients().find((c) => c.clientId === clientId) ?? null);
    this.selectedClient.set(client);
  }

  /** Limpia todo el estado (p. ej. al cerrar sesión). */
  reset(): void {
    this.loadedUserId = null;
    this.clients.set([]);
    this.selectedClient.set(null);
    this.isLoading.set(false);
  }

  private applyAssociatedClient(clients: Client[]): void {
    const clientId = this.associatedClientId();
    if (clientId === null) {
      return;
    }
    this.selectedClient.set(clients.find((client) => client.clientId === clientId) ?? null);
  }
}
