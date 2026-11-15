# KOMSI Music Library — Supabase

## Runtime architecture

- Static frontend: GitHub Pages.
- Browser client: Supabase JavaScript SDK **2.119.0** (pinned in `index.html` and `auth/confirm/index.html`).
- Supabase project: `dqbzjzsteuaraqfsatpb`.
- Main catalogue: `public.songs`.
- Member data: `public.user_favorites` and `public.user_playlists`.
- Public media: Storage buckets `audio` and `covers`.

The browser uses only the publishable key. Never add a `service_role` or secret key to this repository.

## Live database snapshot (checked 2026-11-15)

| Resource | Current state |
|---|---|
| `public.songs` | RLS enabled; public read; admin-only insert/update/delete |
| `public.user_favorites` | RLS enabled; authenticated users can manage only rows where `user_id = auth.uid()` |
| `public.user_playlists` | RLS enabled; authenticated users can select/insert/update/delete only their own rows |
| `audio` bucket | Public read; admin-only upload/delete; 100 MiB maximum |
| `covers` bucket | Public read; admin-only upload/delete; 10 MiB maximum |

Live row counts at the time of the audit: 5 songs, 3 favorites, 1 playlist, and 10 Storage objects. Counts can change as users interact with the app.

## Data ownership and synchronization

- Songs and play counts are stored in Supabase, not browser storage.
- Member favorites are stored in `user_favorites`.
- Member playlists are stored in `user_playlists`; `song_ids` is a UUID array.
- Admin accounts can manage personal playlists but are not given member favorites.
- Do not reintroduce localStorage persistence for favorites or playlists; it creates device-specific copies that drift from Supabase.

## Security notes

- RLS is enabled on all three public tables.
- Storage upload/delete policies are restricted to the configured admin email claim.
- `increment_song_play_count(text)` is an intentionally public RPC used by anonymous and signed-in listeners. It is SECURITY DEFINER because public clients cannot update `songs.play_count` directly under the table's RLS policy. It only increments the matching song's counter and returns no table data. This endpoint can still be called repeatedly to inflate play counts; consider server-side rate limiting if ranking integrity becomes important.
- Enable Supabase leaked-password protection in Authentication > Settings > Password Security.
- The database advisor currently reports one unused index on `user_favorites.song_id`; review before dropping it, since low traffic can make a useful index appear unused.

## Schema change tracking

The hosted project reports these applied migrations:

- `20261113135541_harden_music_library_security_and_constraints`
- `20261113135708_optimize_music_library_admin_rls_policies`

The original SQL bodies for those historical migrations were not available from the hosted migration list during this audit. Do not recreate or re-run them from guesses. Keep future schema changes in versioned SQL migration files and apply them deliberately.

## Local / CI checks

GitHub Actions runs `node --check app.js` on pushes and pull requests. This checks JavaScript syntax, not browser behavior or live authentication. Always verify sign-in, favorites, playlists, upload, playback and email confirmation in the deployed site after changes.
