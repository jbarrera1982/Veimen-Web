import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { DateRange } from './dashboard.service';

export interface TokenUsage {
  date: string; // YYYY-MM-DD
  node: string;
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// La API .NET serializa en camelCase (System.Text.Json por defecto). La API
// agrupa por día × node × llm_model: el detalle se re-agrupa por día × nodo en
// el componente y el gráfico por modelo usa llmModel directamente.
interface RawTokenUsage {
  date: string;
  node: string;
  llmModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

@Injectable({ providedIn: 'root' })
export class TokensService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  // Consumo de tokens por día y node. Solo pasos con node_type = 'LLM'.
  // El rango se aplica sobre end_date de la traza (convención del backend).
  getTokenUsage(options: DateRange = {}): Observable<TokenUsage[]> {
    let params = new HttpParams();
    if (options.startDate) {
      params = params.set('start_date', this.toApiDate(options.startDate));
    }
    if (options.endDate) {
      params = params.set('end_date', this.toApiDate(options.endDate));
    }

    return this.http
      .get<RawTokenUsage[]>(`${this.apiBaseUrl}/api/ServiceRequests/tokens`, { params })
      .pipe(
        map((items) =>
          (items ?? []).map((item) => ({
            // La API devuelve un datetime ISO (ej: 2026-09-01T00:00:00); nos quedamos con la fecha.
            date: (item.date ?? '').slice(0, 10),
            node: item.node?.trim() || '',
            llmModel: item.llmModel?.trim() || '',
            inputTokens: item.inputTokens ?? 0,
            outputTokens: item.outputTokens ?? 0,
            totalTokens: item.totalTokens ?? 0,
          })),
        ),
      );
  }

  private toApiDate(date: string): string {
    return date.replaceAll('-', '');
  }
}
