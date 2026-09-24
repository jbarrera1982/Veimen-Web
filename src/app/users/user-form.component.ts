import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ManagedUser, UsersService, Profile } from './users.service';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './user-form.html',
  styleUrl: './user-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly users = inject(UsersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly isEdit = signal(false);
  readonly user = signal<ManagedUser | null>(null);
  readonly notFound = signal(false);
  readonly profiles = signal<Profile[]>([]);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    username: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(100)]],
    fullName: ['', [Validators.maxLength(150)]],
    profileId: [0 as number, [Validators.required, Validators.min(1)]],
    active: [true],
  });

  constructor() {
    const rawId = this.route.snapshot.paramMap.get('id');

    if (rawId === null || rawId === 'nuevo') {
      // Modo creación.
      this.isEdit.set(false);
      this.loadProfiles();
      this.isLoading.set(false);
      return;
    }

    // Modo edición: la contraseña no se edita aquí.
    this.isEdit.set(true);
    this.form.controls.password.clearValidators();
    this.form.controls.password.disable();
    this.form.controls.password.updateValueAndValidity();

    const userId = Number(rawId);
    if (!Number.isInteger(userId) || userId <= 0) {
      this.notFound.set(true);
      this.isLoading.set(false);
      return;
    }

    this.loadProfiles();
    this.loadUser(userId);
  }

  submit(): void {
    if (this.form.invalid || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    this.error.set(null);

    if (!this.isEdit()) {
      // Crear usuario nuevo.
      const { username, password, email, fullName, profileId, active } = this.form.value;
      this.users
        .create({
          username: (username ?? '').trim(),
          email: (email ?? '').trim(),
          password: (password ?? '').trim(),
          fullName: (fullName ?? '').trim() || null,
          profileId: Number(profileId),
          active: active ?? true,
        })
        .subscribe({
          next: () => this.onSaved(),
          error: (err) => this.onError(err),
        });
      return;
    }

    // Editar usuario existente.
    // Nota: en modo edición no enviamos username ni password al servicio.
    const current = this.user();
    if (!current) {
      return;
    }

    const { email, fullName, profileId, active } = this.form.value;
    this.users
      .update(current.userId, {
        email: (email ?? '').trim(),
        fullName: (fullName ?? '').trim() || null,
        profileId: Number(profileId),
        active: active ?? true,
      })
      .subscribe({
        next: () => this.onSaved(),
        error: (err) => this.onError(err),
      });
  }

  private onSaved(): void {
    this.isSaving.set(false);
    void this.router.navigate(['/usuarios']);
  }

  private onError(err: unknown): void {
    this.error.set(this.extractMessage(err));
    this.isSaving.set(false);
  }

  private loadProfiles(): void {
    this.users.listProfiles().subscribe({
      next: (profiles) => this.profiles.set(profiles),
      error: () => this.profiles.set([]),
    });
  }

  private loadUser(userId: number): void {
    this.isLoading.set(true);

    this.users.list().subscribe({
      next: (users) => {
        const found = users.find((u) => u.userId === userId) ?? null;
        this.user.set(found);
        if (found) {
          this.form.reset({
            username: found.username,
            email: found.email,
            password: '',
            fullName: found.fullName ?? '',
            profileId: found.profileId ?? 0,
            active: found.active,
          });
        } else {
          this.notFound.set(true);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(this.extractMessage(err));
        this.isLoading.set(false);
      },
    });
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
    if (err instanceof Error) {
      return err.message ?? 'Error inesperado.';
    }
    return 'Error inesperado. Inténtalo de nuevo.';
  }
}
