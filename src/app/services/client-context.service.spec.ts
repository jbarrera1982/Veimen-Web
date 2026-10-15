import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AuthService, UserDto } from './auth.service';
import { Client } from './clients.service';
import { ClientContextService } from './client-context.service';

const CLIENTS_URL = `${environment.apiBaseUrl}/api/clients`;

function user(partial: Partial<UserDto> = {}): UserDto {
  return {
    userId: 1,
    username: 'jcb',
    email: 'jcb@veimen.net',
    fullName: 'Juan Carlos',
    active: true,
    clientId: null,
    lastLoginAt: null,
    ...partial,
  };
}

function client(partial: Partial<Client> = {}): Client {
  return {
    clientId: 1,
    name: 'Cliente Demo',
    inboundEmail: '',
    outboundEmail: '',
    analystEmail: '',
    projectId: 'proj-demo',
    active: true,
    ...partial,
  };
}

describe('ClientContextService', () => {
  let service: ClientContextService;
  let auth: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ClientContextService);
    auth = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
    auth.currentUser.set(user());
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should load the clients once per session', () => {
    service.ensureLoaded();
    httpTesting.expectOne(CLIENTS_URL).flush([client()]);

    expect(service.clients().length).toBe(1);

    // Una segunda llamada no vuelve a pedir la lista.
    service.ensureLoaded();
    httpTesting.expectNone(CLIENTS_URL);
  });

  it('should not load without an authenticated user', () => {
    auth.currentUser.set(null);
    service.ensureLoaded();
    httpTesting.expectNone(CLIENTS_URL);
  });

  it('should expose only active clients in the selector, sorted by name', () => {
    service.ensureLoaded();
    httpTesting
      .expectOne(CLIENTS_URL)
      .flush([
        client({ clientId: 1, name: 'Zeta' }),
        client({ clientId: 2, name: 'Acme' }),
        client({ clientId: 3, name: 'Inactivo', active: false }),
      ]);

    expect(service.selectableClients().map((c) => c.name)).toEqual(['Acme', 'Zeta']);
  });

  it('should start with "Todos" (null) and let an unassociated user select a client', () => {
    service.ensureLoaded();
    httpTesting.expectOne(CLIENTS_URL).flush([client({ clientId: 7, name: 'Acme' })]);

    expect(service.selectedClient()).toBeNull();

    service.selectClient(7);
    expect(service.selectedClient()?.clientId).toBe(7);

    service.selectClient(null);
    expect(service.selectedClient()).toBeNull();
  });

  it('should fix the associated client and ignore manual selection', () => {
    auth.currentUser.set(user({ clientId: 7 }));
    service.ensureLoaded();
    httpTesting
      .expectOne(CLIENTS_URL)
      .flush([client({ clientId: 7, name: 'Acme' }), client({ clientId: 8, name: 'Beta' })]);

    expect(service.hasAssociatedClient()).toBe(true);
    expect(service.selectedClient()?.clientId).toBe(7);
    expect(service.selectedClientName()).toBe('Acme');

    service.selectClient(8);
    expect(service.selectedClient()?.clientId).toBe(7);
  });

  it('should fall back to an empty list when the request fails', () => {
    service.ensureLoaded();
    httpTesting.expectOne(CLIENTS_URL).flush(null, { status: 500, statusText: 'Server Error' });

    expect(service.clients()).toEqual([]);
    expect(service.isLoading()).toBe(false);
  });

  it('should reload and drop the selection when another user logs in', () => {
    service.ensureLoaded();
    httpTesting.expectOne(CLIENTS_URL).flush([client({ clientId: 7 })]);
    service.selectClient(7);
    expect(service.selectedClient()?.clientId).toBe(7);

    auth.currentUser.set(user({ userId: 2 }));
    service.ensureLoaded();
    expect(service.selectedClient()).toBeNull();
    httpTesting.expectOne(CLIENTS_URL).flush([client({ clientId: 9 })]);
    expect(service.clients().map((c) => c.clientId)).toEqual([9]);
  });
});
