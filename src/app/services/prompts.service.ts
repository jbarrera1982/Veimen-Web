import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';

export interface Prompt {
  promptId: number;
  secuence: number;
  code: string;
  name: string;
  description: string;
  agent: string;
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

interface RawPrompt {
  prompt_id: number;
  secuence: number;
  code: string;
  name: string;
  description: string;
  agent: string;
  agent_group: string;
  type: string;
  llm_model: string;
  version: string;
  system_prompt?: string;
  user_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  active?: boolean;
  observations?: string;
  created_by?: string;
  created_at?: string;
  updated_by?: string;
  updated_at?: string;
  schema_output?: string;
}

function mapPrompt(raw: RawPrompt): Prompt {
  return {
    promptId: raw.prompt_id,
    secuence: raw.secuence,
    code: raw.code,
    name: raw.name,
    description: raw.description,
    agent: raw.agent,
    agentGroup: raw.agent_group,
    type: raw.type,
    llmModel: raw.llm_model,
    version: raw.version,
    systemPrompt: raw.system_prompt ?? '',
    userPrompt: raw.user_prompt ?? '',
    temperature: raw.temperature ?? 0,
    maxTokens: raw.max_tokens ?? 0,
    active: raw.active ?? true,
    observations: raw.observations ?? '',
    createdBy: raw.created_by ?? '',
    createdAt: raw.created_at ?? '',
    updatedBy: raw.updated_by ?? '',
    updatedAt: raw.updated_at ?? '',
    schemaOutput: raw.schema_output ?? '',
  };
}

@Injectable({ providedIn: 'root' })
export class PromptsService {
  private readonly listUrl = 'https://capitalminds.app.n8n.cloud/webhook/prompts-list';
  private readonly detailUrl = 'https://capitalminds.app.n8n.cloud/webhook/prompt-detail';

  constructor(private http: HttpClient) {}

  getPrompts(): Observable<Prompt[]> {
    return this.http.get<RawPrompt[]>(this.listUrl).pipe(map((items) => items.map(mapPrompt)));
  }

  getPrompt(promptId: number): Observable<Prompt> {
    const params = new HttpParams().set('prompt_id', String(promptId));
    return this.http.get<RawPrompt | RawPrompt[]>(this.detailUrl, { params }).pipe(
      map((res) => (Array.isArray(res) ? res[0] : res)),
      map((raw) => mapPrompt(raw)),
    );
  }
}
