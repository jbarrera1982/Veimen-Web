import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../i18n/translation.service';

// Panel de resultado de la evaluación de un caso contra el webhook de n8n.
// Se usa desde el listado y desde el formulario; no persiste historial.
@Component({
  selector: 'app-email-evaluation-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './evaluation-result.component.html',
  styleUrl: './evaluation-result.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailEvaluationResultComponent {
  private readonly i18n = inject(TranslationService);
  readonly t = this.i18n.t;

  // Caso evaluado (solo para el título); null oculta el panel.
  readonly caseLabel = input<string | null>(null);
  readonly isLoading = input(false);
  readonly error = input<string | null>(null);
  readonly result = input<unknown>(null);

  readonly closed = output<void>();

  readonly formattedResult = computed(() => {
    const value = this.result();
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  });

  readonly hasNoContent = computed(
    () => !this.isLoading() && !this.error() && !this.formattedResult(),
  );

  close(): void {
    this.closed.emit();
  }
}
