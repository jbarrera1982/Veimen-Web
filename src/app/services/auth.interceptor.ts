import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AuthService, AUTH_ALLOW_ANON } from './auth.service';
import { environment } from '../../environments/environment';

let refreshPromise: Promise<boolean> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isApiRequest = req.url.startsWith(environment.apiBaseUrl);

  let request: HttpRequest<unknown> = req;
  const token = auth.getAccessToken();
  if (isApiRequest && token && !req.context.get(AUTH_ALLOW_ANON)) {
    request = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(request).pipe(
    catchError((error) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        isApiRequest &&
        !req.context.get(AUTH_ALLOW_ANON)
      ) {
        return refreshOnce(auth).pipe(
          switchMap((ok) => {
            if (!ok) {
              auth.clearSession();
              if (typeof window !== 'undefined') {
                void router.navigate(['/login'], {
                  queryParams: {
                    redirect: window.location.pathname + window.location.search,
                  },
                });
              }
              return throwError(() => error);
            }

            const newToken = auth.getAccessToken();
            const retried = newToken
              ? req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } })
              : req;
            return next(retried);
          }),
        );
      }

      return throwError(() => error);
    }),
  );
};

function refreshOnce(auth: AuthService): Observable<boolean> {
  if (!refreshPromise) {
    refreshPromise = firstValueFrom(
      auth.refresh().pipe(
        map(() => true),
        catchError(() => of(false)),
      ),
    ).finally(() => {
      refreshPromise = null;
    });
  }
  return from(refreshPromise);
}
