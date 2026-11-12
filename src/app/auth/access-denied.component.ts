import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';
import { TranslationService } from '../i18n/translation.service';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="access-denied">
      <h1>{{ t('accessDenied.title') }}</h1>
      <p>{{ t('accessDenied.message') }}</p>
      @if (profile(); as currentProfile) {
        <p class="profile-note">
          {{ t('accessDenied.profilePrefix') }} <strong>{{ currentProfile }}</strong
          >. {{ t('accessDenied.profileSuffix') }}
        </p>
      }
      <a routerLink="/" class="back-link">{{ t('accessDenied.back') }}</a>
    </div>
  `,
  styles: `
    .access-denied {
      max-width: 28rem;
      margin: 4rem auto;
      padding: 0 1rem;
      text-align: center;
      display: grid;
      gap: 1rem;
    }

    .access-denied h1 {
      margin: 0;
    }

    .access-denied p {
      margin: 0;
    }

    .back-link {
      color: inherit;
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessDeniedComponent {
  private readonly permissions = inject(PermissionsService);
  private readonly i18n = inject(TranslationService);
  readonly t = this.i18n.t;
  readonly profile = this.permissions.profile;
}
