import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { PromptsListComponent } from './prompts-list.component';
import { PromptsService, Prompt } from '../services/prompts.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';

const API_URL = 'https://capitalminds.app.n8n.cloud/webhook/prompts-list';

function rawPrompt(partial: Record<string, unknown> = {}): Record<string, unknown> {
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

function mappedPrompt(partial: Partial<Prompt> = {}): Prompt {
  return {
    promptId: 1,
    secuence: 1,
    code: 'P-001',
    name: 'Extracto de intención',
    description: 'Extrae la intención',
    agent: 'Agente 1 - Intención',
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
    createdAt: '2026-09-01 10:00:00',
    updatedBy: 'admin',
    updatedAt: '2026-09-02 11:00:00',
    schemaOutput: '{}',
    ...partial,
  };
}

describe('PromptsListComponent', () => {
  let component: PromptsListComponent;
  let fixture: any;
  let httpTesting: HttpTestingController;
  const navigate = vi.fn();

  beforeEach(async () => {
    navigate.mockClear();

    await TestBed.configureTestingModule({
      imports: [PromptsListComponent],
      providers: [
        PromptsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);

    // La mayoría de los tests asumen un usuario con permiso de escritura de prompts.
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead, PERMISSIONS.promptsWrite]);
    permissions.loaded.set(true);

    fixture = TestBed.createComponent(PromptsListComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpTesting.verify();
  });

  function flushResponse(data: Record<string, unknown>[]): void {
    const req = httpTesting.expectOne((r) => r.url === API_URL);
    expect(req.request.method).toBe('GET');
    req.flush(data);
  }

  function setSearch(value: string): void {
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.search-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function selectFilter(index: number, value: string): void {
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelectorAll('select.filter-select')[index];
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load prompts from the webhook', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt()]);

    expect(component.prompts()).toEqual([mappedPrompt()]);
    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeNull();
  });

  it('should sort by group, then secuence, then active first by default', () => {
    fixture.detectChanges();
    flushResponse([
      rawPrompt({ prompt_id: 1, agent_group: 'Intake', secuence: 2 }),
      rawPrompt({ prompt_id: 2, agent_group: 'Ventas', secuence: 1 }),
      rawPrompt({ prompt_id: 3, agent_group: 'Intake', secuence: 1 }),
      rawPrompt({ prompt_id: 4, agent_group: 'Intake', secuence: 1, active: false }),
    ]);

    expect(component.sortColumn()).toBe('agentGroup');
    expect(component.sortDirection()).toBe('asc');

    component.statusFilter.set('all');
    expect(component.sortedPrompts().map((p) => [p.agentGroup, p.secuence, p.active])).toEqual([
      ['Intake', 1, true],
      ['Intake', 1, false],
      ['Intake', 2, true],
      ['Ventas', 1, true],
    ]);
  });

  it('should render a table row for each prompt', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt(), rawPrompt({ prompt_id: 2 })]);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.prompts-table tbody tr'));
    expect(rows.length).toBe(2);
    expect(rows[0].nativeElement.textContent).toContain('Extracto de intención');
    expect(rows[0].nativeElement.textContent).toContain('P-001');
  });

  it('should show an empty message when there are no prompts', () => {
    fixture.detectChanges();
    flushResponse([]);
    fixture.detectChanges();

    const empty = fixture.debugElement.query(By.css('.state'));
    expect(empty).not.toBeNull();
    expect(empty.nativeElement.textContent).toContain('No hay prompts registrados');
  });

  it('should show a message when the filters exclude all prompts', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt()]);
    setSearch('no-existe-esta-busqueda');

    const empty = fixture.debugElement.query(By.css('.state'));
    expect(empty).not.toBeNull();
    expect(empty.nativeElement.textContent).toContain('No hay prompts que coincidan');
  });

  it('should set an error when the request fails', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBeFalsy();
  });

  it('should filter by search text (name or code)', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt(), rawPrompt({ prompt_id: 2, code: 'P-002', name: 'Respuesta' })]);

    setSearch('Respuesta');
    expect(component.sortedPrompts().length).toBe(1);
    expect(component.sortedPrompts()[0].promptId).toBe(2);

    setSearch('P-001');
    expect(component.sortedPrompts().length).toBe(1);
    expect(component.sortedPrompts()[0].promptId).toBe(1);
  });

  it('should filter by type', () => {
    fixture.detectChanges();
    flushResponse([
      rawPrompt(),
      rawPrompt({ prompt_id: 2, code: 'P-002', name: 'Respuesta', type: 'User' }),
    ]);

    selectFilter(0, 'User');
    expect(component.sortedPrompts().map((p) => p.promptId)).toEqual([2]);
  });

  it('should filter by status (active/inactive)', () => {
    fixture.detectChanges();
    flushResponse([
      rawPrompt(),
      rawPrompt({ prompt_id: 2, code: 'P-002', name: 'Respuesta', active: false }),
    ]);

    selectFilter(2, 'active');
    expect(component.sortedPrompts().map((p) => p.promptId)).toEqual([1]);

    selectFilter(2, 'inactive');
    expect(component.sortedPrompts().map((p) => p.promptId)).toEqual([2]);
  });

  it('should only show active prompts by default', () => {
    fixture.detectChanges();
    flushResponse([
      rawPrompt(),
      rawPrompt({ prompt_id: 2, code: 'P-002', name: 'Respuesta', active: false }),
    ]);

    expect(component.statusFilter()).toBe('active');
    expect(component.sortedPrompts().map((p) => p.promptId)).toEqual([1]);
  });

  it('should clear filters and restore all results', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt(), rawPrompt({ prompt_id: 2, code: 'P-002', name: 'Respuesta' })]);

    setSearch('Respuesta');
    expect(component.sortedPrompts().length).toBe(1);

    component.resetFilters();
    expect(component.searchText()).toBe('');
    expect(component.sortedPrompts().length).toBe(2);
    expect(component.hasActiveFilters()).toBeFalsy();
  });

  it('should change the sort column and toggle the direction', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt(), rawPrompt({ prompt_id: 2, name: 'Respuesta' })]);
    fixture.detectChanges();

    const sortSelect = fixture.nativeElement.querySelector('.sort-bar select');
    sortSelect.value = 'name';
    sortSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.sortedPrompts().map((p) => p.name)).toEqual([
      'Extracto de intención',
      'Respuesta',
    ]);

    component.toggleSortDirection();
    expect(component.sortDirection()).toBe('desc');
    expect(component.sortedPrompts().map((p) => p.name)).toEqual([
      'Respuesta',
      'Extracto de intención',
    ]);
  });

  it('should paginate results and navigate between pages', () => {
    fixture.detectChanges();
    flushResponse(Array.from({ length: 12 }, (_, i) => rawPrompt({ prompt_id: i + 1 })));
    fixture.detectChanges();

    expect(component.totalPages()).toBe(2);
    expect(component.pagedPrompts().length).toBe(10);
    expect(fixture.debugElement.queryAll(By.css('.prompts-table tbody tr')).length).toBe(10);

    component.nextPage();
    fixture.detectChanges();
    expect(component.page()).toBe(2);
    expect(component.pagedPrompts().length).toBe(2);
    expect(fixture.debugElement.queryAll(By.css('.prompts-table tbody tr')).length).toBe(2);

    component.prevPage();
    fixture.detectChanges();
    expect(component.page()).toBe(1);
  });

  it('should navigate to the prompt form when creating a new prompt', () => {
    fixture.detectChanges();
    flushResponse([]);
    fixture.detectChanges();

    const btn = fixture.debugElement.query(By.css('.btn-new'));
    btn.triggerEventHandler('click', null);

    expect(navigate).toHaveBeenCalledWith(['/prompts', 'nuevo']);
  });

  it('should navigate to the prompt form when a row is clicked', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt()]);
    fixture.detectChanges();

    const row = fixture.debugElement.query(By.css('.prompts-table tbody tr'));
    row.nativeElement.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/prompts', 1]);
  });

  it('should navigate with the edit button without double navigation', () => {
    fixture.detectChanges();
    flushResponse([rawPrompt()]);
    fixture.detectChanges();

    const edit = fixture.debugElement.query(By.css('.row-btn'));
    edit.nativeElement.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/prompts', 1]);
  });
});
