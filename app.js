/* KOMSI MUSIC LIBRARY — Supabase version
   Public visitors can browse and play songs.
   Only the configured admin email can upload or delete songs.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://dqbzjzsteuaraqfsatpb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3ft4ELVXRGVtOayaRd8YA_QxVl5E1p";
  const ADMIN_EMAIL = "webukmkomsiuinkhasjember@gmail.com";
  const AUDIO_BUCKET = "audio";
  const COVER_BUCKET = "covers";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  let db = null;
  let songs = [];
  let filteredSongs = [];
  let activeSongIndex = -1;
  let currentUser = null;
  let audio = new Audio();
  audio.preload = "metadata";

  const els = {
    search: $("#searchInput"),
    genre: $("#genreFilter"),
    sort: $("#sortSelect"),
    songList: $("#songList"),
    songCount: $("#songCount"),
    addSongBtn: $("#addSongBtn"),
    emptyUploadBtn: $("#emptyUploadBtn"),
    heroAdminBtn: $("#heroAdminBtn"),
    mobileAdminBtn: $("#mobileAdminBtn"),
    closeModal: $("#closeModal"),
    cancelUpload: $("#cancelUpload"),
    uploadModal: $("#uploadModal"),
    uploadForm: $("#uploadForm"),
    audioFile: $("#audioFile"),
    coverFile: $("#coverFile"),
    audioFileName: $("#audioFileName"),
    coverFileName: $("#coverFileName"),
    playBtn: $("#playBtn"),
    prevBtn: $("#prevBtn"),
    nextBtn: $("#nextBtn"),
    muteBtn: $("#muteBtn"),
    volumeControl: $("#volumeControl"),
    progressBar: $("#progressBar"),
    playerTitle: $("#playerTitle"),
    playerArtist: $("#playerArtist"),
    playerCover: $("#playerCover"),
    currentTime: $("#currentTime"),
    duration: $("#duration"),
    menuToggle: $("#menuToggle"),
    mobileMenu: $("#mobileMenu"),
    toast: $("#toast")
  };

  function showToast(message, isError = false) {
    if (!els.toast) {
      console[isError ? "error" : "log"](message);
      return;
    }
    els.toast.textContent = message;
    els.toast.classList.toggle("error", isError);
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function safeText(value, fallback = "") {
    return value == null || value === "" ? fallback : String(value);
  }

  function isAdmin() {
    return !!currentUser && currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }

  function setAdminUI() {
    const adminButtons = [els.addSongBtn, els.emptyUploadBtn, els.heroAdminBtn, els.mobileAdminBtn];
    adminButtons.forEach((button) => {
      if (button) button.hidden = !isAdmin();
    });
    const loginButtons = $$("[data-admin-login]");
    loginButtons.forEach((button) => {
      button.hidden = isAdmin();
    });
    const logoutButtons = $$("[data-admin-logout]");
    logoutButtons.forEach((button) => {
      button.hidden = !isAdmin();
    });
  }

  async function ensureSupabase() {
    if (window.supabase?.createClient) {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      return;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Tidak bisa memuat library Supabase. Periksa koneksi internet."));
      document.head.appendChild(script);
    });
    if (!window.supabase?.createClient) throw new Error("Library Supabase tidak berhasil dimuat.");
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }

  async function loadSession() {
    const { data, error } = await db.auth.getSession();
    if (error) console.warn("Session:", error.message);
    currentUser = data?.session?.user || null;
    if (currentUser && !isAdmin()) {
      await db.auth.signOut();
      currentUser = null;
      showToast("Akun ini tidak memiliki akses admin.", true);
    }
    setAdminUI();
  }

  async function loadSongs() {
    if (els.songList) {
      els.songList.innerHTML = '<div class="loading-state">Memuat koleksi musik...</div>';
    }
    const { data, error } = await db.from("songs").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      if (els.songList) els.songList.innerHTML = '<div class="empty-state"><h3>Musik belum dapat dimuat</h3><p>Periksa koneksi Supabase dan kebijakan akses tabel songs.</p></div>';
      showToast("Gagal memuat lagu: " + error.message, true);
      return;
    }
    songs = data || [];
    populateGenres();
    applyFilters();
  }

  function populateGenres() {
    if (!els.genre) return;
    const selected = els.genre.value;
    const genres = [...new Set(songs.map(song => safeText(song.genre).trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    els.genre.innerHTML = '<option value="">Semua genre</option>' +
      genres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join("");
    if (genres.includes(selected)) els.genre.value = selected;
  }

  function applyFilters() {
    const query = safeText(els.search?.value).toLowerCase().trim();
    const genre = safeText(els.genre?.value);
    const sort = safeText(els.sort?.value, "newest");

    filteredSongs = songs.filter(song => {
      const matchesText = [song.title, song.artist, song.genre]
        .some(value => safeText(value).toLowerCase().includes(query));
      return matchesText && (!genre || song.genre === genre);
    });

    if (sort === "title") filteredSongs.sort((a, b) => safeText(a.title).localeCompare(safeText(b.title)));
    else if (sort === "popular") filteredSongs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
    else filteredSongs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    renderSongs();
  }

  function renderSongs() {
    if (els.songCount) els.songCount.textContent = `${filteredSongs.length} lagu`;
    if (!els.songList) return;
    if (!filteredSongs.length) {
      els.songList.innerHTML = `<div class="empty-state">
        <h3>${songs.length ? "Lagu tidak ditemukan" : "Belum ada lagu"}</h3>
        <p>${songs.length ? "Coba kata kunci atau genre lain." : "Koleksi lagu akan tampil di sini setelah admin mengunggah musik."}</p>
      </div>`;
      return;
    }

    els.songList.innerHTML = filteredSongs.map((song, index) => {
      const cover = song.cover_url
        ? `<img src="${escapeHtml(song.cover_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="cover-placeholder">♫</span>`;
      const deleteButton = isAdmin()
        ? `<button class="song-delete" type="button" data-delete="${escapeHtml(song.id)}" aria-label="Hapus ${escapeHtml(song.title)}" title="Hapus lagu">Hapus</button>`
        : "";
      return `<article class="song-card" data-song-index="${index}">
        <button class="song-play" type="button" data-play="${index}" aria-label="Putar ${escapeHtml(song.title)}">
          <span class="song-cover">${cover}</span>
          <span class="song-info"><strong>${escapeHtml(song.title || "Tanpa judul")}</strong>
          <span>${escapeHtml(song.artist || "Artis tidak diketahui")}</span>
          <small>${escapeHtml(song.genre || "Lainnya")}</small></span>
          <span class="song-play-icon" aria-hidden="true">▶</span>
        </button>${deleteButton}
      </article>`;
    }).join("");
  }

  function updatePlayer(song) {
    if (els.playerTitle) els.playerTitle.textContent = song?.title || "Pilih lagu";
    if (els.playerArtist) els.playerArtist.textContent = song?.artist || "KOMSI Music Library";
    if (els.playerCover) {
      if (song?.cover_url) {
        els.playerCover.src = song.cover_url;
        els.playerCover.alt = `Cover ${song.title || "lagu"}`;
      } else {
        els.playerCover.removeAttribute("src");
        els.playerCover.alt = "";
      }
    }
  }

  async function playSong(index) {
    const song = filteredSongs[index];
    if (!song?.audio_url) {
      showToast("URL audio lagu ini belum tersedia.", true);
      return;
    }
    activeSongIndex = index;
    updatePlayer(song);
    audio.src = song.audio_url;
    try {
      await audio.play();
      if (els.playBtn) els.playBtn.textContent = "Ⅱ";
      // Do not update play_count from public clients; current RLS correctly restricts table writes.
    } catch (error) {
      console.error(error);
      showToast("Lagu tidak bisa diputar. Periksa URL audio dan pengaturan bucket audio.", true);
    }
  }

  function togglePlay() {
    if (!audio.src) {
      if (filteredSongs.length) playSong(0);
      else showToast("Belum ada lagu untuk diputar.");
      return;
    }
    if (audio.paused) audio.play().catch(() => showToast("Gagal memutar audio.", true));
    else audio.pause();
  }

  function nextSong(direction = 1) {
    if (!filteredSongs.length) return;
    const next = activeSongIndex < 0
      ? 0
      : (activeSongIndex + direction + filteredSongs.length) % filteredSongs.length;
    playSong(next);
  }

  function openUploadModal() {
    if (!isAdmin()) {
      showToast("Login sebagai admin untuk mengunggah lagu.", true);
      return;
    }
    if (els.uploadModal) {
      els.uploadModal.hidden = false;
      els.uploadModal.classList.add("open");
    } else {
      showToast("Form unggah tidak ditemukan di index.html.", true);
    }
  }

  function closeUploadModal() {
    if (!els.uploadModal) return;
    els.uploadModal.classList.remove("open");
    els.uploadModal.hidden = true;
  }

  async function uploadFile(bucket, file, path) {
    const { error } = await db.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });
    if (error) throw error;
    const { data } = db.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!isAdmin()) {
      showToast("Akses admin diperlukan.", true);
      return;
    }
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = safeText(formData.get("title")).trim();
    const artist = safeText(formData.get("artist")).trim();
    const genre = safeText(formData.get("genre")).trim();
    const audioFile = form.querySelector('input[type="file"][accept*="audio"]')?.files?.[0]
      || els.audioFile?.files?.[0];
    const coverFile = form.querySelector('input[type="file"][accept*="image"]')?.files?.[0]
      || els.coverFile?.files?.[0];

    if (!title || !artist || !audioFile) {
      showToast("Isi judul, nama artis, dan pilih file audio.", true);
      return;
    }

    const submit = form.querySelector('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = "Mengunggah..."; }
    let audioPath = "";
    let coverPath = "";
    try {
      const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const audioExt = (audioFile.name.split(".").pop() || "mp3").replace(/[^a-zA-Z0-9]/g, "");
      audioPath = `${id}.${audioExt}`;
      const audioUrl = await uploadFile(AUDIO_BUCKET, audioFile, audioPath);
      let coverUrl = null;
      if (coverFile) {
        const coverExt = (coverFile.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "");
        coverPath = `${id}.${coverExt}`;
        coverUrl = await uploadFile(COVER_BUCKET, coverFile, coverPath);
      }

      const { error } = await db.from("songs").insert({
        title, artist, genre: genre || "Lainnya",
        audio_url: audioUrl, cover_url: coverUrl, duration: null, play_count: 0
      });
      if (error) throw error;
      form.reset();
      if (els.audioFileName) els.audioFileName.textContent = "";
      if (els.coverFileName) els.coverFileName.textContent = "";
      closeUploadModal();
      showToast("Lagu berhasil ditambahkan!");
      await loadSongs();
    } catch (error) {
      console.error(error);
      showToast("Upload gagal: " + (error.message || "Terjadi kesalahan"), true);
      // Uploaded files may remain if inserting the row failed; no automatic deletion is attempted.
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = "Unggah Lagu"; }
    }
  }

  async function deleteSong(id) {
    if (!isAdmin()) return showToast("Akses admin diperlukan.", true);
    const song = songs.find(item => String(item.id) === String(id));
    if (!song || !confirm(`Hapus lagu "${song.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      const removePaths = (url, bucket) => {
        if (!url) return null;
        const marker = `/storage/v1/object/public/${bucket}/`;
        const position = url.indexOf(marker);
        return position >= 0 ? decodeURIComponent(url.slice(position + marker.length).split("?")[0]) : null;
      };
      const audioPath = removePaths(song.audio_url, AUDIO_BUCKET);
      const coverPath = removePaths(song.cover_url, COVER_BUCKET);
      const { error } = await db.from("songs").delete().eq("id", id);
      if (error) throw error;
      if (audioPath) await db.storage.from(AUDIO_BUCKET).remove([audioPath]);
      if (coverPath) await db.storage.from(COVER_BUCKET).remove([coverPath]);
      showToast("Lagu berhasil dihapus.");
      await loadSongs();
    } catch (error) {
      console.error(error);
      showToast("Gagal menghapus lagu: " + error.message, true);
    }
  }

  async function loginAdmin() {
    if (!db) return;
    const email = prompt("Email admin:");
    if (!email) return;
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      showToast("Email ini bukan email admin yang diizinkan.", true);
      return;
    }
    const password = prompt("Password akun Supabase admin:");
    if (!password) return;
    const { data, error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      showToast("Login gagal: " + error.message, true);
      return;
    }
    if (data.user?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await db.auth.signOut();
      currentUser = null;
      setAdminUI();
      showToast("Akun tidak memiliki akses admin.", true);
      return;
    }
    currentUser = data.user;
    setAdminUI();
    renderSongs();
    showToast("Login admin berhasil.");
  }

  async function logoutAdmin() {
    const { error } = await db.auth.signOut();
    if (error) return showToast("Logout gagal: " + error.message, true);
    currentUser = null;
    setAdminUI();
    renderSongs();
    showToast("Berhasil logout.");
  }

  function bindEvents() {
    els.search?.addEventListener("input", applyFilters);
    els.genre?.addEventListener("change", applyFilters);
    els.sort?.addEventListener("change", applyFilters);
    $$(".chip").forEach(chip => chip.addEventListener("click", () => {
      $$(".chip").forEach(item => item.classList.remove("active"));
      chip.classList.add("active");
      const genre = chip.dataset.genre || chip.dataset.filter || "";
      if (els.genre) els.genre.value = genre;
      applyFilters();
    }));

    [els.addSongBtn, els.emptyUploadBtn, els.heroAdminBtn, els.mobileAdminBtn]
      .forEach(button => button?.addEventListener("click", openUploadModal));
    els.closeModal?.addEventListener("click", closeUploadModal);
    els.cancelUpload?.addEventListener("click", closeUploadModal);
    els.uploadForm?.addEventListener("submit", handleUpload);
    $$("[data-admin-login]").forEach(button => button.addEventListener("click", loginAdmin));
    $$("[data-admin-logout]").forEach(button => button.addEventListener("click", logoutAdmin));

    els.songList?.addEventListener("click", event => {
      const playButton = event.target.closest("[data-play]");
      const deleteButton = event.target.closest("[data-delete]");
      if (playButton) playSong(Number(playButton.dataset.play));
      if (deleteButton) deleteSong(deleteButton.dataset.delete);
    });

    els.playBtn?.addEventListener("click", togglePlay);
    els.prevBtn?.addEventListener("click", () => nextSong(-1));
    els.nextBtn?.addEventListener("click", () => nextSong(1));
    els.volumeControl?.addEventListener("input", () => {
      audio.volume = Number(els.volumeControl.value);
      audio.muted = false;
    });
    els.muteBtn?.addEventListener("click", () => {
      audio.muted = !audio.muted;
      els.muteBtn.textContent = audio.muted ? "Unmute" : "Mute";
    });
    els.progressBar?.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(els.progressBar.value) / 100) * audio.duration;
      }
    });
    audio.addEventListener("timeupdate", () => {
      if (els.currentTime) els.currentTime.textContent = formatTime(audio.currentTime);
      if (els.progressBar && Number.isFinite(audio.duration) && audio.duration > 0) {
        els.progressBar.value = String((audio.currentTime / audio.duration) * 100);
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      if (els.duration) els.duration.textContent = formatTime(audio.duration);
      if (els.progressBar) els.progressBar.value = "0";
    });
    audio.addEventListener("ended", () => {
      if (els.playBtn) els.playBtn.textContent = "▶";
      nextSong(1);
    });
    audio.addEventListener("pause", () => { if (els.playBtn) els.playBtn.textContent = "▶"; });
    audio.addEventListener("play", () => { if (els.playBtn) els.playBtn.textContent = "Ⅱ"; });

    els.audioFile?.addEventListener("change", () => {
      if (els.audioFileName) els.audioFileName.textContent = els.audioFile.files?.[0]?.name || "";
    });
    els.coverFile?.addEventListener("change", () => {
      if (els.coverFileName) els.coverFileName.textContent = els.coverFile.files?.[0]?.name || "";
    });
    els.menuToggle?.addEventListener("click", () => els.mobileMenu?.classList.toggle("open"));
  }

  async function init() {
    bindEvents();
    try {
      await ensureSupabase();
      await loadSession();
      db.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        if (currentUser && currentUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          db.auth.signOut().catch(console.error);
          currentUser = null;
        }
        setAdminUI();
        renderSongs();
      });
      await loadSongs();
    } catch (error) {
      console.error(error);
      if (els.songList) els.songList.innerHTML = '<div class="empty-state"><h3>Koneksi belum siap</h3><p>Periksa koneksi internet dan konfigurasi Supabase di app.js.</p></div>';
      showToast(error.message || "Gagal menginisialisasi Supabase.", true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
