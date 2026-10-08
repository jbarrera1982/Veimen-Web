import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { ClientsListComponent } from './clients-list.component';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/api/clients`;

function rawClient(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 1,
    name: 'Cliente Uno',
    inboundEmail: 'entrada@uno.com',
    outboundEmail: 'salida@uno.com',
    analystEmail: 'analista@veimen.net',
    openAIApiKey: 'sk-uno',
    active: true,
    ...partial,
  };
}

describe('ClientsListComponent', () => {
  let component: ClientsListComponent;
  let fixture: ComponentFixture<ClientsListComponent>;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientsListComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);

    // La mayoría de los tests asumen un usuario con permiso de escritura de clientes.
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.clientsRead, PERMISSIONS.clientsWrite]);
    permissions.loaded.set(true);

    fixture = TestBed.createComponent(ClientsListComponent);
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

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load clients from the API', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);

    expect(component.clients().length).toBe(1);
    expect(component.clients()[0].name).toBe('Cliente Uno');
    expect(component.isLoading()).toBeFalsy();
    expect(component.error()).toBeNull();
  });

  it('should render a table row for each client', () => {
    fixture.detectChanges();
    flushResponse([rawClient(), rawClient({ clientId: 2, name: 'Cliente Dos' })]);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.clients-table tbody tr'));
    expect(rows.length).toBe(2);
    const texts = rows.map((row) => row.nativeElement.textContent as string);
    expect(texts.some((text) => text.includes('Cliente Uno'))).toBe(true);
    expect(texts.some((text) => text.includes('Cliente Dos'))).toBe(true);
  });

  it('should show an empty message when there are no clients', () => {
    fixture.detectChanges();
    flushResponse([]);
    fixture.detectChanges();

    const empty = fixture.debugElement.query(By.css('.state'));
    expect(empty).not.toBeNull();
    expect(empty.nativeElement.textContent).toContain('No hay clientes registrados');
  });

  it('should set an error when the request fails', () => {
    fixture.detectChanges();

    const req = httpTesting.expectOne((r) => r.url === API_URL);
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBeTruthy();
    expect(component.isLoading()).toBeFalsy();
  });

  it('should filter by search text (name only)', () => {
    fixture.detectChanges();
    flushResponse([rawClient(), rawClient({ clientId: 2, name: 'Otro' })]);

    setSearch('Otro');
    expect(component.sortedClients().map((c) => c.clientId)).toEqual([2]);

    setSearch('Cliente Uno');
    expect(component.sortedClients().map((c) => c.clientId)).toEqual([1]);
  });

  it('should show all clients by default (including inactive)', () => {
    fixture.detectChanges();
    flushResponse([rawClient(), rawClient({ clientId: 2, name: 'Inactivo', active: false })]);

    expect(component.statusFilter()).toBe('all');
    expect(component.sortedClients().map((c) => c.clientId)).toEqual([1, 2]);
  });

  it('should filter by status when requested', () => {
    fixture.detectChanges();
    flushResponse([rawClient(), rawClient({ clientId: 2, name: 'Inactivo', active: false })]);

    component.statusFilter.set('active');
    expect(component.sortedClients().map((c) => c.clientId)).toEqual([1]);

    component.statusFilter.set('inactive');
    expect(component.sortedClients().map((c) => c.clientId)).toEqual([2]);
  });

  it('should clear filters and restore all results', () => {
    fixture.detectChanges();
    flushResponse([rawClient(), rawClient({ clientId: 2, name: 'Otro' })]);

    setSearch('Otro');
    expect(component.sortedClients().length).toBe(1);

    component.resetFilters();
    expect(component.searchText()).toBe('');
    expect(component.sortedClients().length).toBe(2);
    expect(component.hasActiveFilters()).toBeFalsy();
  });

  it('should paginate results and navigate between pages', () => {
    fixture.detectChanges();
    flushResponse(Array.from({ length: 12 }, (_, i) => rawClient({ clientId: i + 1 })));
    fixture.detectChanges();

    expect(component.totalPages()).toBe(2);
    expect(component.pagedClients().length).toBe(10);

    component.nextPage();
    fixture.detectChanges();
    expect(component.page()).toBe(2);
    expect(component.pagedClients().length).toBe(2);

    component.prevPage();
    expect(component.page()).toBe(1);
  });

  it('should show pagination controls only when there is more than one page', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.pagination'))).toBeNull();

    component.clients.set(
      Array.from({ length: 12 }, (_, i) => ({
        clientId: i + 1,
        name: `Cliente ${i + 1}`,
        inboundEmail: '',
        outboundEmail: '',
        analystEmail: '',
        openAIApiKey: '',
        active: true,
      })),
    );
    fixture.detectChanges();

    expect(component.totalPages()).toBe(2);
    expect(fixture.debugElement.query(By.css('.pagination'))).not.toBeNull();
  });

  it('should navigate to the client form when creating a new client', () => {
    fixture.detectChanges();
    flushResponse([]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const btn = fixture.debugElement.query(By.css('.btn-new'));
    btn.triggerEventHandler('click', null);

    expect(navigateSpy).toHaveBeenCalledWith(['/clientes', 'nuevo']);
  });

  it('should navigate to the client form when a row is clicked', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const row = fixture.debugElement.query(By.css('.clients-table tbody tr'));
    row.nativeElement.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/clientes', 1]);
  });

  it('should deactivate a client after confirmation', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.toggleActive(component.clients()[0]);

    const req = httpTesting.expectOne(`${API_URL}/1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ clientId: 1, name: 'Cliente Uno', active: false });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(component.clients()[0].active).toBe(false);
    expect(component.notice()).toContain('desactivado');
  });

  it('should not change the client when confirmation is cancelled', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    component.toggleActive(component.clients()[0]);

    expect(component.clients()[0].active).toBe(true);
  });

  it('should remove a client after confirmation', () => {
    fixture.detectChanges();
    flushResponse([rawClient()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.removeClient(component.clients()[0]);

    const req = httpTesting.expectOne(`${API_URL}/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(component.clients().length).toBe(0);
    expect(component.notice()).toContain('eliminado');
  });

  it('should hide write actions without the clients.write permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.clientsRead]);
    fixture.detectChanges();
    flushResponse([rawClient()]);
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.clients-table .row-btn')).length).toBe(0);
  });
});
