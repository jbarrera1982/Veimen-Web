import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Prompt {
  promptId: number;
  secuence: number;
  code: string;
  name: string;
  description: string;
  agentGroup: string;
  type: string;
  llmModel: string;
  version: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  active: boolean;
  observations: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  schemaOutput: string;
}

/**
 * Cuerpo que envía el formulario al guardar (POST/PUT). Todos los campos pueden venir
 * null: así lo infiere el FormBuilder por defecto y así lo acepta el modelo del backend
 * (solo code, name, agentGroup, version y systemPrompt son obligatorios).
 */
export interface PromptPayload {
  promptId: number | null;
  secuence: number | null;
  code: string | null;
  name: string | null;
  description: string | null;
  agentGroup: string | null;
  type: string | null;
  llmModel: string | null;
  version: string | null;
  systemPrompt: string | null;
  userPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  active: boolean | null;
  observations: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  schemaOutput: string | null;
}

/**
 * Forma camelCase en la que la API serializa el modelo Prompt. Casi todos los campos del
 * backend son anulables (son columnas opcionales de la tabla `prompt`).
 */
interface ApiPrompt {
  promptId: number;
  secuence?: number | null;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  agentGroup?: string | null;
  type?: string | null;
  llmModel?: string | null;
  version?: string | null;
  systemPrompt?: string | null;
  userPrompt?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  active?: boolean | null;
  observations?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  schemaOutput?: string | null;
}

// La API devuelve campos anulables; el resto de la app trabaja con el Prompt no anulable
// de arriba, así que aquí se aplican los mismos defaults que tenía el webhook de n8n.
function normalizePrompt(raw: ApiPrompt): Prompt {
  return {
    promptId: raw.promptId,
    secuence: raw.secuence ?? 0,
    code: raw.code ?? '',
    name: raw.name ?? '',
    description: raw.description ?? '',
    agentGroup: raw.agentGroup ?? '',
    type: raw.type ?? '',
    llmModel: raw.llmModel ?? '',
    version: raw.version ?? '',
    systemPrompt: raw.systemPrompt ?? '',
    userPrompt: raw.userPrompt ?? '',
    temperature: raw.temperature ?? 0,
    maxTokens: raw.maxTokens ?? 0,
    active: raw.active ?? true,
    observations: raw.observations ?? '',
    createdBy: raw.createdBy ?? '',
    createdAt: raw.createdAt ?? '',
    updatedBy: raw.updatedBy ?? '',
    updatedAt: raw.updatedAt ?? '',
    schemaOutput: raw.schemaOutput ?? '',
  };
}

// System.Text.Json solo acepta fechas ISO 8601 (con 'T'); 'YYYY-MM-DD HH:mm:ss' daría 400
// y un valor vacío rompería el bind de DateTime?.
function toIso(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
}

function toRequestBody(payload: PromptPayload): PromptPayload {
  return {
    ...payload,
    promptId: payload.promptId ?? 0,
    active: payload.active ?? true,
    createdAt: toIso(payload.createdAt),
    updatedAt: toIso(payload.updatedAt),
  };
}

@Injectable({ providedIn: 'root' })
export class PromptsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/prompts`;

  constructor(private http: HttpClient) {}

  getPrompts(): Observable<Prompt[]> {
    return this.http
      .get<ApiPrompt[]>(this.baseUrl)
      .pipe(map((items) => items.map(normalizePrompt)));
  }

  getPrompt(promptId: number): Observable<Prompt> {
    return this.http.get<ApiPrompt>(`${this.baseUrl}/${promptId}`).pipe(map(normalizePrompt));
  }

  // Requiere el permiso prompts.write. Devuelve el prompt recién creado (201).
  createPrompt(payload: PromptPayload): Observable<Prompt> {
    return this.http
      .post<ApiPrompt>(this.baseUrl, toRequestBody(payload))
      .pipe(map(normalizePrompt));
  }

  // Requiere el permiso prompts.write. El id de la ruta debe coincidir con el del cuerpo (204).
  updatePrompt(promptId: number, payload: PromptPayload): Observable<void> {
    const body = toRequestBody({ ...payload, promptId });
    return this.http.put<void>(`${this.baseUrl}/${promptId}`, body);
  }

  // Requiere prompts.write. Borrado lógico: el backend marca deleted = 1 (204).
  deletePrompt(promptId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${promptId}`);
  }
}
