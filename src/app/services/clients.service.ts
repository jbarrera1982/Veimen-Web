import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Client {
  clientId: number;
  name: string;
  inboundEmail: string;
  outboundEmail: string;
  analystEmail: string;
  openAIApiKey: string;
  active: boolean;
}

/**
 * Cuerpo que envía el formulario al guardar (POST/PUT). Los campos opcionales pueden
 * venir null: así lo acepta el modelo del backend (solo `name` es obligatorio).
 */
export interface ClientPayload {
  clientId: number | null;
  name: string | null;
  inboundEmail: string | null;
  outboundEmail: string | null;
  analystEmail: string | null;
  openAIApiKey: string | null;
  active: boolean | null;
}

// Forma camelCase en la que la API serializa el modelo Client (columnas opcionales anulables).
interface ApiClient {
  clientId: number;
  name?: string | null;
  inboundEmail?: string | null;
  outboundEmail?: string | null;
  analystEmail?: string | null;
  openAIApiKey?: string | null;
  active?: boolean | null;
}

// La API devuelve campos anulables; el resto de la app trabaja con el Client no anulable.
function normalizeClient(raw: ApiClient): Client {
  return {
    clientId: raw.clientId,
    name: raw.name ?? '',
    inboundEmail: raw.inboundEmail ?? '',
    outboundEmail: raw.outboundEmail ?? '',
    analystEmail: raw.analystEmail ?? '',
    openAIApiKey: raw.openAIApiKey ?? '',
    active: raw.active ?? true,
  };
}

// Los opcionales vacíos van como null: un email vacío fallaría la validación [EmailAddress]
// del backend, y el nombre nunca debe ir null.
function toRequestBody(payload: ClientPayload): ClientPayload {
  const optional = (value: string | null): string | null => {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  };

  return {
    clientId: payload.clientId ?? 0,
    name: payload.name?.trim() ?? '',
    inboundEmail: optional(payload.inboundEmail),
    outboundEmail: optional(payload.outboundEmail),
    analystEmail: optional(payload.analystEmail),
    openAIApiKey: optional(payload.openAIApiKey),
    active: payload.active ?? true,
  };
}

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/clients`;

  // Requiere el permiso clients.read.
  getClients(): Observable<Client[]> {
    return this.http
      .get<ApiClient[]>(this.baseUrl)
      .pipe(map((items) => items.map(normalizeClient)));
  }

  getClient(clientId: number): Observable<Client> {
    return this.http.get<ApiClient>(`${this.baseUrl}/${clientId}`).pipe(map(normalizeClient));
  }

  // Requiere el permiso clients.write. Devuelve el cliente recién creado (201).
  createClient(payload: ClientPayload): Observable<Client> {
    return this.http
      .post<ApiClient>(this.baseUrl, toRequestBody(payload))
      .pipe(map(normalizeClient));
  }

  // Requiere clients.write. El id de la ruta debe coincidir con el del cuerpo (204).
  updateClient(clientId: number, payload: ClientPayload): Observable<void> {
    const body = toRequestBody({ ...payload, clientId });
    return this.http.put<void>(`${this.baseUrl}/${clientId}`, body);
  }

  // Requiere clients.write. Borrado lógico: el backend marca deleted = 1 (204).
  deleteClient(clientId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${clientId}`);
  }
}
