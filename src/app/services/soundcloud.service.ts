import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, Observable, of, tap } from 'rxjs';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SoundCloudPlaylist, SoundCloudTrack, SoundCloudUser, Stream } from '../models/soundcloud.model';

@Injectable({ providedIn: 'root' })
export class SoundCloudService {
    private readonly SC_PLAYLIST_ARTWORKS = 'sc_playlist_artworks';

    private http = inject(HttpClient);
    private auth = inject(SoundCloudAuthService);

    public readonly apiBase = 'https://api.soundcloud.com';

    public user = signal<SoundCloudUser | null>(null);
    public playlists = signal<SoundCloudPlaylist[] | null>(null);

    public get playlistArtworks(): Record<string, string> {
        return JSON.parse(localStorage.getItem(this.SC_PLAYLIST_ARTWORKS) ?? '{}')
    }

    private set playlistArtworks(value: string) {
        localStorage.setItem(this.SC_PLAYLIST_ARTWORKS, value);
    }

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

                if (withTrack && res) {
                    res.forEach(playlist => {
                        if (playlist?.id && Array.isArray(playlist.tracks) && !playlist.artwork_url) {
                            this.updatePlaylistArtworkMap(String(playlist.id), playlist.tracks);
                        }
                    });
                }
            },
            error: (err) => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false);
                }
                this.playlists.set(null);
            }
        });
    }

    public getPlaylistById(id: string, withTrack: boolean): Observable<SoundCloudPlaylist | null> {
        return this.http.get<SoundCloudPlaylist>(`${this.apiBase}/playlists/${id}?show_tracks=${withTrack}`, { headers: this.getHeaders() }).pipe(
            tap(result => {
                if (result !== null) {
                    this.auth.isAuthenticated.set(true);
                }
            }),
            catchError(err => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false)
                }
                return of(null);
            })
        );
    }

    public getPlaylistsTracks(id: string): Observable<SoundCloudTrack[] | null> {
        return this.http.get<SoundCloudTrack[]>(`${this.apiBase}/playlists/${id}/tracks`, { headers: this.getHeaders() }).pipe(
            tap(result => {
                if (result !== null) {
                    this.auth.isAuthenticated.set(true);
                    this.updatePlaylistArtworkMap(id, result);
                }
            }),
            catchError(err => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false)
                }
                return of(null);
            })
        );
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

    private updatePlaylistArtworkMap(playlistId: string, tracks: SoundCloudTrack[] | null): void {
        if (!tracks) return;

        try {
            const url = tracks
                .map(t => t.artwork_url)
                .find((u): u is string => !!u);

            const map = this.playlistArtworks;

            if (url) {
                map[playlistId] = url;
            } else {
                if (map.hasOwnProperty(playlistId)) delete map[playlistId];
            }
            this.playlistArtworks = JSON.stringify(map);
        } catch (e) {
            console.warn('Failed to update playlist artwork map in localStorage', e);
        }
    }
}
