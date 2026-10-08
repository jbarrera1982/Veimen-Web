import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ClientPayload, ClientsService } from '../services/clients.service';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './client-form.html',
  styleUrl: './client-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientFormComponent implements OnInit {
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly isEdit = signal(false);
  readonly clientId = signal(0);

  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    inboundEmail: ['', [Validators.email, Validators.maxLength(100)]],
    outboundEmail: ['', [Validators.email, Validators.maxLength(100)]],
    analystEmail: ['', [Validators.email, Validators.maxLength(100)]],
    openAIApiKey: ['', Validators.maxLength(100)],
    active: [true],
  });

  constructor(
    private clientsService: ClientsService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'nuevo') {
      this.isEdit.set(true);
      this.loadClient(Number(id));
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
    const payload: ClientPayload = {
      clientId: this.clientId(),
      name: raw.name,
      inboundEmail: raw.inboundEmail,
      outboundEmail: raw.outboundEmail,
      analystEmail: raw.analystEmail,
      openAIApiKey: raw.openAIApiKey,
      active: raw.active,
    };

    const request$: Observable<unknown> = this.isEdit()
      ? this.clientsService.updateClient(this.clientId(), payload)
      : this.clientsService.createClient(payload);

    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        const notice = this.isEdit()
          ? `Cliente ${payload.name?.trim() ?? ''} actualizado.`
          : `Cliente ${payload.name?.trim() ?? ''} creado.`;
        void this.router.navigate(['/clientes'], { state: { notice } });
      },
      error: (err: unknown) => {
        this.saveError.set(this.extractMessage(err));
        this.isSaving.set(false);
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/clientes']);
  }

  private loadClient(clientId: number): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.clientsService.getClient(clientId).subscribe({
      next: (client) => {
        this.clientId.set(client.clientId);
        this.form.patchValue({
          name: client.name,
          inboundEmail: client.inboundEmail,
          outboundEmail: client.outboundEmail,
          analystEmail: client.analystEmail,
          openAIApiKey: client.openAIApiKey,
          active: client.active,
        });
      },
      error: (err) => {
        this.error.set(this.extractMessage(err));
        this.isLoading.set(false);
      },
      complete: () => this.isLoading.set(false),
    });
  }

  private extractMessage(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return err instanceof Error && err.message
        ? err.message
        : 'Error inesperado. Inténtalo de nuevo.';
    }

    const body = err.error as { message?: string } | null;
    if (body?.message) {
      return body.message;
    }

    if (err.status === 400) {
      const fields = this.invalidFields(err.error);
      if (fields.length > 0) {
        return `Revisa estos campos: ${fields.slice(0, 5).join(', ')}.`;
      }
      return 'Los datos enviados no son válidos. Revisa los campos obligatorios.';
    }
    if (err.status === 403) {
      return 'No tienes permiso para guardar clientes.';
    }
    if (err.status === 404) {
      return 'El cliente ya no existe: puede que otro usuario lo haya eliminado. Vuelve al listado.';
    }
    if (err.status === 0) {
      return 'No se pudo conectar con el servidor. Verifica tu conexión.';
    }
    return 'Ocurrió un error. Inténtalo de nuevo.';
  }

  // El 400 del backend trae el ModelState: { errors: { name: ['…'], inboundEmail: ['…'] } }.
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
