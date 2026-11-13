-- Jalankan sekali di Supabase Dashboard > SQL Editor > New query.
-- Fungsi ini menambah play_count secara atomik setiap kali audio mulai diputar.
create or replace function public.increment_song_play_count(p_song_id text)
returns void
language sql
security definer
set search_path = public
as $function$
  update public.songs
  set play_count = coalesce(play_count, 0) + 1
  where id::text = p_song_id;
$function$;

revoke all on function public.increment_song_play_count(text) from public;
grant execute on function public.increment_song_play_count(text) to anon, authenticated;
