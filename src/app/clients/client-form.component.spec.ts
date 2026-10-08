import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ClientFormComponent } from './client-form.component';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;
const LIST_URL = `${API}/api/clients`;
const detailUrl = (id: number | string) => `${API}/api/clients/${id}`;

function apiClient(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 5,
    name: 'Cliente Uno',
    inboundEmail: 'entrada@uno.com',
    outboundEmail: 'salida@uno.com',
    analystEmail: 'analista@veimen.net',
    openAIApiKey: 'sk-uno',
    active: true,
    ...partial,
  };
}

describe('ClientFormComponent', () => {
  let httpTesting: HttpTestingController;

  async function setup(id: string | null) {
    await TestBed.configureTestingModule({
      imports: [ClientFormComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } },
    });

    httpTesting = TestBed.inject(HttpTestingController);
    return TestBed.createComponent(ClientFormComponent);
  }

  afterEach(() => {
    httpTesting.verify();
  });

  it('should build an empty form for a new client', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.isEdit()).toBeFalsy();
    expect(component.form.get('name')?.value).toBe('');
    expect(component.form.get('active')?.value).toBe(true);
  });

  it('should require the name', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.form.valid).toBeFalsy();
    component.form.get('name')?.setValue('Cliente Nuevo');
    expect(component.form.valid).toBeTruthy();
  });

  it('should reject an invalid email', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.patchValue({ name: 'Cliente', inboundEmail: 'no-es-un-email' });
    expect(component.form.get('inboundEmail')?.valid).toBeFalsy();

    component.form.get('inboundEmail')?.setValue('correo@ok.com');
    expect(component.form.get('inboundEmail')?.valid).toBeTruthy();
  });

  it('should load the client by id from the API and patch the form', async () => {
    const fixture = await setup('5');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const req = httpTesting.expectOne(detailUrl(5));
    expect(req.request.method).toBe('GET');
    req.flush(apiClient());

    expect(component.isEdit()).toBeTruthy();
    expect(component.clientId()).toBe(5);
    expect(component.form.get('name')?.value).toBe('Cliente Uno');
    expect(component.form.get('openAIApiKey')?.value).toBe('sk-uno');
  });

  it('should not call the API for the "nuevo" route', async () => {
    const fixture = await setup('nuevo');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isEdit()).toBeFalsy();
    httpTesting.expectNone(() => true);
  });

  it('should create the client and navigate back to the list', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.patchValue({
      name: 'Cliente Nuevo',
      inboundEmail: '',
      outboundEmail: 'salida@nuevo.com',
    });
    component.save();

    const req = httpTesting.expectOne((r) => r.url === LIST_URL && r.method === 'POST');
    expect(req.request.body).toMatchObject({
      clientId: 0,
      name: 'Cliente Nuevo',
      inboundEmail: null,
      outboundEmail: 'salida@nuevo.com',
      active: true,
    });
    req.flush(apiClient({ clientId: 9, name: 'Cliente Nuevo' }));

    expect(navigateSpy).toHaveBeenCalledWith(['/clientes'], {
      state: { notice: 'Cliente Cliente Nuevo creado.' },
    });
    expect(component.isSaving()).toBe(false);
  });

  it('should update the client through PUT and navigate back to the list', async () => {
    const fixture = await setup('5');
    const component = fixture.componentInstance;
    fixture.detectChanges();

    httpTesting.expectOne(detailUrl(5)).flush(apiClient());

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.patchValue({ name: 'Cliente Editado' });
    component.save();

    const req = httpTesting.expectOne((r) => r.url === detailUrl(5) && r.method === 'PUT');
    expect(req.request.body).toMatchObject({
      clientId: 5,
      name: 'Cliente Editado',
      openAIApiKey: 'sk-uno',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(navigateSpy).toHaveBeenCalledWith(['/clientes'], {
      state: { notice: 'Cliente Cliente Editado actualizado.' },
    });
    expect(component.isSaving()).toBe(false);
  });

  it('should keep the form open and show an error when the save fails', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.patchValue({ name: 'Cliente Nuevo' });
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

    component.form.patchValue({ name: 'Cliente Nuevo' });
    component.save();

    httpTesting
      .expectOne((r) => r.url === LIST_URL && r.method === 'POST')
      .flush(
        { errors: { inboundEmail: ['The InboundEmail field is not a valid e-mail address.'] } },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(component.saveError()).toBe('Revisa estos campos: inboundEmail.');
    expect(component.isSaving()).toBe(false);
  });

  it('should disable the save button until the form is valid', async () => {
    const fixture = await setup(null);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-primary');
    expect(button.disabled).toBe(true);

    component.form.get('name')?.setValue('Cliente Nuevo');
    fixture.detectChanges();

    expect(button.disabled).toBe(false);
  });
});
