import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { catchError, concatMap, finalize, map, switchMap, tap } from 'rxjs/operators';
import { invoke } from '@tauri-apps/api/core';
import { SoundCloudService } from './soundcloud.service';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SyncProgress } from '../models/sync.model';
import { SoundCloudTrack } from '../models/soundcloud.model';

type EnrichedTrack = SoundCloudTrack & {
    http_mp3_128_url?: string;
};

type SyncTrackResponse = {
    action: 'skipped' | 'downloaded' | 'streamed' | 'unsupported' | 'error';
    path: string;
    reason?: string | null;
};

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
                    error: undefined,
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

                                const needsStreamResolve =
                                    !(track.downloadable && track.download_url) && !!(track.streamable && track.stream_url);

                                const enrichedTrack$ = needsStreamResolve
                                    ? this.soundcloudService.getTracKStreamUrl(track.id).pipe(
                                        map(stream => {
                                            const enriched: EnrichedTrack = {
                                                ...track,
                                                http_mp3_128_url: stream?.http_mp3_128_url,
                                            };
                                            return enriched;
                                        }),
                                        catchError(err => {
                                            console.error('getTracKStreamUrl error', err);
                                            return of(track);
                                        })
                                    )
                                    : of(track);

                                return enrichedTrack$.pipe(
                                    switchMap((enrichedTrack: EnrichedTrack) =>
                                        from(
                                            invoke<SyncTrackResponse>('sync_track', {
                                                req: {
                                                    track: enrichedTrack,
                                                    playlistTitle,
                                                    directory,
                                                    token: `OAuth ${this.authService.accessToken}`,
                                                }
                                            })
                                        )
                                    ),
                                    tap(res => {
                                        if (res.action === 'skipped') {
                                            this.patch({
                                                skippedExistingCount: this._progress$.value.skippedExistingCount + 1,
                                            });
                                            return;
                                        }

                                        if (res.action === 'downloaded') {
                                            console.log(`✓ ${track.title} téléchargé`);
                                            this.patch({
                                                downloadedCount: this._progress$.value.downloadedCount + 1,
                                            });
                                            return;
                                        }

                                        if (res.action === 'streamed') {
                                            console.log(`✓ ${track.title} streamé`);
                                            this.patch({
                                                streamedCount: this._progress$.value.streamedCount + 1,
                                            });
                                            return;
                                        }

                                        if (res.action === 'unsupported') {
                                            console.warn(`~ ${track.title} unsupported`, res.reason);
                                            return;
                                        }

                                        if (res.action === 'error') {
                                            console.error(`✗ ${track.title}`, res.reason);
                                            this.patch({ error: res.reason ?? 'sync_track_error' });
                                            return;
                                        }
                                    }),
                                    catchError(err => {
                                        console.error(`✗ ${track.title}`, err);
                                        this.patch({ error: String(err) });
                                        return of(null);
                                    }),
                                    tap(() => this.patch({ tracksDone: trackIdx + 1 }))
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
