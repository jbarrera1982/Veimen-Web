import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  readonly isSubmitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal(false);

  readonly passwordsMatch: ValidatorFn = (control: AbstractControl) => {
    const newPassword = control.get('newPassword');
    const confirmPassword = control.get('confirmPassword');
    if (!newPassword || !confirmPassword) {
      return null;
    }
    return newPassword.value === confirmPassword.value ? null : { mismatch: true };
  };

  readonly form = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(100)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: this.passwordsMatch },
  );

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.error.set(null);
    this.success.set(false);

    const { currentPassword, newPassword } = this.form.value;
    this.auth.changePassword(currentPassword ?? '', newPassword ?? '').subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.success.set(true);
        this.form.reset();
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
      return 'No se pudo cambiar la contraseña. Inténtalo de nuevo.';
    }
    return 'Error inesperado. Inténtalo de nuevo.';
  }
}
