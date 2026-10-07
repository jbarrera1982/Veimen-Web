import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Rango de fechas de los endpoints de usage. A diferencia de
// /api/ServiceRequests/tokens, 'start_date' es OBLIGATORIO: la API de OpenAI
// exige start_time y el backend responde 400 si falta (UsageController.
// ValidateDates). Se modela como requerido en el tipo para no poder enviarlo vacío.
export interface UsageDateRange {
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

/**
 * Consumo de un bucket de un día (`bucket_width=1d`) × modelo. OpenAI devuelve
 * una fila por combinación día × modelo × proyecto × api_key × usuario, así que
 * el componente re-agrupa por modelo como hace el dashboard de tokens.
 */
export interface CompletionUsage {
  date: string; // YYYY-MM-DD (día UTC del bucket)
  model: string; // '' si el resultado no trae modelo
  inputTokens: number;
  cachedInputTokens: number; // subconjunto de inputTokens, no se suma aparte
  audioInputTokens: number; // subconjunto de inputTokens, no se suma aparte
  outputTokens: number;
  audioOutputTokens: number; // subconjunto de outputTokens, no se suma aparte
  totalTokens: number; // inputTokens + outputTokens
  requests: number; // num_model_requests
}

/** Costo de un bucket de un día × line_item. */
export interface CostEntry {
  date: string; // YYYY-MM-DD (día UTC del bucket)
  lineItem: string; // '' si el resultado no trae line_item
  amount: number; // amount.value
  currency: string; // amount.currency, '' si no viene
  quantity: number;
  quantityUnit: string; // '' si no viene
}

// ------------------------------------------------------------------
// Formato crudo: el backend reenvía el JSON de OpenAI tal cual (snake_case),
// envuelto en el sobre de página/bucket de /v1/organization/usage/*.
// ------------------------------------------------------------------

interface RawOpenAiPage<T> {
  data?: RawOpenAiBucket<T>[] | null;
}

interface RawOpenAiBucket<T> {
  start_time?: number | null; // epoch en SEGUNDOS (UTC)
  end_time?: number | null;
  results?: T[] | null;
}

interface RawCompletionsUsageResult {
  input_tokens?: number | null;
  input_cached_tokens?: number | null;
  input_audio_tokens?: number | null;
  output_tokens?: number | null;
  output_audio_tokens?: number | null;
  num_model_requests?: number | null;
  project_id?: string | null;
  user_id?: string | null;
  api_key_id?: string | null;
  model?: string | null;
  batch?: boolean | null;
}

interface RawCostAmount {
  value?: number | null;
  currency?: string | null;
}

interface RawCostResult {
  amount?: RawCostAmount | null;
  line_item?: string | null;
  project_id?: string | null;
  api_key_id?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
}

@Injectable({ providedIn: 'root' })
export class UsageService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  /**
   * Consumo de completions de OpenAI (GET /api/usage/completions).
   * Se aplana el sobre page → bucket → results a una fila por bucket × result.
   */
  getCompletionsUsage(range: UsageDateRange): Observable<CompletionUsage[]> {
    return this.http
      .get<RawOpenAiPage<RawCompletionsUsageResult>>(`${this.apiBaseUrl}/api/usage/completions`, {
        params: this.toParams(range),
      })
      .pipe(
        map((page) =>
          this.flatten(page).map(({ date, result }) => {
            const inputTokens = result.input_tokens ?? 0;
            const outputTokens = result.output_tokens ?? 0;
            return {
              date,
              model: result.model?.trim() || '',
              inputTokens,
              cachedInputTokens: result.input_cached_tokens ?? 0,
              audioInputTokens: result.input_audio_tokens ?? 0,
              outputTokens,
              audioOutputTokens: result.output_audio_tokens ?? 0,
              // OpenAI ya cuenta los tokens cacheados y de audio DENTRO de
              // input_tokens / output_tokens, así que el total es input + output.
              // (En /api/ServiceRequests/tokens, en cambio, el backend entrega su
              // propio total_tokens ya agregado y nunca se deriva de input+output.)
              totalTokens: inputTokens + outputTokens,
              requests: result.num_model_requests ?? 0,
            };
          }),
        ),
      );
  }

  /**
   * Costos de OpenAI (GET /api/usage/costs). El importe vive en amount.value y
   * la moneda en amount.currency: los totales NO se pueden sumar entre monedas
   * distintas, así que eso lo resuelve el componente agrupando por moneda.
   */
  getCosts(range: UsageDateRange): Observable<CostEntry[]> {
    return this.http
      .get<RawOpenAiPage<RawCostResult>>(`${this.apiBaseUrl}/api/usage/costs`, {
        params: this.toParams(range),
      })
      .pipe(
        map((page) =>
          this.flatten(page).map(({ date, result }) => ({
            date,
            lineItem: result.line_item?.trim() || '',
            amount: result.amount?.value ?? 0,
            currency: result.amount?.currency?.trim() || '',
            quantity: result.quantity ?? 0,
            quantityUnit: result.quantity_unit?.trim() || '',
          })),
        ),
      );
  }

  /** Aplana page → bucket → results, resolviendo el día UTC de cada bucket. */
  private flatten<T>(page: RawOpenAiPage<T> | null | undefined): { date: string; result: T }[] {
    const buckets = page?.data ?? [];
    return buckets.flatMap((bucket) => {
      const date = this.toUtcDate(bucket?.start_time);
      return (bucket?.results ?? []).map((result) => ({ date, result }));
    });
  }

  private toParams(range: UsageDateRange): HttpParams {
    let params = new HttpParams().set('start_date', this.toApiDate(range.startDate));
    if (range.endDate) {
      params = params.set('end_date', this.toApiDate(range.endDate));
    }
    return params;
  }

  /** yyyyMMdd, la convención de fechas de query del proyecto (sin guiones). */
  private toApiDate(date: string): string {
    return date.replaceAll('-', '');
  }

  /**
   * Los buckets son de 1 día y arrancan en medianoche UTC, así que el día se lee
   * del epoch en UTC. Ojo con new Date(...).toISOString() vs los getters locales:
   * usar la zona horaria del navegador desplazaría el día y mostraría, por
   * ejemplo, 2026-09-01 como 2026-08-31 en UTC-3.
   */
  private toUtcDate(unixSeconds: number | null | undefined): string {
    if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds)) {
      return '';
    }
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  }
}
