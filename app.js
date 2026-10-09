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
    volume: $("#volumeRange"), login: $("#adminLoginBtn"), logout: $("#logoutBtn")
  };

  let db = null;
  let songs = [];
  let filteredSongs = [];
  let currentSongIndex = -1;
  let currentUser = null;
  let activeGenre = "all";
  let isBusy = false;

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
    if (els.logout) els.logout.hidden = !isAdmin();
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
    toast("Kamu sudah keluar dari akun admin.");
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
    els.heroMeta.textContent = `${songs.length} lagu${songs.length === 1 ? "" : ""} dalam koleksi`;
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
      const haystack = [song.title, song.artist, song.genre, song.album].map(clean).join(" ").toLocaleLowerCase("id");
      return matchesGenre && (!query || haystack.includes(query));
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
      return;
    }
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
        ${isAdmin() ? `<button class="delete-song" data-delete-id="${escapeHTML(song.id)}" type="button">Hapus</button>` : ""}</div>
      </article>`;
    }).join("");
  }

  function findSongIndex(id) {
    return songs.findIndex(song => String(song.id) === String(id));
  }
  function playSongById(id) {
    const index = findSongIndex(id);
    if (index < 0) return;
    currentSongIndex = index;
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
    if (!song) return;
    if (!window.confirm(`Hapus lagu "${song.title}" dari library?`)) return;
    const { error } = await db.from("songs").delete().eq("id", id);
    if (error) {
      toast(`Lagu gagal dihapus: ${error.message}`, "error");
      return;
    }
    if (song.audio_url && song.audio_url.includes(`/storage/v1/object/public/${AUDIO_BUCKET}/`)) {
      const path = song.audio_url.split(`/storage/v1/object/public/${AUDIO_BUCKET}/`)[1];
      if (path) await db.storage.from(AUDIO_BUCKET).remove([decodeURIComponent(path)]);
    }
    if (song.cover_url && song.cover_url.includes(`/storage/v1/object/public/${COVERS_BUCKET}/`)) {
      const path = song.cover_url.split(`/storage/v1/object/public/${COVERS_BUCKET}/`)[1];
      if (path) await db.storage.from(COVERS_BUCKET).remove([decodeURIComponent(path)]);
    }
    toast("Lagu berhasil dihapus.", "success");
    await loadSongs();
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
      activeGenre = "all";
      els.sort.value = "newest";
      buildGenreChips();
      renderSongs();
    });
    $("#exploreBtn").addEventListener("click", () => $("#librarySection").scrollIntoView({ behavior: "smooth" }));
    $("#homeNav").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    $("#allSongsNav").addEventListener("click", () => $("#librarySection").scrollIntoView({ behavior: "smooth" }));
    $("#prevBtn").addEventListener("click", () => {
      if (!songs.length) return;
      const index = currentSongIndex <= 0 ? songs.length - 1 : currentSongIndex - 1;
      playSongById(songs[index].id);
    });
    $("#nextBtn").addEventListener("click", () => {
      if (!songs.length) return;
      const index = currentSongIndex < 0 || currentSongIndex >= songs.length - 1 ? 0 : currentSongIndex + 1;
      playSongById(songs[index].id);
    });
    els.playPause.addEventListener("click", () => {
      if (!els.audio.src) {
        if (songs.length) playSongById(songs[0].id);
        else toast("Belum ada lagu untuk diputar.");
        return;
      }
      if (els.audio.paused) els.audio.play().catch(() => toast("Lagu gagal diputar.", "error"));
      else els.audio.pause();
    });
    els.audio.addEventListener("play", () => { els.playPause.textContent = "Ⅱ"; els.playPause.title = "Jeda"; });
    els.audio.addEventListener("pause", () => { els.playPause.textContent = "▶"; els.playPause.title = "Putar"; });
    els.audio.addEventListener("loadedmetadata", () => { els.duration.textContent = formatTime(els.audio.duration); });
    els.audio.addEventListener("timeupdate", () => {
      els.currentTime.textContent = formatTime(els.audio.currentTime);
      if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
        els.progress.value = String((els.audio.currentTime / els.audio.duration) * 100);
      }
    });
    els.audio.addEventListener("ended", () => {
      if (songs.length > 1) {
        const index = currentSongIndex >= songs.length - 1 ? 0 : currentSongIndex + 1;
        playSongById(songs[index].id);
      }
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
    bindEvents();
    setAdminUI();
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showState("error");
      els.errorMessage.textContent = "Library Supabase JS tidak berhasil dimuat. Periksa koneksi internet.";
      setConnection("Tidak terhubung", false);
      return;
    }
    try {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await db.auth.getSession();
      if (error) console.warn("Get session:", error.message);
      currentUser = data?.session?.user || null;
      if (currentUser && currentUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        await db.auth.signOut();
        currentUser = null;
      }
      db.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        if (currentUser && currentUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          currentUser = null;
          db.auth.signOut().catch(() => {});
        }
        setAdminUI();
        renderSongs();
      });
      setAdminUI();
      await loadSongs();
    } catch (error) {
      console.error("Initialization error:", error);
      showState("error");
      els.errorMessage.textContent = error.message || "Supabase gagal diinisialisasi.";
      setConnection("Tidak terhubung", false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
