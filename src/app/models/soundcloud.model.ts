export interface SoundCloudUser {
  id: number;
  kind?: 'user';
  permalink?: string;
  username?: string;
  uri?: string;
  permalink_url?: string;
  avatar_url?: string | null;
  country?: string | null;
  city?: string | null;
  description?: string | null;
  [key: string]: any;
}

export interface SoundCloudTrack {
  id: number;
  kind?: 'track';
  created_at?: string;
  user_id?: number;
  duration?: number;
  commentable?: boolean;
  state?: string;
  original_content_size?: number;
  last_modified?: string;
  sharing?: 'public' | 'private';
  tag_list?: string;
  permalink?: string;
  permalink_url?: string;
  title?: string;
  description?: string | null;
  label_name?: string | null;
  genre?: string | null;
  release?: string | null;
  purchase_url?: string | null;
  artwork_url?: string | null;
  waveform_url?: string | null;
  stream_url?: string | null;
  streamable?: boolean;
  downloadable?: boolean;
  download_url?: string;
  playback_count?: number;
  download_count?: number;
  favoritings_count?: number;
  user?: SoundCloudUser;
  [key: string]: any;
}

export interface SoundCloudPlaylist {
  id: number;
  kind?: 'playlist';
  created_at?: string;
  user_id?: number;
  duration?: number;
  sharing?: 'public' | 'private';
  tag_list?: string;
  permalink?: string;
  permalink_url?: string;
  title?: string;
  description?: string | null;
  genre?: string | null;
  artwork_url?: string | null;
  user?: SoundCloudUser;
  tracks?: SoundCloudTrack[];
  track_count?: number;
  embeddable_by?: string | null;
  [key: string]: any;
  fromLikes?: boolean;
}

export interface Stream {
  http_mp3_128_url: string;
  hls_mp3_128_url: string;
  hls_aac_160_url: string;
  preview_mp3_128_url: string;
}
