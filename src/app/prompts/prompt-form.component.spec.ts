import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { PromptFormComponent } from './prompt-form.component';
import { PromptsService } from '../services/prompts.service';

const DETAIL_URL = 'https://capitalminds.app.n8n.cloud/webhook/prompt-detail';

function prompt(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt_id: 1,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención',
    agent: 'Agente 1 - Intención',
    agent_group: 'Intake',
    type: 'System',
    llm_model: 'GPT-5.5',
    version: '1.0.0',
    system_prompt: 'Eres un agente.',
    user_prompt: 'Analiza.',
    temperature: 0.2,
    max_tokens: 2048,
    active: true,
    observations: 'Principal',
    created_by: 'admin',
    created_at: '2026-09-01 10:00:00',
    updated_by: 'admin',
    updated_at: '2026-09-02 11:00:00',
    schema_output: '{}',
    ...partial,
  };
}

describe('PromptFormComponent', () => {
  let httpTesting: HttpTestingController;
  const route = {
    snapshot: {
      paramMap: {
        get: (_name: string) => null as string | null,
      },
    },
  };
  const state = { id: null as string | null };

  beforeEach(() => {
    state.id = null;
    route.snapshot.paramMap.get = (key: string) => (key === 'id' ? state.id : null);

    TestBed.configureTestingModule({
      imports: [PromptFormComponent],
      providers: [
        PromptsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: route },
      ],
    });

    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function createFixture(): any {
    return TestBed.createComponent(PromptFormComponent);
  }

  it('should build an empty form for a new prompt', () => {
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.isEdit()).toBeFalsy();
    expect(component.form.get('name')?.value).toBe('');
    expect(component.form.get('active')?.value).toBe(true);
    expect(component.form.get('promptId')?.value).toBe(0);
  });

  it('should be invalid when required fields are missing', () => {
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.get('name')?.setValue('');
    expect(component.form.valid).toBeFalsy();

    component.form.patchValue({
      name: 'Nombre',
      code: 'P-001',
      agent: 'Agente',
      type: 'System',
      llmModel: 'GPT-5.5',
      version: '1.0.0',
      systemPrompt: 'Eres un agente.',
      maxTokens: 512,
    });
    expect(component.form.valid).toBeTruthy();
  });

  it('should reject temperatures outside the allowed range', () => {
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.patchValue({
      name: 'Nombre',
      code: 'P-001',
      agent: 'Agente',
      type: 'System',
      llmModel: 'GPT-5.5',
      version: '1.0.0',
      systemPrompt: 'Eres un agente.',
    });

    component.form.get('temperature')?.setValue(5);
    expect(component.form.get('temperature')?.valid).toBeFalsy();

    component.form.get('temperature')?.setValue(0.5);
    expect(component.form.get('temperature')?.valid).toBeTruthy();
  });

  it('should reject max_tokens below one', () => {
    const component = createFixture().componentInstance;
    component.form.get('maxTokens')?.setValue(0);
    expect(component.form.get('maxTokens')?.valid).toBeFalsy();

    component.form.get('maxTokens')?.setValue(512);
    expect(component.form.get('maxTokens')?.valid).toBeTruthy();
  });

  it('should load the prompt by id from the route and patch the form', () => {
    state.id = '5';
    const item = prompt();
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === DETAIL_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('prompt_id')).toBe('5');
    req.flush(item);

    expect(component.isEdit()).toBeTruthy();
    expect(component.form.get('name')?.value).toBe('Extracto de intención');
    expect(component.form.get('systemPrompt')?.value).toBe('Eres un agente.');
    expect(component.form.get('maxTokens')?.value).toBe(2048);
    expect(component.form.get('promptId')?.value).toBe(1);
  });

  it('should not call the webhook for the "nuevo" route', () => {
    state.id = 'nuevo';
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isEdit()).toBeFalsy();
  });

  it('should set an error when loading the prompt fails', () => {
    state.id = '9';
    const fixture = createFixture();
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === DETAIL_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBeFalsy();
  });
});
