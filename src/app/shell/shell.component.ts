import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ClientContextService } from '../services/client-context.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { PendingReviewService } from '../services/pending-review.service';
import { PendingProcessingService } from '../services/pending-processing.service';
import { HasPermissionDirective } from '../auth/has-permission.directive';
import { TranslationService, normalizeLanguage } from '../i18n/translation.service';

// Idiomas que el usuario puede elegir en Preferencias. El backend guarda el nombre
// en español ("Español"/"Inglés") y el token lo transporta en el claim `language`.
const USER_LANGUAGE_OPTIONS = ['Español', 'Inglés'] as const;

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, HasPermissionDirective],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly clientContext = inject(ClientContextService);
  private readonly pendingReview = inject(PendingReviewService);
  private readonly pendingProcessing = inject(PendingProcessingService);
  private readonly i18n = inject(TranslationService);

  readonly PERMISSIONS = PERMISSIONS;
  readonly t = this.i18n.t;

  readonly isMenuOpen = signal(false);

  // Preferencias del usuario (engranaje junto a la tarjeta del usuario).
  readonly isSettingsOpen = signal(false);
  readonly isLanguageOpen = signal(false);
  readonly isSavingLanguage = signal(false);
  readonly languageError = signal<string | null>(null);

  readonly currentUser = this.auth.currentUser;

  // Idioma activo y opciones del submenú "Idioma".
  readonly currentLanguage = this.i18n.language;
  readonly languageOptions = computed(() =>
    USER_LANGUAGE_OPTIONS.map((value) => ({
      value,
      // Las etiquetas ya existen para el formulario de usuarios ("Español"/"Inglés").
      label: this.t(value === 'Inglés' ? 'userForm.languageEnglish' : 'userForm.languageSpanish'),
    })),
  );
  readonly currentLanguageLabel = computed(
    () =>
      this.languageOptions().find((option) => this.isCurrentLanguage(option.value))?.label ?? '',
  );

  // Badge de "Requerimientos": cantidad de pendientes de revisión.
  readonly pendingReviewCount = this.pendingReview.count;

  // Badge de "Procesamiento": correos sin requerimiento asociado.
  readonly pendingProcessingCount = this.pendingProcessing.count;

  // Filtro global de cliente: el menú es el único que lo edita. El contexto lo
  // consumen los filtros internos de cada componente.
  readonly selectableClients = this.clientContext.selectableClients;
  readonly selectedClient = this.clientContext.selectedClient;
  readonly selectedClientName = this.clientContext.selectedClientName;
  readonly hasAssociatedClient = this.clientContext.hasAssociatedClient;
  readonly associatedClientId = this.clientContext.associatedClientId;

  // La categoría "Monitorear" se oculta si el usuario no tiene ninguno de sus permisos.
  readonly canMonitor = computed(() =>
    this.permissions.hasAny(
      PERMISSIONS.dashboardRead,
      PERMISSIONS.menuTokens,
      PERMISSIONS.usageRead,
      PERMISSIONS.mailScan,
      PERMISSIONS.serviceRequestsRead,
    ),
  );

  // "Administrar" se oculta si el usuario no tiene ninguno de sus permisos
  // (Clientes, Usuarios o Prompts). Un usuario con cliente asociado no ve Clientes.
  readonly canManage = computed(() =>
    this.permissions.hasAny(
      ...(this.hasAssociatedClient() ? [] : [PERMISSIONS.clientsRead]),
      PERMISSIONS.usersManage,
      PERMISSIONS.promptsRead,
      PERMISSIONS.emailEvaluationRead,
    ),
  );

  readonly displayName = computed(() => {
    const user = this.currentUser();
    if (!user) {
      return '';
    }
    return user.fullName?.trim() || user.username;
  });

  readonly initials = computed(() => {
    const name = this.displayName();
    if (!name) {
      return '?';
    }
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  });

  ngOnInit(): void {
    // Carga los clientes para poblar el filtro global (el GET no exige clients.read).
    this.clientContext.ensureLoaded();
    // Sondeo de los badges del menú (se refrescan también al cambiar de cliente).
    this.pendingReview.start();
    this.pendingProcessing.start();
  }

  ngOnDestroy(): void {
    this.pendingReview.stop();
    this.pendingProcessing.stop();
  }

  /** Selecciona el cliente del desplegable del menú ('' = Todos). */
  onClientChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.clientContext.selectClient(value ? Number(value) : null);
    // Los badges cuentan con el cliente seleccionado.
    this.pendingReview.refresh();
    this.pendingProcessing.refresh();
  }

  /** Click en el badge: abre el listado mostrando solo los pendientes de revisión, sin filtro de fechas. */
  openPendingReview(): void {
    this.pendingReview.requestFilter();
    void this.router.navigate(['/service-request']);
  }

  /** Click en el badge de Procesamiento: abre la comparativa de correos vs requerimientos. */
  openProcessing(): void {
    void this.router.navigate(['/procesamiento']);
  }

  /** Abre/cierra el panel de Preferencias del engranaje. */
  toggleSettings(): void {
    const open = !this.isSettingsOpen();
    this.isSettingsOpen.set(open);
    if (!open) {
      this.isLanguageOpen.set(false);
    }
    this.languageError.set(null);
  }

  /** Muestra u oculta el submenú "Idioma" dentro de Preferencias. */
  toggleLanguageMenu(): void {
    this.isLanguageOpen.update((open) => !open);
  }

  /** Indica si la opción corresponde al idioma activo del usuario. */
  isCurrentLanguage(value: string): boolean {
    return normalizeLanguage(value) === this.currentLanguage();
  }

  /**
   * Guarda el idioma elegido en la base (vía API) y lo aplica a toda la aplicación:
   * el backend reemite el access token con el claim `language` nuevo.
   */
  selectLanguage(value: string): void {
    if (this.isSavingLanguage() || this.isCurrentLanguage(value)) {
      return;
    }

    this.isSavingLanguage.set(true);
    this.languageError.set(null);

    this.auth.updateLanguage(value).subscribe({
      next: () => {
        this.isSavingLanguage.set(false);
        this.isLanguageOpen.set(false);
      },
      error: () => {
        this.isSavingLanguage.set(false);
        this.languageError.set(this.t('shell.languageError'));
      },
    });
  }

  toggleMenu(): void {
    this.isMenuOpen.update((open) => !open);
  }

  logout(): void {
    this.clientContext.reset();
    this.auth.logout().subscribe();
    void this.router.navigate(['/login']);
  }
}
