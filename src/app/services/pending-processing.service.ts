import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { MailService } from './mail.service';
import { ClientContextService } from './client-context.service';
import { PERMISSIONS, PermissionsService } from './permissions.service';

// El badge de Procesamiento se refresca cada media hora (el de Requerimientos
// mantiene su propio intervalo de 60 s).
export const PENDING_PROCESSING_POLL_MS = 30 * 60_000;

// Estado del badge "correos sin requerimiento" del menú lateral: el contador que
// muestra (sondeado al iniciar y cada 30 min) y que también se refresca al cambiar
// de cliente y al cargar/recargar la pantalla de Procesamiento.
@Injectable({ providedIn: 'root' })
export class PendingProcessingService implements OnDestroy {
  private readonly mail = inject(MailService);
  private readonly clientContext = inject(ClientContextService);
  private readonly permissions = inject(PermissionsService);

  /** Correos sin requerimiento del cliente global (0 = badge oculto). */
  readonly count = signal(0);

  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  /** Arranca el sondeo periódico (idempotente). Lo llama ShellComponent al iniciar la pantalla. */
  start(): void {
    if (this.timer !== null) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), PENDING_PROCESSING_POLL_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Consulta el total con el cliente global seleccionado. Sin el permiso `mail.scan`
   * no se llama a la API y el badge queda en 0.
   */
  refresh(): void {
    if (!this.permissions.has(PERMISSIONS.mailScan)) {
      this.count.set(0);
      return;
    }

    if (this.inFlight) return;
    this.inFlight = true;

    this.mail
      .getPendingCount(this.clientContext.effectiveClientId())
      .pipe(finalize(() => (this.inFlight = false)))
      .subscribe({
        // Un fallo (red, 403, ...) no rompe el menú: se conserva el último valor.
        next: (count) => this.count.set(count),
        error: () => undefined,
      });
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
