import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SoundCloudAuthService } from '../../services/soundcloud-auth.service';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

@Component({
  selector: 'app-auth-callback',
  imports: [ProgressSpinnerModule],
  templateUrl: './auth-callback.html',
  styleUrl: './auth-callback.scss',
})
export class AuthCallback implements OnInit {

  private sc = inject(SoundCloudAuthService)
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code')!;
    const state = this.route.snapshot.queryParamMap.get('state')!;

    this.sc.token(code, state)
  }
}