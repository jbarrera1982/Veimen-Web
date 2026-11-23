import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Caso completo del dataset de evaluación de correos (detalle del formulario).
export interface EmailEvaluationCase {
  // Clave autonumérica asignada por la base.
  id: number;
  scenario: string;
  from: string;
  subject: string;
  // HTML original del correo (así lo espera el webhook como body_html).
  content: string;
  clientId: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

// Fila del listado: el backend omite el HTML completo y envía un preview en texto plano.
export interface EmailEvaluationCaseListItem {
  id: number;
  scenario: string;
  from: string;
  subject: string;
  contentPreview: string;
  clientId: number;
  createdAt: string;
  updatedAt: string;
}

// Forma paginada que devuelve GET /api/email-evaluation-dataset (PagedResult camelCase).
export interface EmailEvaluationCasesPage {
  items: EmailEvaluationCaseListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface EmailEvaluationCaseQuery {
  clientId?: number | null;
  scenario?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

// Cuerpo de POST/PUT: el backend completa la auditoría y el id a partir de la ruta/base.
export interface EmailEvaluationCasePayload {
  scenario: string;
  from: string;
  subject: string | null;
  content: string | null;
  clientId: number | null;
}

interface ApiCase {
  id: number;
  scenario?: string | null;
  from?: string | null;
  subject?: string | null;
  content?: string | null;
  clientId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
}

interface ApiCaseListItem {
  id: number;
  scenario?: string | null;
  from?: string | null;
  subject?: string | null;
  contentPreview?: string | null;
  clientId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface ApiCasePage {
  items?: ApiCaseListItem[] | null;
  totalCount?: number | null;
  page?: number | null;
  pageSize?: number | null;
}

function normalizeCase(raw: ApiCase): EmailEvaluationCase {
  return {
    id: raw.id,
    scenario: raw.scenario ?? '',
    from: raw.from ?? '',
    subject: raw.subject ?? '',
    content: raw.content ?? '',
    clientId: raw.clientId ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
    createdBy: raw.createdBy ?? '',
    updatedBy: raw.updatedBy ?? '',
  };
}

function normalizeListItem(raw: ApiCaseListItem): EmailEvaluationCaseListItem {
  return {
    id: raw.id,
    scenario: raw.scenario ?? '',
    from: raw.from ?? '',
    subject: raw.subject ?? '',
    contentPreview: raw.contentPreview ?? '',
    clientId: raw.clientId ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
  };
}

@Injectable({ providedIn: 'root' })
export class EmailEvaluationDatasetService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/email-evaluation-dataset`;

  // Listado paginado (permiso email-evaluation.read). `null` = sin filtro ("Todos").
  getCases(query: EmailEvaluationCaseQuery = {}): Observable<EmailEvaluationCasesPage> {
    let params = new HttpParams();

    if (query.clientId != null) {
      params = params.set('client_id', query.clientId);
    }
    if (query.scenario) {
      params = params.set('scenario', query.scenario);
    }
    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }

    params = params.set('page', query.page ?? 1).set('pageSize', query.pageSize ?? 20);

    return this.http.get<ApiCasePage>(this.baseUrl, { params }).pipe(
      map((page) => ({
        items: (page.items ?? []).map(normalizeListItem),
        totalCount: page.totalCount ?? 0,
        page: page.page ?? 1,
        pageSize: page.pageSize ?? query.pageSize ?? 20,
      })),
    );
  }

  // Escenarios distintos para el selector del filtro (permiso email-evaluation.read).
  getScenarios(clientId: number | null = null): Observable<string[]> {
    const params = clientId == null ? undefined : new HttpParams().set('client_id', clientId);

    return this.http.get<string[]>(`${this.baseUrl}/scenarios`, { params });
  }

  getCase(id: number): Observable<EmailEvaluationCase> {
    return this.http.get<ApiCase>(`${this.baseUrl}/${id}`).pipe(map(normalizeCase));
  }

  // Requiere email-evaluation.write. Devuelve el caso creado (201) con su id.
  createCase(payload: EmailEvaluationCasePayload): Observable<EmailEvaluationCase> {
    return this.http.post<ApiCase>(this.baseUrl, payload).pipe(map(normalizeCase));
  }

  // Requiere email-evaluation.write. El id identifica la fila (204).
  updateCase(id: number, payload: EmailEvaluationCasePayload): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/${id}`, payload);
  }

  // Requiere email-evaluation.write. Borrado lógico (204).
  deleteCase(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // Envía el caso al webhook de n8n y devuelve la respuesta del flujo. El backend puede
  // responder JSON o texto plano, así que se lee como texto y se intenta parsear.
  evaluateCase(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/${id}/evaluate`, null, { responseType: 'text' }).pipe(
      map((text) => {
        const trimmed = text?.trim() ?? '';
        if (!trimmed) {
          return null;
        }
        try {
          return JSON.parse(trimmed) as unknown;
        } catch {
          return trimmed;
        }
      }),
    );
  }
}
