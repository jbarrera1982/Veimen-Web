import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { RequestsService } from './requests.service';
import { ClientContextService } from './client-context.service';
import { PERMISSIONS, PermissionsService } from './permissions.service';

// Cada cuánto se refresca el contador del badge del menú.
export const PENDING_REVIEW_POLL_MS = 60_000;

// Estado del badge "pendientes de revisión" del menú lateral: el contador que muestra
// (sondeado al iniciar y cada minuto) y la petición de abrir el listado filtrado que
// consume ServiceRequestComponent al cargarse.
@Injectable({ providedIn: 'root' })
export class PendingReviewService implements OnDestroy {
  private readonly requests = inject(RequestsService);
  private readonly clientContext = inject(ClientContextService);
  private readonly permissions = inject(PermissionsService);

  /** Requerimientos 'Pending review' del cliente global (0 = badge oculto). */
  readonly count = signal(0);

  /** Click en el badge: el listado debe mostrar solo los pendientes, sin filtro de fechas. */
  readonly filterRequested = signal(false);

  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  /** Arranca el sondeo periódico (idempotente). Lo llama ShellComponent al iniciar la pantalla. */
  start(): void {
    if (this.timer !== null) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), PENDING_REVIEW_POLL_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Consulta el total de pendientes con el cliente global seleccionado (el listado filtra
   * igual, así el badge coincide con lo que se ve al hacer click). Sin permiso de lectura
   * no se llama a la API y el badge queda en 0.
   */
  refresh(): void {
    if (!this.permissions.has(PERMISSIONS.serviceRequestsRead)) {
      this.count.set(0);
      return;
    }

    if (this.inFlight) return;
    this.inFlight = true;

    this.requests
      .getPendingReviewCount(this.clientContext.effectiveClientId() ?? undefined)
      .pipe(finalize(() => (this.inFlight = false)))
      .subscribe({
        // Un fallo (red, 403, ...) no rompe el menú: se conserva el último valor.
        next: (count) => this.count.set(count),
        error: () => undefined,
      });
  }

  /** Marca que el listado debe abrirse mostrando solo los pendientes de revisión. */
  requestFilter(): void {
    this.filterRequested.set(true);
  }

  /**
   * El listado consume la petición al cargarse (o al recibirla si ya está abierto).
   * Devuelve true una sola vez por cada click en el badge.
   */
  consumeFilterRequest(): boolean {
    if (!this.filterRequested()) return false;
    this.filterRequested.set(false);
    return true;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
