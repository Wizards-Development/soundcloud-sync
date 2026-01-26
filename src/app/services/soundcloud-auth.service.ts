import { inject, Injectable, signal } from '@angular/core';
import { randomString, sha256Base64Url } from './pkce';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class SoundCloudAuthService {
    private readonly SC_CLIENT_ID = 'sc_client_id';
    private readonly SC_CLIENT_SECRET = 'sc_client_secret';
    private readonly SC_STATE = 'sc_state';
    private readonly SC_CODE_VERIFIER = 'sc_code_verifier';
    private readonly SC_ACCESS_TOKEN = 'sc_access_token';
    private readonly SC_REFRESH_TOKEN = 'sc_refresh_token';

    private redirectUri = `${window.location.origin}/callback`;
    private baseUrl = "https://secure.soundcloud.com"

    public isAuthenticated = signal(false);
    public isClientCredentialsValid = signal(localStorage.getItem("isClientCredentialsValid") ? true : false);

    private http = inject(HttpClient);
    private router = inject(Router);

    public get clientId(): string {
        return localStorage.getItem(this.SC_CLIENT_ID) ?? ''
    }

    public set clientId(value: string) {
        localStorage.setItem(this.SC_CLIENT_ID, value);
    }

    public get clientSecret(): string {
        return localStorage.getItem(this.SC_CLIENT_SECRET) ?? ''
    }

    public set clientSecret(value: string) {
        localStorage.setItem(this.SC_CLIENT_SECRET, value);
    }

    private get state(): string {
        return sessionStorage.getItem(this.SC_STATE) ?? ''
    }

    private set state(value: string) {
        sessionStorage.setItem(this.SC_STATE, value);
    }

    private get codeVerifier(): string {
        return sessionStorage.getItem(this.SC_CODE_VERIFIER) ?? ''
    }

    private set codeVerifier(value: string) {
        sessionStorage.setItem(this.SC_CODE_VERIFIER, value);
    }

    public get accessToken(): string {
        return sessionStorage.getItem(this.SC_ACCESS_TOKEN) ?? '';
    }

    private set accessToken(value: string) {
        sessionStorage.setItem(this.SC_ACCESS_TOKEN, value);
    }

    private get refreshToken(): string {
        return sessionStorage.getItem(this.SC_REFRESH_TOKEN) ?? ''
    }

    private set refreshToken(value: string) {
        sessionStorage.setItem(this.SC_REFRESH_TOKEN, value);
    }

    async login(): Promise<void> {
        const state = randomString(16);
        const codeVerifier = randomString(64);
        const codeChallenge = await sha256Base64Url(codeVerifier);

        this.state = state;
        this.codeVerifier = codeVerifier;

        window.location.href = `${this.baseUrl}/authorize?client_id=${encodeURIComponent(this.clientId)}&redirect_uri=${encodeURIComponent(this.redirectUri)}&response_type=code&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&state=${encodeURIComponent(state)}`;
    }

    public token(code: string, state: string): void {
        if (!code || !state || state !== this.state || !this.codeVerifier) {
            this.router.navigateByUrl('/home');
            alert('Erreur OAuth');
            return;
        }

        const body = new URLSearchParams();
        body.set('grant_type', 'authorization_code');
        body.set('client_id', this.clientId);
        body.set('client_secret', this.clientSecret);
        body.set('redirect_uri', this.redirectUri);
        body.set('code', code);
        body.set('code_verifier', this.codeVerifier);

        const headers = new HttpHeaders({
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json; charset=utf-8',
        });

        this.http
            .post<any>(
                `${this.baseUrl}/oauth/token`,
                body.toString(),
                { headers }
            )
            .subscribe({
                next: (res) => {
                    this.accessToken = res.access_token;
                    this.refreshToken = res.refresh_token;
                    this.isAuthenticated.set(true);
                    localStorage.setItem("isClientCredentialsValid", "true");
                    this.isClientCredentialsValid.set(true);
                    this.router.navigateByUrl('/home');
                },
                error: (err) => {
                    console.error(err);
                    this.isAuthenticated.set(false);
                    this.router.navigateByUrl('/home');
                    alert('Erreur token SoundCloud');
                },
            });
    }
}
