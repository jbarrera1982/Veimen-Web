import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Documento estático alojado en /public/TUCOOP_Gestion_de_Valor.pdf. El builder lo
// copia a la raíz del output, así que se resuelve contra el <base href="/"> del index.html.
const BUSINESS_MODEL_PDF = 'TUCOOP_Gestion_de_Valor.pdf';

@Component({
  selector: 'app-business-model',
  standalone: true,
  templateUrl: './business-model.html',
  styleUrl: './business-model.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BusinessModelComponent {
  private readonly sanitizer = inject(DomSanitizer);

  // El iframe exige un recurso de confianza: Angular bloquea [src] en el contexto
  // RESOURCE_URL salvo que se marque explícitamente.
  readonly pdfUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl(BUSINESS_MODEL_PDF);

  // Respaldo para cuando el navegador no renderiza el PDF dentro del iframe.
  readonly pdfHref = BUSINESS_MODEL_PDF;
}
