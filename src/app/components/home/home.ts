import { Component, computed, effect, inject, Signal, signal } from '@angular/core';
import { SoundCloudAuthService } from '../../services/soundcloud-auth.service';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TooltipModule } from 'primeng/tooltip';
import { SoundCloudService } from '../../services/soundcloud.service';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AvatarModule } from 'primeng/avatar';
import { TagModule } from 'primeng/tag';
import { SoundCloudPlaylist, SoundCloudUser } from '../../models/soundcloud.model';
import { SyncService } from '../../services/sync.service';
import { open } from '@tauri-apps/plugin-dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { SyncProgress } from '../../models/sync.model';
import { AsyncPipe } from '@angular/common';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Clipboard } from '@angular/cdk/clipboard';

@Component({
  selector: 'app-home',
  imports: [FloatLabelModule, InputTextModule, ButtonModule, ReactiveFormsModule, TooltipModule, ProgressSpinnerModule, AvatarModule, TagModule, FormsModule, ProgressBarModule, AsyncPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private fb = inject(FormBuilder);
  private authService = inject(SoundCloudAuthService);
  private soundcloudService = inject(SoundCloudService)
  private syncService = inject(SyncService);
  private clipboard = inject(Clipboard);

  private readonly SYNCED_PLAYLISTS = 'synced_playlists';
  private readonly SAVE_DIRECTORY = 'save_directory';

  public isClientCredentialsValid = this.authService.isClientCredentialsValid;
  public loadingPlaylists = computed(() => this.playlists() === null);
  public playlists = this.soundcloudService.getMyPlaylists(false);
  public saveDirectory = signal(localStorage.getItem(this.SAVE_DIRECTORY) ?? '')
  public user: Signal<SoundCloudUser | null> = signal(null);
  public readonly soundcloudAppsUrl = 'https://soundcloud.com/you/apps';
  public readonly callbackUri = 'http://localhost:4200/callback';
  public readonly playlistQuery = signal('');
  public readonly filteredPlaylists = computed(() => {
    const list = this.playlists();
    if (!list) return list;
    const q = this.playlistQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => (p.title ?? '').toLowerCase().includes(q));
  });
  public readonly syncedPlaylists = signal<Map<string, string>>(new Map());

  public form = this.fb.nonNullable.group({
    clientId: ['', [Validators.required]],
    clientSecret: ['', [Validators.required]],
  });

  public get isAuthenticated(): Signal<boolean> {
    return this.authService.isAuthenticated;
  }

  public get progress$(): Observable<SyncProgress> {
    return this.syncService.progress$;
  }

  public constructor() {
    if (this.isClientCredentialsValid()) {
      this.user = this.soundcloudService.getMe();

      const raw = localStorage.getItem(this.SYNCED_PLAYLISTS);
      if (raw) {
        try {
          const entries: [string, string][] = JSON.parse(raw);
          this.syncedPlaylists.set(new Map(entries));
        } catch { }
      }

    } else {
      const clientId = this.authService.clientId;
      const clientSecret = this.authService.clientSecret;

      this.form.patchValue({ clientId, clientSecret }, { emitEvent: false });
      this.form.controls.clientId.valueChanges
        .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed())
        .subscribe((value) => (this.authService.clientId = value));

      this.form.controls.clientSecret.valueChanges
        .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed())
        .subscribe((value) => (this.authService.clientSecret = value));
    }

    effect(() => {
      const entries = Array.from(this.syncedPlaylists().entries());
      localStorage.setItem(this.SYNCED_PLAYLISTS, JSON.stringify(entries));

      localStorage.setItem(this.SAVE_DIRECTORY, this.saveDirectory() ?? '');
    });

  }

  public login(): void {
    void this.authService.login()
  }

  public isSynced(id: string | number): boolean {
    return this.syncedPlaylists().has(String(id));
  }

  public async togglePlaylistSync(
    playlist: SoundCloudPlaylist
  ): Promise<void> {
    const id = String(playlist.id);
    const title = playlist.title ?? '';

    const current = new Map(this.syncedPlaylists());

    if (current.has(id)) {
      current.delete(id);
    } else {
      current.set(id, title);
    }
    this.syncedPlaylists.set(current);
  }

  public syncPlaylists(): void {
    this.syncService.syncPlaylists(this.syncedPlaylists(), this.saveDirectory()).subscribe();
  }

  public async selectDirctory(): Promise<void> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choisir un dossier',
    });

    if (selected) {
      this.saveDirectory.set(selected);
    }
  }

  public async openSoundcloudApps(): Promise<void> {
    await openUrl(this.soundcloudAppsUrl);
  }

  public async copyRedirectUri(): Promise<void> {
    this.clipboard.copy(this.callbackUri);
  }
}
