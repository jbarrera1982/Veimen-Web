import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ManagedUser {
  userId: number;
  username: string;
  email: string;
  fullName: string | null;
  active: boolean;
  profileId: number | null;
  profileName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Profile {
  profileId: number;
  name: string;
  description: string | null;
}

export interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  fullName?: string | null;
  profileId: number;
  active?: boolean;
}

export interface UpdateUserPayload {
  email?: string;
  fullName?: string | null;
  profileId?: number;
  active?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  list(): Observable<ManagedUser[]> {
    return this.http.get<ManagedUser[]>(`${this.apiBaseUrl}/api/users`);
  }

  listProfiles(): Observable<Profile[]> {
    return this.http.get<Profile[]>(`${this.apiBaseUrl}/api/users/profiles`);
  }

  create(payload: CreateUserPayload): Observable<ManagedUser> {
    return this.http.post<ManagedUser>(`${this.apiBaseUrl}/api/users`, payload);
  }

  update(userId: number, payload: UpdateUserPayload): Observable<ManagedUser> {
    return this.http.patch<ManagedUser>(`${this.apiBaseUrl}/api/users/${userId}`, payload);
  }

  resetPassword(userId: number, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.apiBaseUrl}/api/users/${userId}/reset-password`, {
      newPassword,
    });
  }
}
