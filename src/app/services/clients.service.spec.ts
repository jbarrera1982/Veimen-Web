import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { Client, ClientPayload, ClientsService } from './clients.service';

const API = environment.apiBaseUrl;
const LIST_URL = `${API}/api/clients`;

function apiClient(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 1,
    name: 'Cliente Demo',
    inboundEmail: 'entrada@cliente.com',
    outboundEmail: 'salida@cliente.com',
    analystEmail: 'analista@veimen.net',
    openAIApiKey: 'sk-demo',
    active: true,
    ...partial,
  };
}

function mappedClient(partial: Partial<Client> = {}): Client {
  return {
    clientId: 1,
    name: 'Cliente Demo',
    inboundEmail: 'entrada@cliente.com',
    outboundEmail: 'salida@cliente.com',
    analystEmail: 'analista@veimen.net',
    openAIApiKey: 'sk-demo',
    active: true,
    ...partial,
  };
}

function payload(partial: Partial<ClientPayload> = {}): ClientPayload {
  return {
    clientId: 0,
    name: 'Cliente Demo',
    inboundEmail: '',
    outboundEmail: 'salida@cliente.com',
    analystEmail: '',
    openAIApiKey: '',
    active: true,
    ...partial,
  };
}

describe('ClientsService', () => {
  let service: ClientsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ClientsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should fetch the list from the API', () => {
    let result: Client[] | undefined;
    service.getClients().subscribe((items) => (result = items));

    const req = httpTesting.expectOne(LIST_URL);
    expect(req.request.method).toBe('GET');
    req.flush([apiClient()]);

    expect(result).toEqual([mappedClient()]);
  });

  it('should default optional fields when the API omits them', () => {
    let result: Client[] | undefined;
    service.getClients().subscribe((items) => (result = items));

    const req = httpTesting.expectOne(LIST_URL);
    req.flush([{ clientId: 2, name: 'Solo nombre' }]);

    expect(result?.[0]).toMatchObject({
      inboundEmail: '',
      outboundEmail: '',
      analystEmail: '',
      openAIApiKey: '',
      active: true,
    });
  });

  it('should fetch a single client by id', () => {
    let result: Client | undefined;
    service.getClient(7).subscribe((client) => (result = client));

    const req = httpTesting.expectOne(`${LIST_URL}/7`);
    expect(req.request.method).toBe('GET');
    req.flush(apiClient({ clientId: 7 }));

    expect(result?.clientId).toBe(7);
    expect(result?.name).toBe('Cliente Demo');
  });

  it('should post the new client and normalize empty optional fields to null', () => {
    let result: Client | undefined;
    service.createClient(payload()).subscribe((client) => (result = client));

    const req = httpTesting.expectOne(LIST_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      clientId: 0,
      name: 'Cliente Demo',
      inboundEmail: null,
      outboundEmail: 'salida@cliente.com',
      analystEmail: null,
      openAIApiKey: null,
      active: true,
    });
    req.flush(apiClient({ clientId: 9 }));

    expect(result?.clientId).toBe(9);
  });

  it('should put the update to /api/clients/{id} with the route id in the body', () => {
    let completed = false;
    service.updateClient(7, payload({ clientId: 1 })).subscribe(() => (completed = true));

    const req = httpTesting.expectOne(`${LIST_URL}/7`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({
      clientId: 7,
      name: 'Cliente Demo',
      inboundEmail: null,
      openAIApiKey: null,
    });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });

  it('should delete a client (soft delete) with DELETE', () => {
    let completed = false;
    service.deleteClient(7).subscribe(() => (completed = true));

    const req = httpTesting.expectOne(`${LIST_URL}/7`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });
});
