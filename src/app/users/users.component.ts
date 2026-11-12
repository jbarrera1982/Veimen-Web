import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { ManagedUser, UsersService } from './users.service';
import { ClientContextService } from '../services/client-context.service';
import { TranslationService } from '../i18n/translation.service';

type Dialog = { kind: 'password'; user: ManagedUser } | null;

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './users.html',
  styleUrl: './users.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersComponent {
  private readonly fb = inject(FormBuilder);
  private readonly users = inject(UsersService);
  private readonly clientContext = inject(ClientContextService);
  private readonly i18n = inject(TranslationService);
  readonly router = inject(Router);

  readonly t = this.i18n.t;

  readonly usersList = signal<ManagedUser[]>([]);
  readonly filteredUsers = computed(() => {
    const clientId = this.clientContext.effectiveClientId();
    return clientId === null
      ? this.usersList()
      : this.usersList().filter((user) => user.clientId === clientId);
  });
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly dialog = signal<Dialog>(null);
  readonly dialogError = signal<string | null>(null);
  readonly isSaving = signal(false);

  readonly passwordForm = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(100)]],
  });

  constructor() {
    this.notice.set(this.readNavigationNotice());
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.users.list().subscribe({
      next: (users) => {
        this.usersList.set(UserSort.byStatusThenUsername(users));
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(this.extractMessage(err));
        this.isLoading.set(false);
      },
    });
  }

  openCreate(): void {
    void this.router.navigate(['/usuarios/nuevo']);
  }

  openEdit(user: ManagedUser): void {
    void this.router.navigate(['/usuarios', user.userId]);
  }

  openPassword(user: ManagedUser): void {
    this.passwordForm.reset({ newPassword: '' });
    this.dialogError.set(null);
    this.dialog.set({ kind: 'password', user });
  }

  closeDialog(): void {
    if (!this.isSaving()) {
      this.dialog.set(null);
    }
  }

  submitPassword(): void {
    const current = this.dialog();
    if (current?.kind !== 'password' || this.passwordForm.invalid || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    this.dialogError.set(null);

    this.users
      .resetPassword(current.user.userId, this.passwordForm.value.newPassword ?? '')
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.dialog.set(null);
          this.notice.set(this.t('users.passwordResetNotice', { username: current.user.username }));
        },
        error: (err) => {
          this.dialogError.set(this.extractMessage(err));
          this.isSaving.set(false);
        },
      });
  }

  toggleActive(user: ManagedUser): void {
    const activate = !user.active;
    if (
      !window.confirm(
        this.t(activate ? 'users.activateConfirm' : 'users.deactivateConfirm', {
          username: user.username,
        }),
      )
    ) {
      return;
    }
    this.notice.set(null);
    this.error.set(null);

    this.users.update(user.userId, { active: activate }).subscribe({
      next: (updated) => {
        this.usersList.update((list) =>
          UserSort.byStatusThenUsername(
            list.map((u) => (u.userId === updated.userId ? updated : u)),
          ),
        );
        this.notice.set(
          this.t(activate ? 'users.activatedName' : 'users.deactivatedName', {
            username: updated.username,
          }),
        );
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  profileName(user: ManagedUser): string {
    return user.profileName ?? this.t('users.noProfile');
  }

  clientName(user: ManagedUser): string {
    return user.clientName ?? this.t('common.all');
  }

  formatDateTime(value: string): string {
    return this.i18n.formatDateTime(value);
  }

  private readNavigationNotice(): string | null {
    const fromNav = this.router.getCurrentNavigation()?.extras.state?.['notice'];
    if (typeof fromNav === 'string' && fromNav) {
      return fromNav;
    }
    if (typeof history !== 'undefined') {
      const fromHistory = (history.state as { notice?: unknown } | null)?.notice;
      if (typeof fromHistory === 'string' && fromHistory) {
        return fromHistory;
      }
    }
    return null;
  }

  private extractMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string } | null;
      if (body?.message) {
        return body.message;
      }
      return err.status === 0 ? this.t('users.connectionError') : this.t('users.genericError');
    }
    return this.t('common.unexpectedError');
  }
}

const UserSort = {
  byStatusThenUsername(users: ManagedUser[]): ManagedUser[] {
    return [...users].sort((a, b) => {
      if (a.active !== b.active) {
        return a.active ? -1 : 1;
      }
      return a.username.localeCompare(b.username, 'es', { sensitivity: 'base' });
    });
  },
};
