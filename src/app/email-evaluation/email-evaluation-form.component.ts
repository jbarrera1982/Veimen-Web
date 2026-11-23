import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { QuillEditorComponent, QuillModules } from 'ngx-quill';
// El CSS del tema se importa desde el componente diferido: así entra en el chunk de la
// pantalla de Emails y no engorda el bundle inicial.
import 'quill/dist/quill.snow.css';
import {
  EmailEvaluationCase,
  EmailEvaluationCasePayload,
  EmailEvaluationDatasetService,
} from '../services/email-evaluation-dataset.service';
import { ClientContextService } from '../services/client-context.service';
import { Client } from '../services/clients.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { TranslationService } from '../i18n/translation.service';
import { EmailEvaluationResultComponent } from './evaluation-result.component';

@Component({
  selector: 'app-email-evaluation-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    QuillEditorComponent,
    EmailEvaluationResultComponent,
  ],
  templateUrl: './email-evaluation-form.component.html',
  styleUrl: './email-evaluation-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailEvaluationFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly datasetService = inject(EmailEvaluationDatasetService);
  private readonly clientContext = inject(ClientContextService);
  private readonly permissions = inject(PermissionsService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly t = this.i18n.t;
  readonly PERMISSIONS = PERMISSIONS;

  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly isEdit = signal(false);
  readonly isClone = signal(false);
  // id autonumérico del caso cargado (null en alta o duplicado).
  private readonly loadedId = signal<number | null>(null);

  readonly evaluationLabel = signal<string | null>(null);
  readonly evaluationResult = signal<unknown>(null);
  readonly evaluationError = signal<string | null>(null);
  readonly isEvaluating = signal(false);

  // Cliente fijo del contexto (asociado al usuario o elegido en el menú).
  readonly contextClientId = this.clientContext.effectiveClientId;

  readonly canEvaluate = computed(
    () => this.isEdit() && this.permissions.has(PERMISSIONS.emailEvaluationWrite),
  );

  // Toolbar del editor HTML (Quill 2). La barra por defecto incluye formatos que no
  // aplican al correo, así que se limita a lo esencial.
  readonly editorModules: QuillModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ header: [1, 2, 3, false] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ],
  };

  readonly form = this.fb.group({
    scenario: ['', [Validators.required, Validators.maxLength(150)]],
    from: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    subject: ['', [Validators.maxLength(500)]],
    content: [''],
    // Obligatorio cuando no hay cliente de contexto (ver applyClientContext).
    clientId: [null as number | null],
    createdBy: [''],
    createdAt: [''],
    updatedBy: [''],
    updatedAt: [''],
  });

  // Estado de navegación que envía el listado al duplicar un caso (id del original).
  private readonly navigationState =
    (this.router.getCurrentNavigation()?.extras.state as
      { duplicateId?: number } | null | undefined) ?? null;

  ngOnInit(): void {
    this.applyClientContext();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam && idParam !== 'nuevo') {
      const id = Number(idParam);
      this.isEdit.set(true);
      if (Number.isInteger(id) && id > 0) {
        this.loadCase(id, false);
      } else {
        this.error.set(this.t('emailForm.notFound'));
      }
      return;
    }

    const duplicateId = this.navigationState?.duplicateId ?? this.readHistoryDuplicate();
    if (duplicateId) {
      this.isClone.set(true);
      this.loadCase(duplicateId, true);
    }
  }

  save(): void {
    if (this.isSaving()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    const raw = this.form.getRawValue();
    const payload: EmailEvaluationCasePayload = {
      scenario: (raw.scenario ?? '').trim(),
      from: (raw.from ?? '').trim(),
      subject: this.nullIfBlank(raw.subject),
      content: raw.content ?? '',
      clientId: this.contextClientId() ?? raw.clientId,
    };

    const id = this.loadedId();
    const request$: Observable<unknown> =
      this.isEdit() && id !== null
        ? this.datasetService.updateCase(id, payload)
        : this.datasetService.createCase(payload);

    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        void this.router.navigate(['/emails-evaluacion']);
      },
      error: (err: unknown) => {
        this.saveError.set(this.extractMessage(err));
        this.isSaving.set(false);
      },
    });
  }

  // Convierte el caso editado en uno nuevo: deja de estar ligado a la fila original y
  // limpia la auditoría, de modo que al guardar se haga un POST (inserción). El resto
  // de los campos queda precargado.
  duplicate(): void {
    if (!this.isEdit()) {
      return;
    }

    this.form.patchValue({
      createdBy: '',
      createdAt: '',
      updatedBy: '',
      updatedAt: '',
    });
    this.loadedId.set(null);
    this.isEdit.set(false);
    this.isClone.set(true);
    this.saveError.set(null);
    this.error.set(null);
    this.closeEvaluation();
  }

  cancel(): void {
    void this.router.navigate(['/emails-evaluacion']);
  }

  evaluate(): void {
    const id = this.loadedId();
    if (id === null) {
      return;
    }

    this.evaluationLabel.set(`#${id}`);
    this.evaluationResult.set(null);
    this.evaluationError.set(null);
    this.isEvaluating.set(true);

    this.datasetService.evaluateCase(id).subscribe({
      next: (result) => this.evaluationResult.set(result),
      error: (err: unknown) => this.evaluationError.set(this.extractErrorMessage(err)),
      complete: () => this.isEvaluating.set(false),
    });
  }

  closeEvaluation(): void {
    this.evaluationLabel.set(null);
    this.evaluationResult.set(null);
    this.evaluationError.set(null);
    this.isEvaluating.set(false);
  }

  // Opciones del selector: clientes activos y, al editar, el cliente ya asociado aunque
  // esté inactivo (para no perder la asociación al guardar).
  clientOptions(): Client[] {
    const current = this.form.controls.clientId.value;
    return this.clientContext
      .clients()
      .filter((client) => client.active || client.clientId === current);
  }

  private loadCase(id: number, duplicate: boolean): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.datasetService.getCase(id).subscribe({
      next: (item) => this.applyCase(item, duplicate),
      error: (err: unknown) => {
        this.error.set(this.extractMessage(err));
        this.isLoading.set(false);
      },
      complete: () => this.isLoading.set(false),
    });
  }

  private applyCase(item: EmailEvaluationCase, duplicate: boolean): void {
    if (duplicate) {
      this.form.patchValue({
        scenario: item.scenario,
        from: item.from,
        subject: item.subject,
        content: item.content,
        clientId: this.contextClientId() ?? item.clientId,
        createdBy: '',
        createdAt: '',
        updatedBy: '',
        updatedAt: '',
      });
      this.loadedId.set(null);
      return;
    }

    this.form.patchValue({
      scenario: item.scenario,
      from: item.from,
      subject: item.subject,
      content: item.content,
      clientId: this.contextClientId() ?? item.clientId,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      updatedBy: item.updatedBy,
      updatedAt: item.updatedAt,
    });
    this.loadedId.set(item.id);
    this.applyClientContext();
  }

  // Con cliente de contexto el campo no se muestra y el caso se guarda con ese cliente.
  private applyClientContext(): void {
    const clientId = this.form.controls.clientId;
    const contextId = this.contextClientId();
    if (contextId !== null) {
      clientId.clearValidators();
      clientId.setValue(contextId);
    } else {
      clientId.setValidators(Validators.required);
    }
    clientId.updateValueAndValidity();
  }

  // El listado navega con state; en tests o recargas se cae a history.state.
  private readHistoryDuplicate(): number | null {
    if (typeof window === 'undefined' || !window.history?.state) {
      return null;
    }
    const value = (window.history.state as { duplicateId?: unknown }).duplicateId;
    return typeof value === 'number' && value > 0 ? value : null;
  }

  private nullIfBlank(value: string | null): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  }

  private extractMessage(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return err instanceof Error && err.message ? err.message : this.t('emailForm.genericError');
    }

    if (err.status === 400) {
      const fields = this.invalidFields(err.error);
      if (fields.length > 0) {
        return this.t('emailForm.invalidFields', { fields: fields.slice(0, 5).join(', ') });
      }
      return this.t('emailForm.invalidData');
    }
    if (err.status === 403) {
      return this.t('emailForm.forbidden');
    }
    if (err.status === 404) {
      return this.t('emailForm.notFound');
    }
    if (err.status === 0) {
      return this.t('emailForm.connectionError');
    }
    return this.t('emailForm.genericError');
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return message;
        }
      }
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
      if (err.status === 0) {
        return this.t('emails.evaluationConnectionError');
      }
      return this.t('emails.evaluationError');
    }

    return err instanceof Error && err.message ? err.message : this.t('emails.evaluationError');
  }

  // El 400 del backend trae el ModelState: { errors: { From: ['…'] } }.
  private invalidFields(body: unknown): string[] {
    if (body && typeof body === 'object' && 'errors' in body) {
      const errors = (body as { errors?: Record<string, string[]> }).errors;
      if (errors && typeof errors === 'object') {
        return Object.keys(errors);
      }
    }
    if (typeof body === 'string' && body.includes('"errors"')) {
      try {
        const parsed: unknown = JSON.parse(body);
        return this.invalidFields(parsed);
      } catch {
        return [];
      }
    }
    return [];
  }
}
