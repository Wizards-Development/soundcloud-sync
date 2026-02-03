import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { catchError, finalize, map, mergeMap, switchMap, tap, toArray } from 'rxjs/operators';
import { invoke } from '@tauri-apps/api/core';
import { SoundCloudService } from './soundcloud.service';
import { SoundCloudAuthService } from './soundcloud-auth.service';
import { SyncProgress } from '../models/sync.model';
import { SoundCloudTrack } from '../models/soundcloud.model';

type EnrichedTrack = SoundCloudTrack & { http_mp3_128_url?: string; };

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
        unsupportedCount: 0,
        errorCount: 0,
    });

    public readonly progress$ = this._progress$.asObservable();

    public syncPlaylists(
        playlists: Map<string, string>,
        directory: string,
        tracksConcurrency = 10,
        playlistConcurrency = 2
    ): Observable<void> {
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
            unsupportedCount: 0,
            errorCount: 0,
            error: undefined,
            currentPlaylistTitle: undefined,
            currentTrackTitle: undefined,
        });

        return from(entries).pipe(
            mergeMap(([playlistId, playlistTitle], playlistIdx) => {
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
                        this.patch({ tracksDone: 0, tracksTotal: safeTracks.length });

                        return from(safeTracks).pipe(
                            mergeMap((track) => this.syncOneTrack(track, playlistTitle, directory), tracksConcurrency),
                            tap(() => {
                                this.patch({ tracksDone: this._progress$.value.tracksDone + 1 });
                            }),
                            finalize(() => {
                                this.patch({
                                    playlistsDone: this._progress$.value.playlistsDone + 1,
                                    currentTrackTitle: undefined,
                                });
                            }),
                            map(() => void 0),
                        );
                    }),
                );
            }, playlistConcurrency),
            finalize(() => {
                this.patch({
                    running: false,
                    currentPlaylistTitle: undefined,
                    currentTrackTitle: undefined,
                });
            }),
            map(() => void 0),
        );
    }

    private syncOneTrack(track: SoundCloudTrack, playlistTitle: string, directory: string) {
        this.patch({ currentTrackTitle: track.title });

        const needsStreamResolve =
            !(track.downloadable && track.download_url) && !!(track.streamable && track.stream_url);

        const enrichedTrack$ = needsStreamResolve
            ? this.soundcloudService.getTracKStreamUrl(track.id).pipe(
                map(stream => ({ ...track, http_mp3_128_url: stream?.http_mp3_128_url } as EnrichedTrack)),
                catchError(err => {
                    console.error('getTracKStreamUrl error', err);
                    return of(track as EnrichedTrack);
                }),
            )
            : of(track as EnrichedTrack);

        return enrichedTrack$.pipe(
            switchMap((enrichedTrack) =>
                from(invoke<SyncTrackResponse>('sync_track', {
                    req: {
                        track: enrichedTrack,
                        playlistTitle,
                        directory,
                        token: `OAuth ${this.authService.accessToken}`,
                    }
                }))
            ),
            tap(res => {
                const p = this._progress$.value;

                switch (res.action) {
                    case 'skipped':
                        this.patch({ skippedExistingCount: p.skippedExistingCount + 1 });
                        return;

                    case 'downloaded':
                        this.patch({ downloadedCount: p.downloadedCount + 1 });
                        return;

                    case 'streamed':
                        this.patch({ streamedCount: p.streamedCount + 1 });
                        return;

                    case 'unsupported':
                        this.patch({ unsupportedCount: p.unsupportedCount + 1 });
                        return;

                    case 'error':
                        this.patch({
                            errorCount: p.errorCount + 1,
                            error: res.reason ?? 'sync_track_error',
                        });
                        return;
                }
            }),
            catchError(err => {
                console.error(`✗ ${track.title}`, err);
                const p = this._progress$.value;
                this.patch({ errorCount: p.errorCount + 1, error: String(err) });
                return of(null);
            }),
        );
    }

    private patch(p: Partial<SyncProgress>) {
        this._progress$.next({ ...this._progress$.value, ...p });
    }
}
