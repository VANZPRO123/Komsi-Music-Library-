/* =========================================================
   KOMSI MUSIC LIBRARY
   Frontend-only prototype.
   - Audio & cover files are stored in IndexedDB.
   - Metadata is stored together with the file blobs.
   - Can later be replaced by Supabase Storage + DB.
========================================================= */

const DB_NAME = "komsi_music_library";
const DB_VERSION = 1;
const STORE_NAME = "songs";

const state = {
  songs: [],
  filteredSongs: [],
  currentIndex: -1,
  currentSong: null,
  isPlaying: false,
  muted: false,
  volume: 0.8,
  sort: "newest",
  genre: "all",
  search: ""
};

let db = null;
let audio = new Audio();
audio.preload = "metadata";

/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (selector) => document.querySelector(selector);

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function createId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

/* =========================================================
   INDEXED DB
========================================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id"
        });

        store.createIndex("title", "title", {
          unique: false
        });

        store.createIndex("artist", "artist", {
          unique: false
        });

        store.createIndex("genre", "genre", {
          unique: false
        });

        store.createIndex("createdAt", "createdAt", {
          unique: false
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function getAllSongs() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readonly"
    );

    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function addSong(song) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(song);

    request.onsuccess = () => resolve(song);

    request.onerror = () => reject(request.error);
  });
}

function updateSong(song) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(song);

    request.onsuccess = () => resolve(song);

    request.onerror = () => reject(request.error);
  });
}

function deleteSongFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();

    request.onerror = () => reject(request.error);
  });
}

/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await openDatabase();
    await loadSongs();
    bindEvents();
    updatePlayerUI();
  } catch (error) {
    console.error("Database error:", error);
    showToast(
      "Gagal membuka penyimpanan musik browser.",
      "error"
    );
  }
});

/* =========================================================
   LOAD SONGS
========================================================= */

async function loadSongs() {
  state.songs = await getAllSongs();

  seedDemoSongs();

  applyFilters();
}

/* =========================================================
   DEMO DATA
========================================================= */

async function seedDemoSongs() {
  /*
    Tidak memasukkan file musik demo copyrighted.

    Bagian ini sengaja kosong agar pengguna dapat
    mengunggah musik miliknya sendiri.
  */
}

/* =========================================================
   FILTER & SORT
========================================================= */

function applyFilters() {
  const search = state.search.trim().toLowerCase();

  let songs = [...state.songs];

  if (search) {
    songs = songs.filter((song) => {
      const title = String(song.title || "").toLowerCase();
      const artist = String(song.artist || "").toLowerCase();

      return (
        title.includes(search) ||
        artist.includes(search)
      );
    });
  }

  if (state.genre !== "all") {
    songs = songs.filter(
      (song) => song.genre === state.genre
    );
  }

  switch (state.sort) {
    case "oldest":
      songs.sort(
        (a, b) =>
          Number(a.createdAt || 0) -
          Number(b.createdAt || 0)
      );
      break;

    case "az":
      songs.sort((a, b) =>
        String(a.title || "").localeCompare(
          String(b.title || "")
        )
      );
      break;

    case "za":
      songs.sort((a, b) =>
        String(b.title || "").localeCompare(
          String(a.title || "")
        )
      );
      break;

    case "played":
      songs.sort(
        (a, b) =>
          Number(b.plays || 0) -
          Number(a.plays || 0)
      );
      break;

    case "newest":
    default:
      songs.sort(
        (a, b) =>
          Number(b.createdAt || 0) -
          Number(a.createdAt || 0)
      );
      break;
  }

  state.filteredSongs = songs;

  renderSongs();
  updateSongCount();
}

/* =========================================================
   RENDER SONGS
========================================================= */

function renderSongs() {
  const container =
    $("#songList") ||
    $("#songsGrid") ||
    $(".song-list") ||
    $(".songs-grid");

  if (!container) return;

  if (!state.filteredSongs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <h3>Belum ada musik</h3>
        <p>
          Upload lagu untuk mulai membangun
          Music Library KOMSI.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = state.filteredSongs
    .map((song, index) => {
      const coverURL = song.coverBlob
        ? URL.createObjectURL(song.coverBlob)
        : "";

      return `
        <article
          class="song-card"
          data-id="${escapeHTML(song.id)}"
        >

          <div class="song-cover">
            ${
              coverURL
                ? `<img
                    src="${coverURL}"
                    alt="${escapeHTML(song.title)}"
                  >`
                : `
                  <div class="default-cover">
                    <span>♪</span>
                  </div>
                `
            }

            <button
              class="play-card-btn"
              type="button"
              data-action="play"
              data-id="${escapeHTML(song.id)}"
              aria-label="Putar ${escapeHTML(song.title)}"
            >
              ▶
            </button>
          </div>

          <div class="song-info">
            <h3>${escapeHTML(song.title)}</h3>

            <p class="song-artist">
              ${escapeHTML(song.artist || "Unknown Artist")}
            </p>

            <div class="song-meta">
              ${
                song.genre
                  ? `<span>${escapeHTML(song.genre)}</span>`
                  : ""
              }

              <span>
                ${Number(song.plays || 0)} plays
              </span>
            </div>
          </div>

          <div class="song-actions">

            <button
              type="button"
              class="icon-btn"
              data-action="play"
              data-id="${escapeHTML(song.id)}"
              title="Putar"
            >
              ▶
            </button>

            <button
              type="button"
              class="icon-btn danger"
              data-action="delete"
              data-id="${escapeHTML(song.id)}"
              title="Hapus"
            >
              🗑
            </button>

          </div>

        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleSongAction);
  });
}

/* =========================================================
   SONG ACTION
========================================================= */

async function handleSongAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "play") {
    await playSongById(id);
  }

  if (action === "delete") {
    await deleteSong(id);
  }
}

/* =========================================================
   PLAY SONG
========================================================= */

async function playSongById(id) {
  const index = state.filteredSongs.findIndex(
    (song) => song.id === id
  );

  if (index === -1) return;

  const song = state.filteredSongs[index];

  state.currentIndex = index;
  state.currentSong = song;

  if (!song.audioBlob) {
    showToast(
      "File audio lagu tidak tersedia.",
      "error"
    );

    return;
  }

  const audioURL = URL.createObjectURL(song.audioBlob);

  audio.pause();

  audio.src = audioURL;
  audio.currentTime = 0;
  audio.volume = state.muted ? 0 : state.volume;

  updatePlayerUI();

  try {
    await audio.play();

    state.isPlaying = true;

    song.plays = Number(song.plays || 0) + 1;

    await updateSong(song);

    updatePlayerUI();
    applyFilters();
  } catch (error) {
    console.error("Audio play error:", error);

    showToast(
      "Audio tidak dapat diputar.",
      "error"
    );
  }
}

/* =========================================================
   PLAY / PAUSE
========================================================= */

async function togglePlay() {
  if (!state.currentSong) {
    if (state.filteredSongs.length) {
      await playSongById(
        state.filteredSongs[0].id
      );
    }

    return;
  }

  if (audio.paused) {
    try {
      await audio.play();
      state.isPlaying = true;
    } catch (error) {
      console.error(error);
    }
  } else {
    audio.pause();
    state.isPlaying = false;
  }

  updatePlayerUI();
}

/* =========================================================
   NEXT / PREVIOUS
========================================================= */

async function playNext() {
  if (!state.filteredSongs.length) return;

  let nextIndex = state.currentIndex + 1;

  if (nextIndex >= state.filteredSongs.length) {
    nextIndex = 0;
  }

  await playSongById(
    state.filteredSongs[nextIndex].id
  );
}

async function playPrevious() {
  if (!state.filteredSongs.length) return;

  let previousIndex = state.currentIndex - 1;

  if (previousIndex < 0) {
    previousIndex =
      state.filteredSongs.length - 1;
  }

  await playSongById(
    state.filteredSongs[previousIndex].id
  );
}

/* =========================================================
   PLAYER UI
========================================================= */

function updatePlayerUI() {
  const song = state.currentSong;

  const titleElements = [
    $("#playerTitle"),
    $(".player-title")
  ];

  const artistElements = [
    $("#playerArtist"),
    $(".player-artist")
  ];

  titleElements.forEach((element) => {
    if (element) {
      element.textContent = song
        ? song.title
        : "Belum ada lagu";
    }
  });

  artistElements.forEach((element) => {
    if (element) {
      element.textContent = song
        ? song.artist || "Unknown Artist"
        : "Pilih musik untuk mulai";
    }
  });

  const cover =
    $("#playerCover") ||
    $(".player-cover");

  if (cover) {
    if (song?.coverBlob) {
      const url = URL.createObjectURL(
        song.coverBlob
      );

      if (cover.tagName === "IMG") {
        cover.src = url;
      } else {
        cover.style.backgroundImage =
          `url("${url}")`;
      }
    }
  }

  const playButtons = [
    $("#playBtn"),
    $("#playerPlay"),
    $(".player-play")
  ];

  playButtons.forEach((button) => {
    if (button) {
      button.textContent =
        state.isPlaying ? "❚❚" : "▶";
    }
  });

  const volumeInput =
    $("#volumeControl") ||
    $("#volume");

  if (volumeInput) {
    volumeInput.value =
      state.muted ? 0 : state.volume;
  }

  const muteButton =
    $("#muteBtn") ||
    $("#muteButton");

  if (muteButton) {
    muteButton.textContent =
      state.muted || state.volume === 0
        ? "🔇"
        : "🔊";
  }

  const currentTime =
    $("#currentTime");

  const duration =
    $("#duration");

  if (currentTime) {
    currentTime.textContent =
      formatTime(audio.currentTime);
  }

  if (duration) {
    duration.textContent =
      formatTime(audio.duration);
  }

  updateProgress();
}

/* =========================================================
   PROGRESS
========================================================= */

function updateProgress() {
  const progress =
    $("#progressBar") ||
    $("#progress");

  if (!progress) return;

  if (
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  ) {
    progress.value =
      (audio.currentTime /
        audio.duration) *
      100;
  } else {
    progress.value = 0;
  }
}

/* =========================================================
   AUDIO EVENTS
========================================================= */

audio.addEventListener("timeupdate", () => {
  updateProgress();

  const currentTime =
    $("#currentTime");

  if (currentTime) {
    currentTime.textContent =
      formatTime(audio.currentTime);
  }
});

audio.addEventListener("loadedmetadata", () => {
  const duration =
    $("#duration");

  if (duration) {
    duration.textContent =
      formatTime(audio.duration);
  }

  updateProgress();
});

audio.addEventListener("play", () => {
  state.isPlaying = true;
  updatePlayerUI();
});

audio.addEventListener("pause", () => {
  state.isPlaying = false;
  updatePlayerUI();
});

audio.addEventListener("ended", async () => {
  state.isPlaying = false;
  await playNext();
});

/* =========================================================
   EVENTS
========================================================= */

function bindEvents() {
  /* SEARCH */

  const searchInput =
    $("#searchInput") ||
    $("#search");

  if (searchInput) {
    searchInput.addEventListener(
      "input",
      (event) => {
        state.search =
          event.target.value;

        applyFilters();
      }
    );
  }

  /* GENRE */

  const genreSelect =
    $("#genreFilter") ||
    $("#genre");

  if (genreSelect) {
    genreSelect.addEventListener(
      "change",
      (event) => {
        state.genre =
          event.target.value;

        applyFilters();
      }
    );
  }

  /* SORT */

  const sortSelect =
    $("#sortSelect") ||
    $("#sort");

  if (sortSelect) {
    sortSelect.addEventListener(
      "change",
      (event) => {
        state.sort =
          event.target.value;

        applyFilters();
      }
    );
  }

  /* PLAY */

  const playButton =
    $("#playBtn") ||
    $("#playerPlay") ||
    $(".player-play");

  if (playButton) {
    playButton.addEventListener(
      "click",
      togglePlay
    );
  }

  /* NEXT */

  const nextButton =
    $("#nextBtn") ||
    $("#nextButton") ||
    $(".next-btn");

  if (nextButton) {
    nextButton.addEventListener(
      "click",
      playNext
    );
  }

  /* PREVIOUS */

  const previousButton =
    $("#prevBtn") ||
    $("#previousBtn") ||
    $(".prev-btn");

  if (previousButton) {
    previousButton.addEventListener(
      "click",
      playPrevious
    );
  }

  /* MUTE */

  const muteButton =
    $("#muteBtn") ||
    $("#muteButton");

  if (muteButton) {
    muteButton.addEventListener(
      "click",
      toggleMute
    );
  }

  /* VOLUME */

  const volumeInput =
    $("#volumeControl") ||
    $("#volume");

  if (volumeInput) {
    volumeInput.addEventListener(
      "input",
      (event) => {
        const value =
          Number(event.target.value);

        state.volume =
          value > 1
            ? value / 100
            : value;

        state.muted =
          state.volume === 0;

        audio.volume =
          state.muted
            ? 0
            : state.volume;

        updatePlayerUI();
      }
    );
  }

  /* PROGRESS */

  const progress =
    $("#progressBar") ||
    $("#progress");

  if (progress) {
    progress.addEventListener(
      "input",
      (event) => {
        if (!Number.isFinite(audio.duration)) {
          return;
        }

        const percentage =
          Number(event.target.value);

        audio.currentTime =
          (percentage / 100) *
          audio.duration;
      }
    );
  }

  /* ADMIN / UPLOAD */

  bindUploadEvents();

  /* GLOBAL SONG CLICK */

  document.addEventListener(
    "keydown",
    handleKeyboard
  );
}

/* =========================================================
   MUTE
========================================================= */

function toggleMute() {
  state.muted = !state.muted;

  audio.volume =
    state.muted
      ? 0
      : state.volume;

  updatePlayerUI();
}

/* =========================================================
   UPLOAD EVENTS
========================================================= */

function bindUploadEvents() {
  const uploadButtons = [
    "#addSongBtn",
    "#adminAddSong",
    "#uploadSongBtn",
    "[data-open-upload]"
  ];

  uploadButtons.forEach((selector) => {
    const element = $(selector);

    if (element) {
      element.addEventListener(
        "click",
        openUploadModal
      );
    }
  });

  const closeButtons = [
    "#closeModal",
    "#closeUploadModal",
    "[data-close-modal]"
  ];

  closeButtons.forEach((selector) => {
    const element = $(selector);

    if (element) {
      element.addEventListener(
        "click",
        closeUploadModal
      );
    }
  });

  const form =
    $("#uploadForm") ||
    $("#songForm");

  if (form) {
    form.addEventListener(
      "submit",
      handleUpload
    );
  }
}

/* =========================================================
   UPLOAD MODAL
========================================================= */

function openUploadModal() {
  const modal =
    $("#uploadModal") ||
    $("#adminModal");

  if (!modal) return;

  modal.classList.add("active");
  modal.classList.add("show");

  modal.style.display = "flex";
}

function closeUploadModal() {
  const modal =
    $("#uploadModal") ||
    $("#adminModal");

  if (!modal) return;

  modal.classList.remove("active");
  modal.classList.remove("show");

  modal.style.display = "none";
}

/* =========================================================
   HANDLE UPLOAD
========================================================= */

async function handleUpload(event) {
  event.preventDefault();

  const form = event.currentTarget;

  const titleInput =
    form.querySelector(
      '[name="title"]'
    );

  const artistInput =
    form.querySelector(
      '[name="artist"]'
    );

  const genreInput =
    form.querySelector(
      '[name="genre"]'
    );

  const audioInput =
    form.querySelector(
      '[name="audio"]'
    );

  const coverInput =
    form.querySelector(
      '[name="cover"]'
    );

  const title =
    titleInput?.value.trim();

  const artist =
    artistInput?.value.trim();

  const genre =
    genreInput?.value.trim();

  const audioFile =
    audioInput?.files?.[0];

  const coverFile =
    coverInput?.files?.[0];

  if (!title) {
    showToast(
      "Judul lagu wajib diisi.",
      "error"
    );

    return;
  }

  if (!audioFile) {
    showToast(
      "File audio wajib dipilih.",
      "error"
    );

    return;
  }

  if (
    !audioFile.type.startsWith("audio/")
  ) {
    showToast(
      "File yang dipilih bukan file audio.",
      "error"
    );

    return;
  }

  const song = {
    id: createId(),
    title,
    artist:
      artist || "Unknown Artist",
    genre:
      genre || "Other",
    audioBlob: audioFile,
    coverBlob:
      coverFile || null,
    plays: 0,
    createdAt: Date.now()
  };

  try {
    await addSong(song);

    state.songs.push(song);

    applyFilters();

    closeUploadModal();

    form.reset();

    showToast(
      "Musik berhasil ditambahkan.",
      "success"
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Gagal menyimpan musik.",
      "error"
    );
  }
}

/* =========================================================
   DELETE SONG
========================================================= */

async function deleteSong(id) {
  const song =
    state.songs.find(
      (item) => item.id === id
    );

  if (!song) return;

  const confirmed = window.confirm(
    `Hapus lagu "${song.title}"?`
  );

  if (!confirmed) return;

  try {
    await deleteSongFromDB(id);

    if (
      state.currentSong &&
      state.currentSong.id === id
    ) {
      audio.pause();
      audio.src = "";

      state.currentSong = null;
      state.currentIndex = -1;
      state.isPlaying = false;
    }

    state.songs =
      state.songs.filter(
        (item) => item.id !== id
      );

    applyFilters();
    updatePlayerUI();

    showToast(
      "Musik berhasil dihapus.",
      "success"
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Gagal menghapus musik.",
      "error"
    );
  }
}

/* =========================================================
   SONG COUNT
========================================================= */

function updateSongCount() {
  const elements = [
    $("#songCount"),
    $("#totalSongs"),
    $(".song-count")
  ];

  elements.forEach((element) => {
    if (element) {
      element.textContent =
        state.filteredSongs.length;
    }
  });
}

/* =========================================================
   TOAST
========================================================= */

function showToast(
  message,
  type = "info"
) {
  let toast =
    document.querySelector(
      ".komsi-toast"
    );

  if (!toast) {
    toast =
      document.createElement("div");

    toast.className =
      "komsi-toast";

    document.body.appendChild(toast);
  }

  toast.textContent = message;

  toast.className =
    `komsi-toast ${type}`;

  toast.classList.add("show");

  clearTimeout(
    showToast.timeout
  );

  showToast.timeout =
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
}

/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

function handleKeyboard(event) {
  const target =
    event.target;

  const isTyping =
    target &&
    (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    );

  /* Ctrl + K / Cmd + K = Search */

  if (
    (event.ctrlKey ||
      event.metaKey) &&
    event.key.toLowerCase() === "k"
  ) {
    event.preventDefault();

    const search =
      $("#searchInput") ||
      $("#search");

    if (search) {
      search.focus();
    }

    return;
  }

  if (isTyping) return;

  /* Space = Play / Pause */

  if (event.code === "Space") {
    event.preventDefault();

    togglePlay();

    return;
  }

  /* Arrow Right = Next */

  if (event.code === "ArrowRight") {
    playNext();

    return;
  }

  /* Arrow Left = Previous */

  if (event.code === "ArrowLeft") {
    playPrevious();

    return;
  }
}

/* =========================================================
   OPTIONAL GLOBAL FUNCTIONS
   Useful if HTML uses onclick=""
========================================================= */

window.KOMSI = {
  playSongById,
  playNext,
  playPrevious,
  togglePlay,
  toggleMute,
  openUploadModal,
  closeUploadModal,
  deleteSong,
  applyFilters
};

/* =========================================================
   END
========================================================= */
