import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { STATUS_LABELS } from './dashboard.service';
import { environment } from '../../environments/environment';

export interface RequestItem {
  requestNumber: number;
  channel: string;
  from: string;
  subject: string;
  originalMessage: string;
  receiptDate: string;
  n8nWorkflow: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  otpCode: string | null;
  otpVerifiedAt: string | null;
  detectedIntent: string | null;
}

// La API .NET serializa en camelCase (System.Text.Json por defecto).
interface RawRequestItem {
  requestNumber: number;
  channel: string;
  from: string;
  subject: string;
  originalMessage: string;
  receiptDate: string;
  n8nWorkflow: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  otpCode: string | null;
  otpVerifiedAt: string | null;
  detectedIntent: string | null;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
  statuses?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  // Cliente por el que filtrar (client_id). Ausente = sin filtro ("Todos").
  clientId?: number;
}

export interface RequestsPage {
  items: RequestItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface RawRequestsPage {
  items: RawRequestItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  // La API no devuelve totalPages; si falta se calcula en cliente.
  totalPages?: number;
}

export const STATUS_VALUES: Record<string, string> = {
  Analizado: 'Analyzed',
  Recibido: 'Received',
  Rechazado: 'Rejected',
  Cerrado: 'Closed',
  'Esperando OTP': 'Awaiting OTP',
};

export interface TraceStep {
  traceId: number;
  requestNumber: number;
  sequence: number;
  node: string;
  nodeType: string;
  llmModel: string | null;
  promptVersion: string | null;
  startDate: string;
  endDate: string | null;
  durationMs: number | null;
  status: string;
  confidence: string | null;
  inputJson: string | null;
  outputJson: string | null;
  observations: string | null;
  createdAt: string;
  promptId: number | null;
  promptResult: string | null;
}

// La API .NET serializa en camelCase (System.Text.Json por defecto), igual que RawRequestItem.
// Las columnas JSON (inputJson/outputJson) y confidence se devuelven como string, por convención del proyecto.
// La API también devuelve 'agent', pero no se mapea: la vista de traza identifica cada
// paso por 'node', así que el campo no se usa en ninguna pantalla.
interface RawTraceStep {
  traceId: number;
  requestNumber: number;
  sequence: number;
  node: string;
  nodeType: string;
  llmModel: string | null;
  promptVersion: string | null;
  startDate: string;
  endDate: string | null;
  durationMs: number | null;
  status: string;
  confidence: string | null;
  inputJson: string | null;
  outputJson: string | null;
  observations: string | null;
  createdAt: string;
  promptId: number | null;
  promptResult: string | null;
}

@Injectable({ providedIn: 'root' })
export class RequestsService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  getRequestsList(options: DateRange = {}): Observable<RequestsPage> {
    let params = new HttpParams();
    if (options.startDate) {
      params = params.set('start_date', this.toApiDate(options.startDate));
    }
    if (options.endDate) {
      params = params.set('end_date', this.toApiDate(options.endDate));
    }
    if (options.statuses?.length) {
      for (const status of options.statuses) {
        params = params.append('status', STATUS_VALUES[status] ?? status);
      }
    }
    if (options.search) {
      params = params.set('search', options.search);
    }
    if (options.page) {
      params = params.set('page', String(options.page));
    }
    if (options.pageSize) {
      params = params.set('pageSize', String(options.pageSize));
    }
    if (options.clientId !== undefined) {
      params = params.set('client_id', String(options.clientId));
    }

    return this.http
      .get<RawRequestsPage>(`${this.apiBaseUrl}/api/ServiceRequests`, { params })
      .pipe(
        map((response) => {
          const rawItems = Array.isArray(response?.items) ? response.items : [];
          const items = rawItems.map((item) => ({
            requestNumber: item.requestNumber,
            channel: item.channel,
            from: item.from,
            subject: item.subject,
            originalMessage: item.originalMessage,
            receiptDate: item.receiptDate,
            n8nWorkflow: item.n8nWorkflow,
            status: STATUS_LABELS[item.status?.toLowerCase().trim()] ?? item.status,
            priority: item.priority,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            description: item.description,
            otpCode: item.otpCode,
            otpVerifiedAt: item.otpVerifiedAt,
            detectedIntent: item.detectedIntent,
          }));
          const page = response?.page ?? options.page ?? 1;
          const pageSize = response?.pageSize ?? options.pageSize ?? items.length;
          const totalCount = response?.totalCount ?? items.length;
          const totalPages =
            response?.totalPages ?? (pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0);
          return { items, totalCount, page, pageSize, totalPages };
        }),
      );
  }

  getRequestTrace(requestNumber: number): Observable<TraceStep[]> {
    let params = new HttpParams().set('request_number', String(requestNumber));
    return this.http
      .get<RawTraceStep[]>(`${this.apiBaseUrl}/api/ServiceRequests/trace`, { params })
      .pipe(
        map((items) =>
          items.map((item) => ({
            traceId: item.traceId,
            requestNumber: item.requestNumber,
            sequence: item.sequence,
            node: item.node,
            nodeType: item.nodeType,
            llmModel: item.llmModel,
            promptVersion: item.promptVersion,
            startDate: item.startDate,
            endDate: item.endDate,
            durationMs: item.durationMs,
            status: item.status,
            confidence: item.confidence,
            inputJson: item.inputJson,
            outputJson: item.outputJson,
            observations: item.observations,
            createdAt: item.createdAt,
            promptId: item.promptId,
            promptResult: item.promptResult,
          })),
        ),
      );
  }

  // Dispara el informe de auditoría de una solicitud a través de la API: el backend llama
  // al webhook de n8n (la URL queda oculta al navegador) y toma el email del usuario del token.
  auditRequest(requestNumber: number): Observable<unknown> {
    const params = new HttpParams().set('request_number', String(requestNumber));
    return this.http.post(`${this.apiBaseUrl}/api/ServiceRequests/audit`, null, { params });
  }

  private toApiDate(date: string): string {
    return date.replaceAll('-', '');
  }
}
