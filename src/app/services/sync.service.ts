import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { catchError, concatMap, finalize, map, switchMap, tap } from 'rxjs/operators';
import { invoke } from '@tauri-apps/api/core';
import { SoundCloudService } from './soundcloud.service';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SyncProgress } from '../models/sync.model';

@Injectable({ providedIn: 'root' })
export class SyncService {
    private soundcloudService = inject(SoundCloudService);
    private authService = inject(SoundCloudAuthService);

    private readonly _progress$ = new BehaviorSubject<SyncProgress>({
        running: false,
        playlistsDone: 0,
        playlistsTotal: 0,
        tracksDone: 0,
        tracksTotal: 0,
        downloadedCount: 0,
        streamedCount: 0,
        skippedExistingCount: 0,
    });

    public readonly progress$ = this._progress$.asObservable();

    public syncPlaylists(playlists: Map<string, string>, directory: string): Observable<void> {
        const entries = Array.from(playlists.entries());
        const playlistsTotal = entries.length;

        this._progress$.next({
            running: true,
            playlistsDone: 0,
            playlistsTotal,
            tracksDone: 0,
            tracksTotal: 0,
            downloadedCount: 0,
            streamedCount: 0,
            skippedExistingCount: 0,
        });

        return from(entries).pipe(
            concatMap(([playlistId, playlistTitle], playlistIdx) => {
                this.patch({
                    currentPlaylistTitle: playlistTitle,
                    playlistsDone: playlistIdx + 1,
                    tracksDone: 0,
                    tracksTotal: 0,
                    currentTrackTitle: undefined,
                });

                return this.soundcloudService.getPlaylistsTracks(playlistId).pipe(
                    switchMap(tracks => {
                        const safeTracks = tracks ?? [];
                        this.patch({
                            tracksDone: 0,
                            tracksTotal: safeTracks.length,
                        });

                        return from(safeTracks).pipe(
                            concatMap((track, trackIdx) => {
                                this.patch({
                                    currentTrackTitle: track.title,
                                    tracksDone: trackIdx + 1,
                                });

                                const path = `${directory}/${playlistTitle}/${track.title}.mp3`;

                                return from(invoke<boolean>('track_exists', { path })).pipe(
                                    switchMap(exists => {
                                        if (exists) {
                                            this.patch({
                                                skippedExistingCount: this._progress$.value.skippedExistingCount + 1,
                                                tracksDone: trackIdx + 1,
                                            });
                                            return of(null);
                                        }

                                        if (track.downloadable && track.download_url) {
                                            return from(
                                                invoke('download', {
                                                    url: track.download_url,
                                                    path,
                                                    token: `OAuth ${this.authService.accessToken}`,
                                                })
                                            ).pipe(
                                                tap(() => {
                                                    console.log(`✓ ${track.title} téléchargé`);
                                                    this.patch({
                                                        downloadedCount: this._progress$.value.downloadedCount + 1,
                                                        tracksDone: trackIdx + 1,
                                                    });
                                                })
                                            );
                                        }

                                        if (track.streamable && track.stream_url) {
                                            return this.soundcloudService.getTracKStreamUrl(track.id).pipe(
                                                switchMap(streamable =>
                                                    from(
                                                        invoke('stream', {
                                                            url: streamable?.http_mp3_128_url,
                                                            path,
                                                            token: `OAuth ${this.authService.accessToken}`,
                                                        })
                                                    )
                                                ),
                                                tap(() => {
                                                    console.log(`✓ ${track.title} streamé`);
                                                    this.patch({
                                                        streamedCount: this._progress$.value.streamedCount + 1,
                                                        tracksDone: trackIdx + 1,
                                                    });
                                                })
                                            );
                                        }

                                        this.patch({ tracksDone: trackIdx + 1 });
                                        return of(null);
                                    }),
                                    catchError(err => {
                                        console.error(`✗ ${track.title}`, err);
                                        this.patch({ error: String(err), tracksDone: trackIdx + 1 });
                                        return of(null);
                                    })
                                );
                            }),
                            finalize(() => {
                                this.patch({
                                    playlistsDone: playlistIdx + 1,
                                    currentTrackTitle: undefined,
                                });
                            }),
                            map(() => void 0)
                        );
                    })
                );
            }),
            finalize(() => {
                this.patch({
                    running: false,
                    currentPlaylistTitle: undefined,
                    currentTrackTitle: undefined,
                });
            }),
            map(() => void 0)
        );
    }

    private patch(p: Partial<SyncProgress>) {
        this._progress$.next({ ...this._progress$.value, ...p });
    }
}
