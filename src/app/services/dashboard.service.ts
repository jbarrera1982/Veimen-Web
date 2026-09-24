import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export const STATUS_LABELS: Record<string, string> = {
  analyzed: 'Analizado',
  received: 'Recibido',
  rejected: 'Rechazado',
  closed: 'Cerrado',
  'awaiting otp': 'Esperando OTP',
};

export interface StatusCount {
  status: string;
  date: string; // YYYY-MM-DD
  total: number;
}

interface RawStatusCount {
  status: string;
  total: number;
  receipt_date?: string;
  date?: string;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  getStatusByStatus(options: DateRange = {}): Observable<StatusCount[]> {
    let params = new HttpParams();
    if (options.startDate) {
      params = params.set('start_date', this.toApiDate(options.startDate));
    }
    if (options.endDate) {
      params = params.set('end_date', this.toApiDate(options.endDate));
    }

    return this.http
      .get<RawStatusCount[]>(`${this.apiBaseUrl}/api/ServiceRequests/dashboard`, { params })
      .pipe(
        map((items) =>
          items.map((item) => ({
            status: STATUS_LABELS[item.status.toLowerCase().trim()] ?? item.status,
            // La API devuelve un datetime ISO (ej: 2026-09-04T00:00:00); nos quedamos con la fecha.
            date: (item.receipt_date ?? item.date ?? '').slice(0, 10),
            total: item.total,
          })),
        ),
      );
  }

  private toApiDate(date: string): string {
    return date.replaceAll('-', '');
  }
}
