import { inject, Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { SoundCloudAuthService } from '../services/soundcloud-auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {

    private auth = inject(SoundCloudAuthService);

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        if (req.url.includes('/oauth/token')) {
            return next.handle(req);
        }

        return from(this.auth.ensureValidAccessToken()).pipe(
            switchMap(() => {
                const token = this.auth.accessToken;
                const cloned = token ? req.clone({ setHeaders: { Authorization: `OAuth ${token}` } }) : req;
                return next.handle(cloned).pipe(
                    catchError((err: any) => {
                        if ((err?.status === 401 || err?.status === 403) && this.auth.refreshToken) {
                            return from(this.auth.refresh()).pipe(
                                switchMap(refreshed => {
                                    if (refreshed) {
                                        const newToken = this.auth.accessToken;
                                        const retried = req.clone({ setHeaders: { Authorization: `OAuth ${newToken}` } });
                                        return next.handle(retried);
                                    } else {
                                        this.auth.isAuthenticated.set(false);
                                        void this.auth.login();
                                        return throwError(() => err);
                                    }
                                })
                            );
                        }
                        return throwError(() => err);
                    })
                );
            })
        );
    }
}
