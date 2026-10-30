import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { DateRange } from './dashboard.service';

export interface MailComparison {
  date: string; // YYYY-MM-DD
  mails: number;
  requests: number;
}

// La API .NET serializa en camelCase (System.Text.Json por defecto) y devuelve
// la fecha como YYYYMMDD (ej: "20261020"). El resto de la app trabaja con
// YYYY-MM-DD, así que se normaliza en el servicio.
interface RawMailComparison {
  date: string | null;
  mails: number | null;
  requests: number | null;
}

@Injectable({ providedIn: 'root' })
export class MailService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  // Comparativa diaria de correos recibidos vs requerimientos generados.
  // Filtra por cliente en los dos lados (correos y requerimientos): `clientId` ausente
  // = sin filtro ("Todos").
  getComparison(options: DateRange = {}): Observable<MailComparison[]> {
    let params = new HttpParams();
    if (options.startDate) {
      params = params.set('start_date', this.toApiDate(options.startDate));
    }
    if (options.endDate) {
      params = params.set('end_date', this.toApiDate(options.endDate));
    }
    if (options.clientId !== undefined && options.clientId !== null) {
      params = params.set('client_id', options.clientId);
    }

    return this.http
      .get<RawMailComparison[]>(`${this.apiBaseUrl}/api/mail/comparison`, { params })
      .pipe(
        map((items) =>
          (items ?? []).map((item) => ({
            date: this.normalizeDate(item.date),
            mails: item.mails ?? 0,
            requests: item.requests ?? 0,
          })),
        ),
      );
  }

  private toApiDate(date: string): string {
    return date.replaceAll('-', '');
  }

  /** "20261020" → "2026-10-20"; un ISO ya normalizado se recorta a la fecha. */
  private normalizeDate(value: string | null): string {
    const raw = (value ?? '').trim();
    if (/^\d{8}$/.test(raw)) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    return raw.slice(0, 10);
  }
}
