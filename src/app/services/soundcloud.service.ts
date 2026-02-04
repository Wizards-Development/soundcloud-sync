import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, Observable, of, tap } from 'rxjs';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SoundCloudPlaylist, SoundCloudTrack, SoundCloudUser, Stream } from '../models/soundcloud.model';

@Injectable({ providedIn: 'root' })
export class SoundCloudService {
    private http = inject(HttpClient);
    private auth = inject(SoundCloudAuthService);

    public readonly apiBase = 'https://api.soundcloud.com';

    public user = signal<SoundCloudUser | null>(null);
    public playlists = signal<SoundCloudPlaylist[] | null>(null);

    public loadMe(): void {
        this.http.get<SoundCloudUser>(`${this.apiBase}/me`, { headers: this.getHeaders() }).subscribe({
            next: (res) => {
                this.user.set(res);
                this.auth.isAuthenticated.set(true);
            },
            error: (err) => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false);
                    void this.auth.login();
                }
                this.user.set(null);
            }
        });
    }

    public loadMyPlaylists(withTrack: boolean): void {
        this.http.get<SoundCloudPlaylist[]>(`${this.apiBase}/me/playlists?show_tracks=${withTrack}`, { headers: this.getHeaders() }).subscribe({
            next: (res) => {
                this.playlists.set(res);
                this.auth.isAuthenticated.set(true);
            },
            error: (err) => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false);
                }
                this.playlists.set(null);
            }
        });
    }

    public getPlaylistsTracks(id: string): Observable<SoundCloudTrack[] | null> {
        return this.http.get<SoundCloudTrack[]>(`${this.apiBase}/playlists/${id}/tracks`, { headers: this.getHeaders() }).pipe(tap(result => {
            if (result !== null) {
                this.auth.isAuthenticated.set(true)
            }
        }), catchError(err => {
            if (err.status === 401 || err.status === 403) {
                this.auth.isAuthenticated.set(false)
            }
            return of(null);
        }));
    }

    public getTracKStreamUrl(id: number): Observable<Stream | null> {
        return this.http.get<Stream>(`${this.apiBase}/tracks/soundcloud:tracks:${id}/streams`, { headers: this.getHeaders() }).pipe(tap(result => {
            if (result !== null) {
                this.auth.isAuthenticated.set(true)
            }
        }), catchError(err => {
            if (err.status === 401 || err.status === 403) {
                this.auth.isAuthenticated.set(false)
            }
            return of(null);
        }));
    }

    private getHeaders(): HttpHeaders {
        return new HttpHeaders({
            Authorization: `OAuth ${this.auth.accessToken}`,
            Accept: 'application/json; charset=utf-8',
        });
    }
}
