import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { PromptFormComponent } from './prompt-form.component';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;
const LIST_URL = `${API}/api/prompts`;
const detailUrl = (id: number | string) => `${API}/api/prompts/${id}`;

function apiPrompt(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    promptId: 5,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención',
    agentGroup: 'Intake',
    type: 'System',
    llmModel: 'GPT-5.5',
    version: '1.0.0',
    systemPrompt: 'Eres un agente.',
    userPrompt: 'Analiza.',
    temperature: 0.2,
    maxTokens: 2048,
    active: true,
    observations: 'Principal',
    createdBy: 'admin',
    createdAt: '2026-09-01T10:00:00',
    updatedBy: 'admin',
    updatedAt: '2026-09-02T11:00:00',
    schemaOutput: '{}',
    ...partial,
  };
}

describe('PromptFormComponent', () => {
  let httpTesting: HttpTestingController;

  async function setup(id: string | null) {
    await TestBed.configureTestingModule({
      imports: [PromptFormComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } },
    });

    TestBed.inject(AuthService).currentUser.set({
      userId: 1,
      username: 'tester',
      email: 'tester@veimen.net',
      fullName: null,
      active: true,
      lastLoginAt: null,
    });

    httpTesting = TestBed.inject(HttpTestingController);
    return TestBed.createComponent(PromptFormComponent);
  }

  afterEach(() => {
    httpTesting.verify();
  });

  // Rellena todo lo que el backend exige (además de agentGroup, obligatorio en la API).
  function fillRequired(fixture: { componentInstance: PromptFormComponent }): void {
    fixture.componentInstance.form.patchValue({
      code: 'P-002',
      name: 'Nueva respuesta',
      agentGroup: 'Ventas',
      type: 'System',
      llmModel: 'GPT-5.5',
      version: '1.0',
      systemPrompt: 'Eres un agente.',
    });
  }

  it('should build an empty form for a new prompt', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.isEdit()).toBeFalsy();
    expect(component.form.get('name')?.value).toBe('');
    expect(component.form.get('active')?.value).toBe(true);
    expect(component.form.get('promptId')?.value).toBe(0);
    expect(component.form.get('maxTokens')?.value).toBeNull();
  });

  it('should be invalid when required fields are missing', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.get('name')?.setValue('');
    expect(component.form.valid).toBeFalsy();

    fillRequired(fixture);
    expect(component.form.valid).toBeTruthy();
  });

  it('should reject temperatures outside the allowed range', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    fillRequired(fixture);

    component.form.get('temperature')?.setValue(5);
    expect(component.form.get('temperature')?.valid).toBeFalsy();

    component.form.get('temperature')?.setValue(0.5);
    expect(component.form.get('temperature')?.valid).toBeTruthy();
  });

  it('should reject max_tokens below one but accept an empty value', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    fillRequired(fixture);

    component.form.get('maxTokens')?.setValue(0);
    expect(component.form.get('maxTokens')?.valid).toBeFalsy();

    component.form.get('maxTokens')?.setValue(512);
    expect(component.form.get('maxTokens')?.valid).toBeTruthy();

    component.form.get('maxTokens')?.setValue(null);
    expect(component.form.get('maxTokens')?.valid).toBeTruthy();
    expect(component.form.valid).toBeTruthy();
  });

  it('should load the prompt by id from the API and patch the form', async () => {
    const fixture = await setup('5');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const req = httpTesting.expectOne(detailUrl(5));
    expect(req.request.method).toBe('GET');
    req.flush(apiPrompt());

    expect(component.isEdit()).toBeTruthy();
    expect(component.form.get('name')?.value).toBe('Extracto de intención');
    expect(component.form.get('systemPrompt')?.value).toBe('Eres un agente.');
    expect(component.form.get('maxTokens')?.value).toBe(2048);
    expect(component.form.get('promptId')?.value).toBe(5);
  });

  it('should treat a prompt without max tokens as unlimited', async () => {
    const fixture = await setup('5');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    httpTesting.expectOne(detailUrl(5)).flush(apiPrompt({ maxTokens: 0 }));

    expect(component.form.get('maxTokens')?.value).toBeNull();
    expect(component.form.valid).toBeTruthy();
  });

  it('should not call the API for the "nuevo" route', async () => {
    const fixture = await setup('nuevo');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isEdit()).toBeFalsy();
    httpTesting.expectNone(() => true);
  });

  it('should set an error when loading the prompt fails', async () => {
    const fixture = await setup('9');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    httpTesting
      .expectOne(detailUrl(9))
      .flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBeFalsy();
  });

  it('should create the prompt and navigate back to the list', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fillRequired(fixture);
    component.save();

    const req = httpTesting.expectOne((r) => r.url === LIST_URL && r.method === 'POST');
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

    expect(navigateSpy).toHaveBeenCalledWith(['/prompts']);
    expect(component.isSaving()).toBe(false);
    expect(component.saveError()).toBeNull();
  });

  it('should update the prompt through PUT and navigate back to the list', async () => {
    const fixture = await setup('5');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    httpTesting.expectOne(detailUrl(5)).flush(apiPrompt());

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.save();

    const req = httpTesting.expectOne((r) => r.url === detailUrl(5) && r.method === 'PUT');
    expect(req.request.body).toMatchObject({
      promptId: 5,
      code: 'P-001',
      // Se preserva la auditoría original y el editor es el usuario logueado.
      createdBy: 'admin',
      createdAt: '2026-09-01T10:00:00',
      updatedBy: 'tester',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(navigateSpy).toHaveBeenCalledWith(['/prompts']);
    expect(component.isSaving()).toBe(false);
  });

  it('should not send anything when the form is invalid', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.save();

    expect(component.form.invalid).toBe(true);
    expect(component.isSaving()).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
    httpTesting.expectNone(() => true);
  });

  it('should keep the form open and show an error when the save fails', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fillRequired(fixture);
    component.save();

    httpTesting
      .expectOne((r) => r.url === LIST_URL && r.method === 'POST')
      .flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.saveError()).toBe('Ocurrió un error. Inténtalo de nuevo.');
    expect(component.isSaving()).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should list the rejected fields when the API answers 400', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    fillRequired(fixture);
    component.save();

    httpTesting
      .expectOne((r) => r.url === LIST_URL && r.method === 'POST')
      .flush(
        { errors: { agentGroup: ['The AgentGroup field is required.'] } },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(component.saveError()).toBe('Revisa estos campos: agentGroup.');
    expect(component.isSaving()).toBe(false);
  });

  it('should disable the save button until the form is valid', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-primary');
    expect(button.disabled).toBe(true);

    fillRequired(fixture);
    fixture.detectChanges();

    expect(button.disabled).toBe(false);
    expect(component.form.valid).toBe(true);
  });
});
