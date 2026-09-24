import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PromptsService, Prompt } from './prompts.service';

const LIST_URL = 'https://capitalminds.app.n8n.cloud/webhook/prompts-list';
const DETAIL_URL = 'https://capitalminds.app.n8n.cloud/webhook/prompt-detail';

function rawPrompt(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt_id: 1,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención del correo.',
    agent: 'Agente 1 - Intención',
    agent_group: 'Intake',
    type: 'System',
    llm_model: 'GPT-5.5',
    version: '1.0.0',
    system_prompt: 'Eres un agente que extrae intenciones.',
    user_prompt: 'Analiza el siguiente correo.',
    temperature: 0.2,
    max_tokens: 2048,
    active: true,
    observations: 'Prompt principal',
    created_by: 'admin',
    created_at: '2026-09-01 10:00:00',
    updated_by: 'admin',
    updated_at: '2026-09-02 11:00:00',
    schema_output: '{"intent": "string"}',
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

  it('should map snake_case fields from the list webhook', () => {
    let result: Prompt[] | undefined;
    service.getPrompts().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === LIST_URL);
    expect(req.request.method).toBe('GET');
    req.flush([rawPrompt()]);

    expect(result).toEqual([
      {
        promptId: 1,
        secuence: 1,
        code: 'P-001',
        name: 'Extracto de intención',
        description: 'Extrae la intención del correo.',
        agent: 'Agente 1 - Intención',
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
        createdAt: '2026-09-01 10:00:00',
        updatedBy: 'admin',
        updatedAt: '2026-09-02 11:00:00',
        schemaOutput: '{"intent": "string"}',
      },
    ]);
  });

  it('should default optional extended fields when missing', () => {
    let result: Prompt[] | undefined;
    service.getPrompts().subscribe((items) => (result = items));

    const req = httpTesting.expectOne((r) => r.url === LIST_URL);
    req.flush([
      {
        prompt_id: 2,
        secuence: 2,
        code: 'P-002',
        name: 'Respuesta',
        description: '',
        agent: 'Agente 2',
        agent_group: 'Ventas',
        type: 'User',
        llm_model: 'GPT-5.5',
        version: '1.0.0',
      },
    ]);

    expect(result?.[0]).toMatchObject({
      systemPrompt: '',
      userPrompt: '',
      temperature: 0,
      maxTokens: 0,
      active: true,
      schemaOutput: '',
      createdAt: '',
    });
  });

  it('should fetch a single prompt by id', () => {
    let result: Prompt | undefined;
    service.getPrompt(7).subscribe((prompt) => (result = prompt));

    const req = httpTesting.expectOne((r) => r.url === DETAIL_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('prompt_id')).toBe('7');
    req.flush(rawPrompt({ prompt_id: 7 }));

    expect(result?.promptId).toBe(7);
    expect(result?.systemPrompt).toBe('Eres un agente que extrae intenciones.');
  });

  it('should pick the first item when the detail webhook returns an array', () => {
    let result: Prompt | undefined;
    service.getPrompt(3).subscribe((prompt) => (result = prompt));

    const req = httpTesting.expectOne((r) => r.url === DETAIL_URL);
    req.flush([rawPrompt({ prompt_id: 3 }), rawPrompt({ prompt_id: 4 })]);

    expect(result?.promptId).toBe(3);
  });
});
