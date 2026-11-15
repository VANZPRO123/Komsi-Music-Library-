(() => {
  "use strict";

  // Konfigurasi proyek Supabase KOMSI Music Library.
  const SUPABASE_URL = "https://dqbzjzsteuaraqfsatpb.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_b3ft4ELVXRGVtOayaRd8YA_QxVl5E1p";
  const ADMIN_EMAIL = "webukmkomsiuinkhasjember@gmail.com";
  const AUDIO_BUCKET = "audio";
  const COVERS_BUCKET = "covers";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    search: $("#searchInput"), grid: $("#songGrid"), chips: $("#genreChips"),
    sort: $("#sortSelect"), loading: $("#loadingState"), error: $("#errorState"),
    errorMessage: $("#errorMessage"), empty: $("#emptyState"), noResults: $("#noResultsState"),
    totalSongs: $("#totalSongs"), totalGenres: $("#totalGenres"), heroMeta: $("#heroMetaText"),
    status: $("#connectionStatus"), statusDot: $(".status-dot"),
    uploadModal: $("#uploadModal"), uploadForm: $("#uploadForm"),
    audioFile: $("#audioFile"), coverFile: $("#coverFile"),
    uploadProgress: $("#uploadProgress"), uploadProgressFill: $("#uploadProgressFill"),
    uploadProgressText: $("#uploadProgressText"), submitUpload: $("#submitUploadBtn"),
    audio: $("#audioElement"), playerCover: $("#playerCover"),
    playerTitle: $("#playerTitle"), playerArtist: $("#playerArtist"),
    playPause: $("#playPauseBtn"), progress: $("#progressRange"),
    currentTime: $("#currentTime"), duration: $("#durationText"),
    volume: $("#volumeRange"), login: $("#adminLoginBtn"), logout: $("#logoutBtn"), memberAuth: $("#memberAuthBtn"), memberAuthModal: $("#memberAuthModal")
  };

  let db = null;
  let songs = [];
  let filteredSongs = [];
  let currentSongIndex = -1;
  let currentUser = null;
  let activeGenre = "all";
  let activeView = "discover";
  let favoriteIds = new Set();
  let playlists = [];
  let activePlaylistId = null;
  let shufflePlaylist = false;
  let isBusy = false;
  // Satu sesi pemutaran dihitung sekali; pause/resume tidak menambah statistik.
  let playSessionId = 0;
  let countedPlaySessionId = -1;
  let pendingPlaySessionId = -1;

  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const clean = (value) => String(value ?? "").trim();
  const isAdmin = () => Boolean(currentUser && currentUser.email &&
    currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const toast = (message, type = "") => {
    const node = document.createElement("div");
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    $("#toastRegion").appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  };
  const setConnection = (message, online = false) => {
    if (els.status) els.status.textContent = message;
    if (els.statusDot) els.statusDot.classList.toggle("online", online);
  };
  const showState = (name) => {
    els.loading.hidden = name !== "loading";
    els.error.hidden = name !== "error";
    els.empty.hidden = name !== "empty";
    els.noResults.hidden = name !== "noResults";
  };
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  };
  const formatDate = (value) => {
    if (!value) return "KOMSI library";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "KOMSI library";
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
  };
  const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file";
  const safeFileName = (file) => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${slug(file.name.replace(/\.[^.]+$/, ""))}.${(file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  function setAdminUI() {
    const adminButtons = ["#addSongBtn", "#emptyUploadBtn", "#heroAdminBtn"];
    adminButtons.forEach(selector => {
      const button = $(selector);
      if (button) button.hidden = false;
    });
    if (els.login) {
      els.login.hidden = isAdmin();
      els.login.textContent = "Login Admin";
    }
    if (els.memberAuth) {
      els.memberAuth.hidden = isAdmin();
      const displayName = currentUser?.user_metadata?.display_name;
      els.memberAuth.textContent = currentUser ? (displayName ? String(displayName).slice(0, 18) : "Akun Anggota") : "Login Anggota";
    }
    if (els.logout) { els.logout.hidden = !currentUser; els.logout.textContent = isAdmin() ? "Keluar Admin" : "Keluar"; }
    $$(".delete-song").forEach(button => button.hidden = !isAdmin());
  }

  async function loginAdmin() {
    if (!db) {
      toast("Koneksi Supabase belum siap. Coba muat ulang halaman.", "error");
      return false;
    }
    const emailInput = window.prompt("Email admin Supabase:");
    if (!emailInput) return false;
    const email = emailInput.trim().toLowerCase();
    if (email !== ADMIN_EMAIL.toLowerCase()) {
      toast("Email ini bukan email admin yang diizinkan.", "error");
      return false;
    }
    const password = window.prompt("Password akun Supabase admin:");
    if (!password) return false;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      toast(`Login gagal: ${error.message}`, "error");
      return false;
    }
    if (!data.user || data.user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await db.auth.signOut();
      currentUser = null;
      setAdminUI();
      toast("Akun ini tidak memiliki akses admin.", "error");
      return false;
    }
    currentUser = data.user;
    setAdminUI();
    renderSongs();
    toast("Login admin berhasil. Kamu bisa mengunggah lagu.", "success");
    return true;
  }

  async function logoutAdmin() {
    if (db) {
      const { error } = await db.auth.signOut();
      if (error) {
        toast(`Gagal keluar: ${error.message}`, "error");
        return;
      }
    }
    currentUser = null;
    setAdminUI();
    renderSongs();
    closeUploadModal();
    toast("Kamu sudah keluar dari akun.");
  }

  function openUploadModal() {
    if (!isAdmin()) {
      loginAdmin().then(success => {
        if (success && isAdmin()) showUploadModal();
      }).catch(error => toast(error.message || "Login gagal.", "error"));
      return;
    }
    showUploadModal();
  }
  function showUploadModal() {
    els.uploadModal.hidden = false;
    document.body.style.overflow = "hidden";
    const firstInput = $('input[name="title"]', els.uploadForm);
    if (firstInput) firstInput.focus();
  }
  function closeUploadModal() {
    els.uploadModal.hidden = true;
    document.body.style.overflow = "";
  }

  async function loadSongs() {
    showState("loading");
    els.grid.innerHTML = "";
    setConnection("Menghubungkan", false);
    if (!db) {
      showState("error");
      els.errorMessage.textContent = "Supabase JS belum termuat. Periksa koneksi internet lalu muat ulang.";
      setConnection("Tidak terhubung", false);
      return;
    }
    const { data, error } = await db.from("songs")
      .select("id,title,artist,genre,audio_url,cover_url,duration,play_count,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      showState("error");
      els.errorMessage.textContent = `Supabase: ${error.message}`;
      setConnection("Periksa koneksi", false);
      console.error("Supabase load songs:", error);
      return;
    }
    songs = Array.isArray(data) ? data : [];
    setConnection("Terhubung", true);
    updateStats();
    buildGenreChips();
    renderSongs();
  }

  function updateStats() {
    const genres = new Set(songs.map(song => clean(song.genre)).filter(Boolean));
    els.totalSongs.textContent = String(songs.length);
    els.totalGenres.textContent = String(genres.size);
    const totalPlays = songs.reduce((sum, song) => sum + Number(song.play_count || 0), 0);
    const genrePlays = new Map();
    songs.forEach(song => {
      const genre = clean(song.genre) || "Lainnya";
      genrePlays.set(genre, (genrePlays.get(genre) || 0) + Number(song.play_count || 0));
    });
    const topGenre = [...genrePlays.entries()].sort((a, b) => b[1] - a[1])[0];
    const totalPlaysEl = $("#totalPlays");
    const topGenreEl = $("#topPlayedGenre");
    if (totalPlaysEl) totalPlaysEl.textContent = String(totalPlays);
    if (topGenreEl) topGenreEl.textContent = topGenre && topGenre[1] > 0 ? topGenre[0] : "—";
    const ranking = $("#topSongsList");
    const topSongCount = $("#topSongCount");
    if (topSongCount) topSongCount.textContent = String(songs.filter(song => Number(song.play_count || 0) > 0).length);
    if (ranking) {
      const topSongs = [...songs].filter(song => Number(song.play_count || 0) > 0)
        .sort((a, b) => Number(b.play_count || 0) - Number(a.play_count || 0)).slice(0, 5);
      const maxPlays = Math.max(1, ...topSongs.map(song => Number(song.play_count || 0)));
      ranking.innerHTML = topSongs.length ? topSongs.map((song, index) => {
        const plays = Number(song.play_count || 0);
        const width = Math.max(4, Math.round((plays / maxPlays) * 100));
        return `<div class="ranking-item">
          <span class="ranking-position">${index + 1}</span>
          <div class="ranking-main">
            <div class="ranking-copy"><strong>${escapeHTML(song.title || "Tanpa judul")}</strong><span>${escapeHTML(song.artist || "Artis tidak diketahui")}</span></div>
            <div class="ranking-track"><span style="width:${width}%"></span></div>
          </div>
          <strong class="ranking-plays">${plays.toLocaleString("id-ID")} <small>play</small></strong>
        </div>`;
      }).join("") : '<p class="ranking-empty">Belum ada lagu yang diputar. Yuk, mulai dengarkan koleksi KOMSI.</p>';
    }
    els.heroMeta.textContent = `${songs.length} lagu dalam koleksi`;
  }

  function loadFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem("komsiMusicFavorites") || "[]");
      favoriteIds = new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch (error) {
      console.warn("Favorit lokal tidak dapat dibaca:", error);
      favoriteIds = new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem("komsiMusicFavorites", JSON.stringify([...favoriteIds]));
    } catch (error) {
      toast("Favorit tidak dapat disimpan di perangkat ini.", "error");
    }
  }

  function toggleFavorite(id) {
    const key = String(id);
    if (favoriteIds.has(key)) favoriteIds.delete(key);
    else favoriteIds.add(key);
    saveFavorites();
    renderSongs();
    toast(favoriteIds.has(key) ? "Ditambahkan ke favorit." : "Dihapus dari favorit.", "success");
  }

  function updateActiveNavigation() {
    const activeId = activeView === "favorites" ? "favoritesNav" : activeView === "all" ? "allSongsNav" : activeView === "playlist" ? "" : "homeNav";
    ["#homeNav", "#allSongsNav", "#favoritesNav"].forEach(selector => {
      const button = $(selector);
      if (button) button.classList.toggle("active", button.id === activeId);
    });
    $$("#playlistNavList .playlist-nav-item").forEach(button => button.classList.toggle("active", button.dataset.playlistId === activePlaylistId && activeView === "playlist"));
  }

  function loadPlaylists() {
    try {
      const saved = JSON.parse(localStorage.getItem("komsiMusicPlaylists") || "[]");
      playlists = Array.isArray(saved) ? saved.filter(item => item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.songIds)).map(item => ({ id: item.id, name: item.name.slice(0, 50), songIds: [...new Set(item.songIds.map(String))] })) : [];
    } catch (error) {
      console.warn("Playlist lokal tidak dapat dibaca:", error);
      playlists = [];
    }
    renderPlaylistNavigation();
  }

  function savePlaylists() {
    try {
      localStorage.setItem("komsiMusicPlaylists", JSON.stringify(playlists));
    } catch (error) {
      toast("Playlist tidak dapat disimpan di perangkat ini.", "error");
    }
  }

  function renderPlaylistNavigation() {
    const container = $("#playlistNavList");
    if (!container) return;
    container.innerHTML = playlists.length ? playlists.map(list => `
      <div class="playlist-nav-row">
        <button class="playlist-nav-item" data-playlist-id="${escapeHTML(list.id)}" type="button"><span class="playlist-nav-icon">♫</span><span>${escapeHTML(list.name)}</span><small>${list.songIds.length}</small></button>
        <button class="playlist-delete" data-delete-playlist-id="${escapeHTML(list.id)}" type="button" aria-label="Hapus playlist ${escapeHTML(list.name)}" title="Hapus playlist">×</button>
      </div>`).join("") : '<p class="playlist-nav-empty">Belum ada playlist</p>';
    updateActiveNavigation();
  }

  function createPlaylist() {
    const name = clean(window.prompt("Nama playlist baru:"));
    if (!name) return;
    if (playlists.some(item => item.name.toLocaleLowerCase("id") === name.toLocaleLowerCase("id"))) {
      toast("Nama playlist tersebut sudah digunakan.", "error");
      return;
    }
    playlists.unshift({ id: `pl-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name: name.slice(0,50), songIds: [] });
    savePlaylists();
    renderPlaylistNavigation();
    toast("Playlist berhasil dibuat.", "success");
  }

  function addSongToPlaylist(songId) {
    if (!playlists.length) {
      const create = window.confirm("Kamu belum punya playlist. Buat playlist sekarang?");
      if (!create) return;
      createPlaylist();
      if (!playlists.length) return;
    }
    const choices = playlists.map((list, index) => `${index + 1}. ${list.name}`).join("\n");
    const answer = window.prompt(`Tambahkan lagu ke playlist nomor berapa?\n\n${choices}`, "1");
    if (answer === null) return;
    const index = Number(answer) - 1;
    const list = Number.isInteger(index) ? playlists[index] : null;
    if (!list) { toast("Nomor playlist tidak valid.", "error"); return; }
    const key = String(songId);
    if (list.songIds.includes(key)) { toast("Lagu sudah ada di playlist ini."); return; }
    list.songIds.push(key);
    savePlaylists();
    renderPlaylistNavigation();
    toast(`Lagu ditambahkan ke playlist "${list.name}".`, "success");
  }

  function removeSongFromPlaylist(songId) {
    const list = playlists.find(item => item.id === activePlaylistId);
    if (!list) return;
    list.songIds = list.songIds.filter(id => id !== String(songId));
    savePlaylists();
    renderPlaylistNavigation();
    renderSongs();
    toast("Lagu dihapus dari playlist.");
  }

  function deletePlaylist(id) {
    const list = playlists.find(item => item.id === id);
    if (!list || !window.confirm(`Hapus playlist "${list.name}"? Lagu aslinya tidak akan dihapus.`)) return;
    playlists = playlists.filter(item => item.id !== id);
    if (activePlaylistId === id) { activePlaylistId = null; activeView = "discover"; }
    savePlaylists();
    renderPlaylistNavigation();
    renderSongs();
    toast("Playlist dihapus.");
  }

  function buildGenreChips() {
    const genres = [...new Set(songs.map(song => clean(song.genre)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id"));
    const all = [{ value: "all", label: "Semua" }, ...genres.map(genre => ({ value: genre, label: genre }))];
    els.chips.innerHTML = all.map(item =>
      `<button class="chip ${activeGenre === item.value ? "active" : ""}" data-genre="${escapeHTML(item.value)}" type="button">${escapeHTML(item.label)}</button>`
    ).join("");
  }

  function getFilteredSongs() {
    const query = clean(els.search.value).toLocaleLowerCase("id");
    const result = songs.filter(song => {
      const matchesGenre = activeGenre === "all" || clean(song.genre) === activeGenre;
      const matchesView = activeView !== "favorites" || favoriteIds.has(String(song.id));
      const matchesPlaylist = activeView !== "playlist" || Boolean(playlists.find(list => list.id === activePlaylistId)?.songIds.includes(String(song.id)));
      const haystack = [song.title, song.artist, song.genre, song.album].map(clean).join(" ").toLocaleLowerCase("id");
      return matchesGenre && matchesView && matchesPlaylist && (!query || haystack.includes(query));
    });
    const sort = els.sort.value;
    result.sort((a, b) => {
      if (sort === "oldest") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sort === "az") return clean(a.title).localeCompare(clean(b.title), "id");
      if (sort === "za") return clean(b.title).localeCompare(clean(a.title), "id");
      if (sort === "played") return Number(b.play_count || 0) - Number(a.play_count || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return result;
  }

  function renderSongs() {
    if (!songs.length) {
      els.grid.innerHTML = "";
      showState("empty");
      updateStats();
      return;
    }
    filteredSongs = getFilteredSongs();
    if (!filteredSongs.length) {
      els.grid.innerHTML = "";
      showState("noResults");
      const title = $("#noResultsState strong");
      const description = $("#noResultsState p");
      if (activeView === "favorites" && !favoriteIds.size) {
        if (title) title.textContent = "Belum ada lagu favorit";
        if (description) description.textContent = "Tekan ikon hati pada lagu untuk menyimpannya di sini.";
      } else if (activeView === "playlist") {
        if (title) title.textContent = "Playlist ini masih kosong";
        if (description) description.textContent = "Tambahkan lagu menggunakan tombol + Playlist pada kartu lagu.";
      } else {
        if (title) title.textContent = "Lagu tidak ditemukan";
        if (description) description.textContent = "Coba kata kunci atau filter genre yang berbeda.";
      }
      return;
    }
    const noResultsTitle = $("#noResultsState strong");
    const noResultsDescription = $("#noResultsState p");
    if (noResultsTitle) noResultsTitle.textContent = "Lagu tidak ditemukan";
    if (noResultsDescription) noResultsDescription.textContent = "Coba kata kunci atau filter genre yang berbeda.";
    showState("none");
    els.grid.innerHTML = filteredSongs.map((song, index) => {
      const title = escapeHTML(song.title || "Tanpa judul");
      const artist = escapeHTML(song.artist || "Artis tidak diketahui");
      const genre = escapeHTML(song.genre || "Uncategorized");
      const cover = clean(song.cover_url);
      const coverHTML = cover
        ? `<img class="song-cover" src="${escapeHTML(cover)}" alt="Cover ${title}" loading="lazy" onerror="this.outerHTML='<div class=&quot;cover-placeholder&quot;>♫</div>'">`
        : `<div class="cover-placeholder">♫</div>`;
      return `<article class="song-card" data-song-id="${escapeHTML(song.id)}">
        <div class="song-art-wrap">${coverHTML}
          <button class="song-play" type="button" data-play-id="${escapeHTML(song.id)}" aria-label="Putar ${title}" title="Putar lagu">▶</button>
        </div>
        <div class="song-topline"><span class="song-genre">${genre}</span><span class="song-count">▶ ${Number(song.play_count || 0)}</span></div>
        <h3 class="song-title" title="${title}">${title}</h3>
        <p class="song-artist" title="${artist}">${artist}</p>
        <div class="song-bottom"><span class="song-date">${escapeHTML(formatDate(song.created_at))}</span>
        <button class="favorite-song ${favoriteIds.has(String(song.id)) ? "is-favorite" : ""}" data-favorite-id="${escapeHTML(song.id)}" type="button" aria-label="${favoriteIds.has(String(song.id)) ? "Hapus dari" : "Tambah ke"} favorit" aria-pressed="${favoriteIds.has(String(song.id))}">${favoriteIds.has(String(song.id)) ? "♥" : "♡"}</button>
        ${activeView === "playlist" ? `<button class="add-playlist-song remove-playlist-song" data-remove-playlist-song-id="${escapeHTML(song.id)}" type="button" aria-label="Hapus dari playlist" title="Hapus dari playlist">−</button>` : `<button class="add-playlist-song" data-playlist-song-id="${escapeHTML(song.id)}" type="button" aria-label="Tambahkan ke playlist" title="Tambahkan ke playlist">＋</button>`}
        ${isAdmin() ? `<button class="delete-song" data-delete-id="${escapeHTML(song.id)}" type="button">Hapus</button>` : ""}</div>
      </article>`;
    }).join("");
  }

  function findSongIndex(id) {
    return songs.findIndex(song => String(song.id) === String(id));
  }
  function getPlaybackQueue() {
    if (activeView === "playlist") {
      const list = playlists.find(item => item.id === activePlaylistId);
      if (!list) return [];
      return list.songIds.map(id => songs.find(song => String(song.id) === id)).filter(Boolean);
    }
    return songs;
  }
  function movePlayback(step) {
    const queue = getPlaybackQueue();
    if (!queue.length) { toast("Playlist ini belum memiliki lagu."); return; }
    const currentId = currentSongIndex >= 0 ? String(songs[currentSongIndex]?.id) : "";
    const position = queue.findIndex(song => String(song.id) === currentId);
    if (shufflePlaylist && step > 0 && queue.length > 1) { const choices = queue.filter(song => String(song.id) !== currentId); playSongById(choices[Math.floor(Math.random() * choices.length)].id); return; }
    const nextPosition = position < 0 ? (step > 0 ? 0 : queue.length - 1) : (position + step + queue.length) % queue.length;
    playSongById(queue[nextPosition].id);
  }
  function playSongById(id) {
    const index = findSongIndex(id);
    if (index < 0) return;
    currentSongIndex = index;
    playSessionId += 1;
    const song = songs[index];
    if (!song.audio_url) {
      toast("File audio untuk lagu ini belum tersedia.", "error");
      return;
    }
    els.audio.src = song.audio_url;
    els.audio.volume = Number(els.volume.value || 0.8);
    els.playerTitle.textContent = song.title || "Tanpa judul";
    els.playerArtist.textContent = song.artist || "Artis tidak diketahui";
    els.playerCover.innerHTML = song.cover_url
      ? `<img src="${escapeHTML(song.cover_url)}" alt="">`
      : "<span>♫</span>";
    els.playPause.textContent = "Ⅱ";
    els.playPause.title = "Jeda";
    const playPromise = els.audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(error => {
        els.playPause.textContent = "▶";
        toast("Lagu belum bisa diputar. Periksa URL atau format file audio.", "error");
        console.warn("Audio play error:", error);
      });
    }
  }

  async function deleteSong(id) {
    if (!isAdmin()) {
      toast("Login admin diperlukan.", "error");
      return;
    }
    const song = songs.find(item => String(item.id) === String(id));
    if (!song) {
      toast("Data lagu tidak ditemukan. Muat ulang library.", "error");
      return;
    }
    if (!window.confirm(`Hapus lagu "${song.title}" dari library?`)) return;

    try {
      // Jangan bergantung pada baris hasil DELETE: policy SELECT dapat
      // menyembunyikan representation meskipun DELETE berhasil.
      const { error } = await db.from("songs").delete().eq("id", id);
      if (error) {
        console.error("Delete song database error:", error);
        toast(`Lagu gagal dihapus: ${error.message}`, "error");
        return;
      }

      // Verifikasi dari daftar yang dapat dibaca aplikasi setelah penghapusan.
      await loadSongs();
      const stillExists = songs.some(item => String(item.id) === String(id));
      if (stillExists) {
        toast("Lagu masih ada di database. Periksa izin DELETE / policy RLS Supabase.", "error");
        return;
      }

      const cleanupErrors = [];
      const removeStorageFile = async (url, bucket) => {
        const marker = `/storage/v1/object/public/${bucket}/`;
        if (!url || !url.includes(marker)) return;
        const encodedPath = url.split(marker)[1]?.split(/[?#]/)[0];
        if (!encodedPath) return;
        let path;
        try {
          path = decodeURIComponent(encodedPath);
        } catch {
          path = encodedPath;
        }
        const { error: storageError } = await db.storage.from(bucket).remove([path]);
        if (storageError) {
          console.error(`Storage cleanup error (${bucket}):`, storageError);
          cleanupErrors.push(bucket);
        }
      };

      await removeStorageFile(song.audio_url, AUDIO_BUCKET);
      await removeStorageFile(song.cover_url, COVERS_BUCKET);

      if (cleanupErrors.length) {
        toast("Lagu berhasil dihapus, tetapi file audio/cover belum semuanya terhapus dari Storage.", "error");
      } else {
        toast("Lagu berhasil dihapus.", "success");
      }
    } catch (error) {
      console.error("Unexpected delete error:", error);
      toast(`Terjadi kesalahan saat menghapus lagu: ${error.message || "Coba lagi."}`, "error");
    }
  }

  function setUploadProgress(percent, message) {
    els.uploadProgress.hidden = false;
    els.uploadProgressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    els.uploadProgressText.textContent = message;
  }

  async function uploadFile(bucket, file) {
    const path = safeFileName(file);
    const { error } = await db.storage.from(bucket).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || undefined
    });
    if (error) throw new Error(`${bucket}: ${error.message}`);
    const { data } = db.storage.from(bucket).getPublicUrl(path);
    if (!data || !data.publicUrl) throw new Error(`URL publik untuk bucket ${bucket} tidak tersedia.`);
    return data.publicUrl;
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (isBusy) return;
    if (!isAdmin()) {
      toast("Login admin diperlukan untuk upload.", "error");
      return;
    }
    const formData = new FormData(els.uploadForm);
    const title = clean(formData.get("title"));
    const artist = clean(formData.get("artist"));
    const genre = clean(formData.get("genre")) || "Lainnya";
    const audioFile = formData.get("audio");
    const coverFile = formData.get("cover");
    if (!title) {
      toast("Judul lagu wajib diisi.", "error");
      return;
    }
    if (!(audioFile instanceof File) || !audioFile.size) {
      toast("Pilih file audio terlebih dahulu.", "error");
      return;
    }
    if (audioFile.size > 100 * 1024 * 1024) {
      toast("Ukuran file audio maksimal 100 MB.", "error");
      return;
    }
    if (coverFile instanceof File && coverFile.size > 10 * 1024 * 1024) {
      toast("Ukuran cover maksimal 10 MB.", "error");
      return;
    }

    isBusy = true;
    els.submitUpload.disabled = true;
    els.submitUpload.textContent = "Mengunggah...";
    try {
      setUploadProgress(8, "Mengunggah file audio...");
      const audioUrl = await uploadFile(AUDIO_BUCKET, audioFile);
      let coverUrl = null;
      if (coverFile instanceof File && coverFile.size) {
        setUploadProgress(52, "Mengunggah cover lagu...");
        coverUrl = await uploadFile(COVERS_BUCKET, coverFile);
      }
      setUploadProgress(82, "Menyimpan informasi lagu...");
      const { error } = await db.from("songs").insert({
        title, artist: artist || null, genre, audio_url: audioUrl,
        cover_url: coverUrl, duration: null, play_count: 0
      });
      if (error) throw new Error(`Database: ${error.message}`);
      setUploadProgress(100, "Upload berhasil!");
      els.uploadForm.reset();
      toast("Lagu berhasil ditambahkan ke KOMSI Music Library.", "success");
      await loadSongs();
      window.setTimeout(closeUploadModal, 450);
    } catch (error) {
      console.error("Upload failed:", error);
      toast(`Upload gagal: ${error.message || "Terjadi kesalahan."}`, "error");
      setUploadProgress(0, "Upload gagal. Periksa policy Supabase dan koneksi.");
    } finally {
      isBusy = false;
      els.submitUpload.disabled = false;
      els.submitUpload.innerHTML = 'Upload ke library <span>↗</span>';
    }
  }

  function bindEvents() {
    els.login.addEventListener("click", () => loginAdmin());
    els.logout.addEventListener("click", logoutAdmin);
    els.memberAuth.addEventListener("click", () => currentUser && !isAdmin() ? openProfile() : openMemberAuth());
    $("#closeProfileBtn").addEventListener("click", closeProfile);
    $("#cancelProfileBtn").addEventListener("click", closeProfile);
    $("#profileModal").addEventListener("click", event => { if (event.target === $("#profileModal")) closeProfile(); });
    $("#profileForm").addEventListener("submit", handleProfileUpdate);
    $("#closeMemberAuthBtn").addEventListener("click", closeMemberAuth);
    els.memberAuthModal.addEventListener("click", e => { if (e.target === els.memberAuthModal) closeMemberAuth(); });
    $("#memberSignInTab").addEventListener("click", () => setMemberAuthMode(false));
    $("#memberSignUpTab").addEventListener("click", () => setMemberAuthMode(true));
    $("#memberSignInForm").addEventListener("submit", handleMemberSignIn);
    $("#memberSignUpForm").addEventListener("submit", handleMemberSignUp);
    ["#addSongBtn", "#emptyUploadBtn", "#heroAdminBtn"].forEach(selector => {
      const button = $(selector);
      if (button) button.addEventListener("click", openUploadModal);
    });
    $("#closeModalBtn").addEventListener("click", closeUploadModal);
    $("#cancelUploadBtn").addEventListener("click", closeUploadModal);
    els.uploadModal.addEventListener("click", event => {
      if (event.target === els.uploadModal) closeUploadModal();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !els.uploadModal.hidden) closeUploadModal();
    });
    els.uploadForm.addEventListener("submit", handleUpload);
    els.search.addEventListener("input", renderSongs);
    els.sort.addEventListener("change", renderSongs);
    els.chips.addEventListener("click", event => {
      const button = event.target.closest("[data-genre]");
      if (!button) return;
      activeGenre = button.dataset.genre || "all";
      $$(".chip", els.chips).forEach(chip => chip.classList.toggle("active", chip === button));
      renderSongs();
    });
    els.grid.addEventListener("click", event => {
      const favorite = event.target.closest("[data-favorite-id]");
      if (favorite) { toggleFavorite(favorite.dataset.favoriteId); return; }
      const addPlaylist = event.target.closest("[data-playlist-song-id]");
      if (addPlaylist) { addSongToPlaylist(addPlaylist.dataset.playlistSongId); return; }
      const removePlaylist = event.target.closest("[data-remove-playlist-song-id]");
      if (removePlaylist) { removeSongFromPlaylist(removePlaylist.dataset.removePlaylistSongId); return; }
      const play = event.target.closest("[data-play-id]");
      if (play) {
        const id = play.dataset.playId;
        if (currentSongIndex >= 0 && String(songs[currentSongIndex]?.id) === String(id) && !els.audio.paused) {
          els.audio.pause();
        } else playSongById(id);
        return;
      }
      const remove = event.target.closest("[data-delete-id]");
      if (remove) deleteSong(remove.dataset.deleteId);
    });
    $("#retryBtn").addEventListener("click", loadSongs);
    $("#clearFiltersBtn").addEventListener("click", () => {
      els.search.value = "";
      if (activeView === "playlist") { activeView = "discover"; activePlaylistId = null; updateActiveNavigation(); }
      activeGenre = "all";
      els.sort.value = "newest";
      buildGenreChips();
      renderSongs();
    });
    $("#exploreBtn").addEventListener("click", () => $("#librarySection").scrollIntoView({ behavior: "smooth" }));
    $("#homeNav").addEventListener("click", () => {
      activeView = "discover";
      activePlaylistId = null;
      updateActiveNavigation();
      renderSongs();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#allSongsNav").addEventListener("click", () => {
      activeView = "all";
      activePlaylistId = null;
      updateActiveNavigation();
      renderSongs();
      $("#librarySection").scrollIntoView({ behavior: "smooth" });
    });
    $("#favoritesNav").addEventListener("click", () => {
      activeView = "favorites";
      activePlaylistId = null;
      updateActiveNavigation();
      renderSongs();
      $("#librarySection").scrollIntoView({ behavior: "smooth" });
    });
    $("#createPlaylistBtn").addEventListener("click", createPlaylist);
    $("#playlistPlayBtn").addEventListener("click", () => playActivePlaylist(false));
    $("#playlistShuffleBtn").addEventListener("click", () => { shufflePlaylist = !shufflePlaylist; renderPlaylistDetail(); toast(shufflePlaylist ? "Mode acak aktif." : "Mode acak nonaktif."); });
    $("#playlistRenameBtn").addEventListener("click", renameActivePlaylist);
    $("#playlistClearBtn").addEventListener("click", clearActivePlaylist);
    $("#playlistNavList").addEventListener("click", event => {
      const remove = event.target.closest("[data-delete-playlist-id]");
      if (remove) { deletePlaylist(remove.dataset.deletePlaylistId); return; }
      const item = event.target.closest("[data-playlist-id]");
      if (!item) return;
      activeView = "playlist";
      activePlaylistId = item.dataset.playlistId;
      activeGenre = "all";
      buildGenreChips();
      updateActiveNavigation();
      renderSongs();
      $("#librarySection").scrollIntoView({ behavior: "smooth" });
    });
    $("#prevBtn").addEventListener("click", () => movePlayback(-1));
    $("#nextBtn").addEventListener("click", () => movePlayback(1));
    els.playPause.addEventListener("click", () => {
      if (!els.audio.src) {
        const queue = getPlaybackQueue();
        if (queue.length) playSongById(queue[0].id);
        else toast("Belum ada lagu untuk diputar.");
        return;
      }
      if (els.audio.paused) els.audio.play().catch(() => toast("Lagu gagal diputar.", "error"));
      else els.audio.pause();
    });
    els.audio.addEventListener("play", async () => {
      els.playPause.textContent = "Ⅱ";
      els.playPause.title = "Jeda";
      const song = songs[currentSongIndex];
      const sessionId = playSessionId;
      if (!song || !db || countedPlaySessionId === sessionId || pendingPlaySessionId === sessionId) return;

      // Tandai sebagai pending agar event berulang tidak mengirim RPC ganda.
      pendingPlaySessionId = sessionId;
      const songId = String(song.id);
      const { error } = await db.rpc("increment_song_play_count", { p_song_id: songId });
      if (error) {
        if (pendingPlaySessionId === sessionId) pendingPlaySessionId = -1;
        console.error("Gagal mencatat pemutaran lagu:", error);
        return;
      }

      countedPlaySessionId = sessionId;
      if (pendingPlaySessionId === sessionId) pendingPlaySessionId = -1;
      const updatedSong = songs.find(item => String(item.id) === songId);
      if (updatedSong) updatedSong.play_count = Number(updatedSong.play_count || 0) + 1;
      updateStats();
      renderSongs();
    });
    els.audio.addEventListener("pause", () => { els.playPause.textContent = "▶"; els.playPause.title = "Putar"; });
    els.audio.addEventListener("loadedmetadata", () => { els.duration.textContent = formatTime(els.audio.duration); });
    els.audio.addEventListener("timeupdate", () => {
      els.currentTime.textContent = formatTime(els.audio.currentTime);
      if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
        els.progress.value = String((els.audio.currentTime / els.audio.duration) * 100);
      }
    });
    els.audio.addEventListener("ended", () => {
      const queue = getPlaybackQueue();
      if (queue.length > 1) movePlayback(1);
    });
    els.audio.addEventListener("error", () => {
      if (els.audio.src) toast("File audio tidak dapat dibaca. Pastikan format dan URL benar.", "error");
    });
    els.progress.addEventListener("input", () => {
      if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
        els.audio.currentTime = (Number(els.progress.value) / 100) * els.audio.duration;
      }
    });
    els.volume.addEventListener("input", () => { els.audio.volume = Number(els.volume.value); });
    window.addEventListener("online", () => { if (db) loadSongs(); });
    window.addEventListener("offline", () => setConnection("Offline", false));
  }

  async function init() {
    $("#yearText").textContent = String(new Date().getFullYear());
    bindEvents(); updateActiveNavigation(); setAdminUI();
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showState("error"); els.errorMessage.textContent = "Library Supabase JS belum termuat."; setConnection("Tidak terhubung", false); return;
    }
    try {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data, error } = await db.auth.getSession();
      if (error) console.warn("Get session:", error.message);
      currentUser = data && data.session ? data.session.user : null;
      if (currentUser && !isAdmin()) await loadMemberData();
      setAdminUI();
      db.auth.onAuthStateChange((event, session) => {
        currentUser = session ? session.user : null; setAdminUI();
        if (!currentUser) {
          favoriteIds = new Set(); playlists = [];
          if (activeView === "favorites" || activeView === "playlist") { activeView = "discover"; activePlaylistId = null; }
          renderPlaylistNavigation(); renderSongs();
        } else if (event === "SIGNED_IN" && !isAdmin()) {
          loadMemberData().then(renderSongs).catch(err => toast("Sinkronisasi gagal: " + err.message, "error"));
        }
      });
      await loadSongs(); renderSongs();
    } catch (error) {
      console.error("Initialization error:", error); showState("error");
      els.errorMessage.textContent = error.message || "Supabase gagal diinisialisasi."; setConnection("Tidak terhubung", false);
    }
  }



  function openProfile() {
    if (!currentUser || isAdmin()) return;
    $("#profileName").value = currentUser.user_metadata?.display_name || "";
    $("#profileEmail").value = currentUser.email || "";
    $("#profileForm").elements.newPassword.value = "";
    $("#profileForm").elements.confirmNewPassword.value = "";
    $("#profileModal").hidden = false;
    document.body.style.overflow = "hidden";
    $("#profileName").focus();
  }
  function closeProfile() {
    $("#profileModal").hidden = true;
    document.body.style.overflow = "";
  }
  async function handleProfileUpdate(event) {
    event.preventDefault();
    if (!currentUser || isAdmin()) return;
    const form = event.currentTarget;
    const name = clean(form.elements.displayName.value);
    const password = form.elements.newPassword.value;
    const confirmation = form.elements.confirmNewPassword.value;
    if (!name) { toast("Nama tampilan tidak boleh kosong.", "error"); return; }
    if (password && password.length < 6) { toast("Password baru minimal 6 karakter.", "error"); return; }
    if (password !== confirmation) { toast("Konfirmasi password baru tidak sama.", "error"); return; }
    const button = $("#saveProfileBtn");
    button.disabled = true;
    button.textContent = "Menyimpan...";
    try {
      const updates = { data: { ...(currentUser.user_metadata || {}), display_name: name } };
      if (password) updates.password = password;
      const { data, error } = await db.auth.updateUser(updates);
      if (error) throw error;
      currentUser = data.user || currentUser;
      setAdminUI();
      closeProfile();
      toast(password ? "Profil dan password berhasil diperbarui." : "Nama profil berhasil diperbarui.", "success");
    } catch (error) {
      toast("Profil gagal diperbarui: " + error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Simpan perubahan";
    }
  }

  function openMemberAuth() {
    els.memberAuthModal.hidden = false;
    document.body.style.overflow = "hidden";
    setMemberAuthMode(false);
  }
  function closeMemberAuth() {
    els.memberAuthModal.hidden = true;
    document.body.style.overflow = "";
  }
  function setMemberAuthMode(signup) {
    $("#memberSignInForm").hidden = signup;
    $("#memberSignUpForm").hidden = !signup;
    $("#memberSignInTab").classList.toggle("active", !signup);
    $("#memberSignUpTab").classList.toggle("active", signup);
  }
  async function handleMemberSignIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = clean(form.elements.email.value).toLowerCase();
    if (email === ADMIN_EMAIL.toLowerCase()) {
      toast("Gunakan tombol Login Admin.", "error");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await db.auth.signInWithPassword({ email: email, password: form.elements.password.value });
      if (result.error) throw result.error;
      closeMemberAuth();
      form.reset();
      await loadMemberData();
      setAdminUI();
      renderSongs();
      toast("Berhasil masuk. Favorit dan playlist sudah disinkronkan.", "success");
    } catch (error) {
      toast("Login gagal: " + error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  async function handleMemberSignUp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = clean(form.elements.name.value);
    const email = clean(form.elements.email.value).toLowerCase();
    const password = form.elements.password.value;
    if (email === ADMIN_EMAIL.toLowerCase()) {
      toast("Email admin tidak dapat dipakai untuk daftar anggota.", "error");
      return;
    }
    if (password.length < 6) {
      toast("Password minimal 6 karakter.", "error");
      return;
    }
    if (password !== form.elements.confirmPassword.value) {
      toast("Konfirmasi password tidak sama.", "error");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await db.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { display_name: name },
          emailRedirectTo: "https://vanzpro123.github.io/Komsi-Music-Library-/"
        }
      });
      if (result.error) throw result.error;
      form.reset();
      if (result.data.session) {
        closeMemberAuth();
        await loadMemberData();
        setAdminUI();
        renderSongs();
        toast("Akun anggota berhasil dibuat. Selamat datang!", "success");
      } else {
        setMemberAuthMode(false);
        toast("Pendaftaran berhasil. Verifikasi email terlebih dahulu, lalu masuk.", "success");
      }
    } catch (error) {
      toast("Pendaftaran gagal: " + error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  async function loadMemberData() {
    if (!currentUser || isAdmin()) {
      favoriteIds = new Set();
      playlists = [];
      renderPlaylistNavigation();
      return;
    }
    const results = await Promise.all([
      db.from("user_favorites").select("song_id").eq("user_id", currentUser.id),
      db.from("user_playlists").select("id,name,song_ids").eq("user_id", currentUser.id).order("updated_at", { ascending: false })
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    favoriteIds = new Set((results[0].data || []).map(function(row) { return String(row.song_id); }));
    playlists = (results[1].data || []).map(function(row) {
      return { id: String(row.id), name: row.name, songIds: (row.song_ids || []).map(String) };
    });
    renderPlaylistNavigation();
  }
  async function toggleFavorite(id) {
    if (!currentUser || isAdmin()) {
      openMemberAuth();
      toast("Masuk sebagai anggota untuk menyimpan favorit.");
      return;
    }
    const key = String(id);
    const wasSaved = favoriteIds.has(key);
    const result = wasSaved
      ? await db.from("user_favorites").delete().eq("user_id", currentUser.id).eq("song_id", key)
      : await db.from("user_favorites").insert({ user_id: currentUser.id, song_id: key });
    if (result.error) {
      toast("Gagal menyimpan favorit: " + result.error.message, "error");
      return;
    }
    if (wasSaved) favoriteIds.delete(key);
    else favoriteIds.add(key);
    renderSongs();
    toast(wasSaved ? "Dihapus dari favorit." : "Ditambahkan ke favorit.", "success");
  }
  function renderPlaylistDetail() {
    const panel = $("#playlistDetail"); if (!panel) return;
    const list = playlists.find(item => item.id === activePlaylistId);
    panel.hidden = activeView !== "playlist" || !list; if (!list) return;
    const tracks = list.songIds.map(id => songs.find(song => String(song.id) === String(id))).filter(Boolean);
    $("#playlistDetailName").textContent = list.name;
    $("#playlistDetailMeta").textContent = tracks.length + " lagu · Playlist pribadi";
    const cover = tracks.find(song => song.cover_url)?.cover_url;
    $("#playlistDetailCover").innerHTML = cover ? '<img src="' + escapeHTML(cover) + '" alt="Cover playlist">' : "♫";
    $("#playlistPlayBtn").disabled = !tracks.length;
    $("#playlistShuffleBtn").classList.toggle("is-active", shufflePlaylist);
  }
  async function renameActivePlaylist() {
    const list = playlists.find(item => item.id === activePlaylistId); if (!list) return;
    const name = clean(window.prompt("Nama playlist baru:", list.name)).slice(0,50); if (!name || name === list.name) return;
    if (playlists.some(item => item.id !== list.id && item.name.toLowerCase() === name.toLowerCase())) { toast("Nama playlist sudah digunakan.", "error"); return; }
    const old = list.name; list.name = name;
    try { await persistPlaylist(list); renderPlaylistNavigation(); toast("Nama playlist diperbarui.", "success"); } catch (error) { list.name = old; toast("Gagal mengubah nama: " + error.message, "error"); }
  }
  async function clearActivePlaylist() {
    const list = playlists.find(item => item.id === activePlaylistId); if (!list || !list.songIds.length) return;
    if (!window.confirm("Kosongkan semua lagu dari playlist ini?")) return;
    const old = list.songIds.slice(); list.songIds = [];
    try { await persistPlaylist(list); renderPlaylistNavigation(); renderSongs(); toast("Playlist dikosongkan."); } catch (error) { list.songIds = old; toast("Gagal mengosongkan playlist: " + error.message, "error"); }
  }
  function playActivePlaylist(shuffle) {
    const list = playlists.find(item => item.id === activePlaylistId); if (!list) return;
    const ids = list.songIds.filter(id => songs.some(song => String(song.id) === String(id)));
    if (!ids.length) { toast("Playlist belum memiliki lagu."); return; }
    shufflePlaylist = Boolean(shuffle); renderPlaylistDetail();
    const id = shufflePlaylist ? ids[Math.floor(Math.random() * ids.length)] : ids[0]; playSongById(id);
  }
  async function persistPlaylist(list) {
    const result = await db.from("user_playlists").upsert({
      id: list.id,
      user_id: currentUser.id,
      name: list.name,
      song_ids: list.songIds,
      updated_at: new Date().toISOString()
    });
    if (result.error) throw result.error;
  }
  async function createPlaylist() {
    if (!currentUser || isAdmin()) {
      openMemberAuth();
      toast("Masuk sebagai anggota untuk membuat playlist.");
      return;
    }
    const name = clean(window.prompt("Nama playlist baru:")).slice(0, 50);
    if (!name) return;
    if (playlists.some(function(item) { return item.name.toLowerCase() === name.toLowerCase(); })) {
      toast("Nama playlist sudah digunakan.", "error");
      return;
    }
    const result = await db.from("user_playlists")
      .insert({ user_id: currentUser.id, name: name, song_ids: [] })
      .select("id,name,song_ids").single();
    if (result.error) {
      toast("Playlist gagal dibuat: " + result.error.message, "error");
      return;
    }
    playlists.unshift({ id: String(result.data.id), name: result.data.name, songIds: [] });
    renderPlaylistNavigation();
    toast("Playlist berhasil dibuat dan tersimpan.", "success");
  }
  async function addSongToPlaylist(songId) {
    if (!currentUser || isAdmin()) {
      openMemberAuth();
      toast("Masuk sebagai anggota untuk mengelola playlist.");
      return;
    }
    if (!playlists.length) {
      if (!window.confirm("Belum ada playlist. Buat sekarang?")) return;
      await createPlaylist();
      if (!playlists.length) return;
    }
    const options = playlists.map(function(item, index) { return (index + 1) + ". " + item.name; }).join("\n");
    const answer = window.prompt("Pilih nomor playlist:\n\n" + options, "1");
    if (answer === null) return;
    const list = playlists[Number(answer) - 1];
    if (!list) {
      toast("Nomor playlist tidak valid.", "error");
      return;
    }
    const key = String(songId);
    if (list.songIds.includes(key)) {
      toast("Lagu sudah ada di playlist.");
      return;
    }
    list.songIds.push(key);
    try {
      await persistPlaylist(list);
      renderPlaylistNavigation();
      toast("Lagu ditambahkan ke playlist.", "success");
    } catch (error) {
      list.songIds = list.songIds.filter(function(id) { return id !== key; });
      toast("Gagal menyimpan playlist: " + error.message, "error");
    }
  }
  async function removeSongFromPlaylist(songId) {
    const list = playlists.find(function(item) { return item.id === activePlaylistId; });
    if (!list) return;
    const previous = list.songIds.slice();
    list.songIds = list.songIds.filter(function(id) { return id !== String(songId); });
    try {
      await persistPlaylist(list);
      renderPlaylistNavigation();
      renderSongs();
    } catch (error) {
      list.songIds = previous;
      toast("Gagal memperbarui playlist: " + error.message, "error");
    }
  }
  async function deletePlaylist(id) {
    const list = playlists.find(function(item) { return item.id === id; });
    if (!list || !window.confirm("Hapus playlist " + list.name + "? Lagu aslinya tetap aman.")) return;
    const result = await db.from("user_playlists").delete().eq("id", id).eq("user_id", currentUser.id);
    if (result.error) {
      toast("Gagal menghapus playlist: " + result.error.message, "error");
      return;
    }
    playlists = playlists.filter(function(item) { return item.id !== id; });
    if (activePlaylistId === id) {
      activePlaylistId = null;
      activeView = "discover";
    }
    renderPlaylistNavigation();
    renderSongs();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
