import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './auth-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isSubmitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    identifier: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.error.set(null);

    const { identifier, password } = this.form.value;
    this.auth.login(identifier ?? '', password ?? '').subscribe({
      next: () => {
        const redirect = this.route.snapshot.queryParams['redirect'];
        // Por defecto se va a la raíz: homeRedirectGuard redirige al primer
        // módulo al que el usuario tiene acceso (no necesariamente el dashboard).
        void this.router.navigateByUrl(typeof redirect === 'string' && redirect ? redirect : '/');
      },
      error: (err) => {
        this.error.set(this.extractMessage(err));
        this.isSubmitting.set(false);
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
        : 'Credenciales inválidas.';
    }
    return 'Error inesperado. Inténtalo de nuevo.';
  }
}
