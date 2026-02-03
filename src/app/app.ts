import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [RouterOutlet]
})
export class App {

  constructor() {
    void this.autoUpdate();
  }

  private async autoUpdate(): Promise<void> {
    const update = await check();
    if (!update) return;

    await update.downloadAndInstall((event) => {
      console.log(event);
    });

    await relaunch();
  }

}