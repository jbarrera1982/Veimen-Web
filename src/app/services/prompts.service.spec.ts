import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { Prompt, PromptPayload, PromptsService } from './prompts.service';

const API = environment.apiBaseUrl;
const LIST_URL = `${API}/api/prompts`;

function apiPrompt(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    promptId: 1,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención del correo.',
    agentGroup: 'Intake',
    type: 'System',
    llmModel: 'GPT-5.5',
    version: '1.0.0',
    systemPrompt: 'Eres un agente que extrae intenciones.',
    userPrompt: 'Analiza el siguiente correo.',
    temperature: 0.2,
    maxTokens: 2048,
    active: true,
    observations: 'Prompt principal',
    createdBy: 'admin',
    createdAt: '2026-09-01T10:00:00',
    updatedBy: 'admin',
    updatedAt: '2026-09-02T11:00:00',
    schemaOutput: '{"intent": "string"}',
    ...partial,
  };
}

function mappedPrompt(partial: Partial<Prompt> = {}): Prompt {
  return {
    promptId: 1,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención del correo.',
    agentGroup: 'Intake',
    type: 'System',
    llmModel: 'GPT-5.5',
    version: '1.0.0',
    systemPrompt: 'Eres un agente que extrae intenciones.',
    userPrompt: 'Analiza el siguiente correo.',
    temperature: 0.2,
    maxTokens: 2048,
    active: true,
    observations: 'Prompt principal',
    createdBy: 'admin',
    createdAt: '2026-09-01T10:00:00',
    updatedBy: 'admin',
    updatedAt: '2026-09-02T11:00:00',
    schemaOutput: '{"intent": "string"}',
    ...partial,
  };
}

function payload(partial: Partial<PromptPayload> = {}): PromptPayload {
  return {
    promptId: 0,
    secuence: 1,
    code: 'P-002',
    name: 'Nueva respuesta',
    description: '',
    agentGroup: 'Ventas',
    type: 'System',
    llmModel: 'GPT-5.5',
    version: '1.0',
    systemPrompt: 'Eres un agente.',
    userPrompt: '',
    temperature: 0.2,
    maxTokens: null,
    active: true,
    observations: '',
    createdBy: 'tester',
    createdAt: '',
    updatedBy: 'tester',
    updatedAt: '',
    schemaOutput: '',
    ...partial,
  };
}

describe('PromptsService', () => {
  let service: PromptsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PromptsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should fetch the list from the API', () => {
    let result: Prompt[] | undefined;
    service.getPrompts().subscribe((items) => (result = items));

    const req = httpTesting.expectOne(LIST_URL);
    expect(req.request.method).toBe('GET');
    req.flush([apiPrompt()]);

    expect(result).toEqual([mappedPrompt()]);
  });

  it('should default optional fields when the API omits them', () => {
    let result: Prompt[] | undefined;
    service.getPrompts().subscribe((items) => (result = items));

    const req = httpTesting.expectOne(LIST_URL);
    req.flush([
      {
        promptId: 2,
        secuence: null,
        code: 'P-002',
        name: 'Respuesta',
        agentGroup: 'Ventas',
        version: '1.0',
        systemPrompt: 'Eres un agente.',
      },
    ]);

    expect(result?.[0]).toMatchObject({
      description: '',
      type: '',
      llmModel: '',
      userPrompt: '',
      temperature: 0,
      maxTokens: 0,
      active: true,
      observations: '',
      createdAt: '',
      schemaOutput: '',
    });
  });

  it('should fetch a single prompt by id', () => {
    let result: Prompt | undefined;
    service.getPrompt(7).subscribe((prompt) => (result = prompt));

    const req = httpTesting.expectOne(`${LIST_URL}/7`);
    expect(req.request.method).toBe('GET');
    req.flush(apiPrompt({ promptId: 7 }));

    expect(result?.promptId).toBe(7);
    expect(result?.systemPrompt).toBe('Eres un agente que extrae intenciones.');
  });

  it('should post the new prompt and normalize empty dates to null', () => {
    let result: Prompt | undefined;
    service.createPrompt(payload()).subscribe((prompt) => (result = prompt));

    const req = httpTesting.expectOne(LIST_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      promptId: 0,
      code: 'P-002',
      agentGroup: 'Ventas',
      maxTokens: null,
      createdBy: 'tester',
      updatedBy: 'tester',
      createdAt: null,
      updatedAt: null,
    });
    req.flush(apiPrompt({ promptId: 9, code: 'P-002' }));

    expect(result?.promptId).toBe(9);
  });

  it('should put the update to /api/prompts/{id} with the route id in the body', () => {
    let completed = false;
    service
      .updatePrompt(7, payload({ promptId: 1, createdAt: '2026-09-01 10:00:00' }))
      .subscribe(() => (completed = true));

    const req = httpTesting.expectOne(`${LIST_URL}/7`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({
      promptId: 7,
      code: 'P-002',
      createdBy: 'tester',
      // El formato del webhook (con espacio) se convierte a ISO 8601.
      createdAt: '2026-09-01T10:00:00',
      updatedAt: null,
    });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });
});
