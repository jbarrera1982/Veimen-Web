import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { PromptPayload, PromptsService } from '../services/prompts.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-prompt-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './prompt-form.html',
  styleUrl: './prompt-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptFormComponent implements OnInit {
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly isEdit = signal(false);

  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    promptId: [0],
    secuence: [1, Validators.min(0)],
    code: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    // La tabla no tiene columna `agent` (el nombre del agente vive en agent_group).
    agentGroup: ['', Validators.required],
    type: ['', Validators.required],
    llmModel: ['', Validators.required],
    version: ['', Validators.required],
    systemPrompt: ['', Validators.required],
    userPrompt: [''],
    temperature: [0, [Validators.min(0), Validators.max(2)]],
    // null = sin límite; con valor el backend exige >= 1.
    maxTokens: [null as number | null, Validators.min(1)],
    active: [true],
    observations: [''],
    createdBy: [''],
    createdAt: [''],
    updatedBy: [''],
    updatedAt: [''],
    schemaOutput: [''],
  });

  constructor(
    private promptsService: PromptsService,
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'nuevo') {
      this.isEdit.set(true);
      this.loadPrompt(Number(id));
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
    const username = this.auth.currentUser()?.username?.trim() ?? '';
    const payload: PromptPayload = {
      ...raw,
      // El backend solo setea created_at/updated_at: el usuario va desde el cliente.
      createdBy: this.isEdit() ? raw.createdBy : username,
      updatedBy: username,
    };

    const request$: Observable<unknown> = this.isEdit()
      ? this.promptsService.updatePrompt(raw.promptId ?? 0, payload)
      : this.promptsService.createPrompt(payload);

    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        void this.router.navigate(['/prompts']);
      },
      error: (err: unknown) => {
        this.saveError.set(this.extractMessage(err));
        this.isSaving.set(false);
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/prompts']);
  }

  private loadPrompt(promptId: number): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.promptsService.getPrompt(promptId).subscribe({
      next: (prompt) =>
        this.form.patchValue({
          ...prompt,
          // 0 o vacío se edita como "sin límite" para no dejar el formulario inválido.
          maxTokens: prompt.maxTokens > 0 ? prompt.maxTokens : null,
        }),
      error: () => {
        this.error.set('No se pudo cargar el prompt. Verifica la conexión con el servidor.');
        this.isLoading.set(false);
      },
      complete: () => {
        this.isLoading.set(false);
      },
    });
  }

  private extractMessage(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return err instanceof Error && err.message
        ? err.message
        : 'Error inesperado. Inténtalo de nuevo.';
    }

    if (err.status === 400) {
      const fields = this.invalidFields(err.error);
      if (fields.length > 0) {
        return `Revisa estos campos: ${fields.slice(0, 5).join(', ')}.`;
      }
      return 'Los datos enviados no son válidos. Revisa los campos obligatorios.';
    }
    if (err.status === 403) {
      return 'No tienes permiso para guardar prompts.';
    }
    if (err.status === 404) {
      return 'El prompt ya no existe: puede que otro usuario lo haya eliminado. Vuelve al listado.';
    }
    if (err.status === 0) {
      return 'No se pudo conectar con el servidor. Verifica tu conexión.';
    }
    return 'Ocurrió un error. Inténtalo de nuevo.';
  }

  // El 400 del backend trae el ModelState: { errors: { name: ['…'], agentGroup: ['…'] } }.
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
