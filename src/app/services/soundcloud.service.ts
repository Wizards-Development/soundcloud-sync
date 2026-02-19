import { inject, Injectable, isDevMode, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, forkJoin, Observable, of, tap } from 'rxjs';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SoundCloudPlaylist, SoundCloudTrack, SoundCloudUser, Stream } from '../models/soundcloud.model';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';

@Injectable({ providedIn: 'root' })
export class SoundCloudService {
    private readonly SC_PLAYLIST_ARTWORKS = 'sc_playlist_artworks';

    private http = inject(HttpClient);
    private auth = inject(SoundCloudAuthService);

    public readonly apiBase = 'https://api.soundcloud.com';

    public user = signal<SoundCloudUser | null>(null);
    public playlists = signal<SoundCloudPlaylist[] | null>(null);

    constructor() {
        this.bypassAuth()
    }

    public get playlistArtworks(): Record<string, string> {
        return JSON.parse(localStorage.getItem(this.SC_PLAYLIST_ARTWORKS) ?? '{}')
    }

    private set playlistArtworks(value: string) {
        localStorage.setItem(this.SC_PLAYLIST_ARTWORKS, value);
    }

    public loadMe(): void {
        info('SoundCloudService.loadMe: starting');
        this.http.get<SoundCloudUser>(`${this.apiBase}/me`, { headers: this.getHeaders() }).subscribe({
            next: (res) => {
                this.user.set(res);
                this.auth.isAuthenticated.set(true);
                info(`SoundCloudService.loadMe: success user=${res?.username ?? 'unknown'}`);
            },
            error: (err) => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false);
                    warn('SoundCloudService.loadMe: unauthenticated (401/403). Triggering login flow.');
                    void this.auth.login();
                }
                error(`SoundCloudService.loadMe: failed status=${err?.status ?? 'unknown'} message=${err?.message ?? err}`);
                this.user.set(null);
            }
        });
    }

    public loadAllMyPlaylists(withTrack: boolean): void {
        info(`SoundCloudService.loadAllMyPlaylists: starting withTrack=${withTrack}`);

        forkJoin({
            myPlaylists: this.http.get<SoundCloudPlaylist[]>(
                `${this.apiBase}/me/playlists?show_tracks=${withTrack}`,
                { headers: this.getHeaders() }
            ),
            likedPlaylists: this.http.get<SoundCloudPlaylist[]>(
                `${this.apiBase}/me/likes/playlists`,
                { headers: this.getHeaders() }
            )
        }).subscribe({
            next: ({ myPlaylists, likedPlaylists }) => {

                const merged = [
                    ...(myPlaylists ?? []),
                    ...(likedPlaylists ?? [])
                ];

                this.playlists.set(merged);
                this.auth.isAuthenticated.set(true);

                info(`SoundCloudService.loadAllMyPlaylists: success playlists=${merged.length}`);

                if (withTrack) {
                    merged.forEach(playlist => {
                        if (
                            playlist?.id &&
                            Array.isArray(playlist.tracks) &&
                            !playlist.artwork_url
                        ) {
                            this.updatePlaylistArtworkMap(
                                String(playlist.id),
                                playlist.tracks
                            );
                        }
                    });
                }
            },
            error: (err) => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false);
                }
                error(`SoundCloudService.loadAllMyPlaylists: failed status=${err?.status ?? 'unknown'}`);
                this.playlists.set(null);
            }
        });
    }

    public getPlaylistById(id: string, withTrack: boolean): Observable<SoundCloudPlaylist | null> {
        debug(`SoundCloudService.getPlaylistById: request id=${id} withTrack=${withTrack}`);
        return this.http.get<SoundCloudPlaylist>(`${this.apiBase}/playlists/${id}?show_tracks=${withTrack}`, { headers: this.getHeaders() }).pipe(
            tap(result => {
                if (result !== null) {
                    this.auth.isAuthenticated.set(true);
                    info(`SoundCloudService.getPlaylistById: success id=${id} title="${result.title ?? ''}" tracks=${Array.isArray(result.tracks) ? result.tracks.length : 'n/a'}`);
                }
            }),
            catchError(err => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false)
                }
                error(`SoundCloudService.getPlaylistById: error id=${id} status=${err?.status ?? 'unknown'} message=${err?.message ?? err}`);
                return of(null);
            })
        );
    }

    public getPlaylistsTracks(id: string): Observable<SoundCloudTrack[] | null> {
        debug(`SoundCloudService.getPlaylistsTracks: request id=${id}`);
        return this.http.get<SoundCloudTrack[]>(`${this.apiBase}/playlists/${id}/tracks`, { headers: this.getHeaders() }).pipe(
            tap(result => {
                if (result !== null) {
                    this.auth.isAuthenticated.set(true);
                    info(`SoundCloudService.getPlaylistsTracks: success id=${id} tracks=${result.length}`);
                    this.updatePlaylistArtworkMap(id, result);
                }
            }),
            catchError(err => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false)
                }
                error(`SoundCloudService.getPlaylistsTracks: error id=${id} status=${err?.status ?? 'unknown'} message=${err?.message ?? err}`);
                return of(null);
            })
        );
    }

    public getTracKStreamUrl(id: number): Observable<Stream | null> {
        debug(`SoundCloudService.getTracKStreamUrl: request id=${id}`);
        return this.http.get<Stream>(`${this.apiBase}/tracks/soundcloud:tracks:${id}/streams`, { headers: this.getHeaders() }).pipe(
            tap(result => {
                if (result !== null) {
                    this.auth.isAuthenticated.set(true);
                    info(`SoundCloudService.getTracKStreamUrl: success id=${id} url=${result.http_mp3_128_url ?? 'none'}`);
                }
            }),
            catchError(err => {
                if (err.status === 401 || err.status === 403) {
                    this.auth.isAuthenticated.set(false)
                }
                error(`SoundCloudService.getTracKStreamUrl: error id=${id} status=${err?.status ?? 'unknown'} message=${err?.message ?? err}`);
                return of(null);
            })
        );
    }

    private getHeaders(): HttpHeaders {
        const token = `OAuth ${this.auth.accessToken}`;
        debug(`SoundCloudService.getHeaders: Authorization present=${!!this.auth.accessToken}`);
        return new HttpHeaders({
            Authorization: token,
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
                info(`SoundCloudService.updatePlaylistArtworkMap: set artwork for playlistId=${playlistId}`);
            } else {
                if (map.hasOwnProperty(playlistId)) delete map[playlistId];
                info(`SoundCloudService.updatePlaylistArtworkMap: removed artwork for playlistId=${playlistId}`);
            }
            this.playlistArtworks = JSON.stringify(map);
        } catch (err) {
            console.warn('Failed to update playlist artwork map in localStorage', err);
            warn(`SoundCloudService.updatePlaylistArtworkMap: Failed to update playlist artwork map in localStorage: ${(err as any)?.message ?? err}`);
        }
    }

    private bypassAuth(): void {
        try {
            const isMac = typeof navigator !== 'undefined' && !!navigator.platform && navigator.platform.toLowerCase().includes('mac');

            if (isDevMode() && isMac) {
                this.auth.isAuthenticated.set(true);
                this.auth.isClientCredentialsValid.set(true);

                const devPlaylists: SoundCloudPlaylist[] = [
                    { id: 999001, kind: 'playlist', title: 'Dev Playlist 1', tracks: [], track_count: 0, user_id: 0 },
                    { id: 999002, kind: 'playlist', title: 'Dev Playlist 2', tracks: [], track_count: 0, user_id: 0 },
                    { id: 999003, kind: 'playlist', title: 'Dev Playlist 3', tracks: [], track_count: 0, user_id: 0 },
                ];

                this.playlists.set(devPlaylists);

                (this as any).loadMyPlaylists = (withTrack: boolean) => {
                    this.playlists.set(devPlaylists);
                    return;
                };

                (this as any).loadMe = () => {
                    this.user.set({
                        id: 0,
                        username: 'Dev User',
                        kind: 'user',
                        permalink: 'dev-user',
                    } as SoundCloudUser);
                    return;
                };
            }
        } catch (err) {
            warn(`Dev bypass initialization failed err=${err}`);
        }
    }
}
