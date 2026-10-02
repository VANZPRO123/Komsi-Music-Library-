/* ==========================================================
   KOMSI MUSIC LIBRARY — FULL V2
   Local prototype / ready for Supabase integration later.
========================================================== */

const DB_NAME = "komsi_music_library_v2";
const DB_VERSION = 1;
const STORE = "songs";

const state = {
  songs: [],
  filtered: [],
  currentIndex: -1,
  currentSong: null,
  search: "",
  genre: "all",
  sort: "newest",
  playing: false,
  volume: 0.8,
  muted: false
};

let db;
let audio = new Audio();
audio.preload = "metadata";

/* ==========================================================
   HELPER
========================================================== */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

/* ==========================================================
   INDEXED DB
========================================================== */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, {
          keyPath: "id"
        });

        store.createIndex("title", "title");
        store.createIndex("genre", "genre");
        store.createIndex("createdAt", "createdAt");
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

function getSongs() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function putSong(song) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.put(song);

    request.onsuccess = () => {
      resolve(song);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function removeSong(songId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.delete(songId);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* ==========================================================
   INITIALIZATION
========================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await openDB();

    state.songs = await getSongs();

    bindUI();
    applyFilters();
    updatePlayer();

  } catch (error) {
    console.error(error);

    toast(
      "Gagal membuka penyimpanan browser.",
      "error"
    );
  }
});

/* ==========================================================
   BIND UI
========================================================== */

function bindUI() {

  /* SEARCH */

  $("#searchInput")?.addEventListener("input", (event) => {
    state.search = event.target.value;

    applyFilters();
  });


  /* GENRE */

  $("#genreFilter")?.addEventListener("change", (event) => {

    state.genre = event.target.value;

    syncGenreChips();

    applyFilters();
  });


  /* SORT */

  $("#sortSelect")?.addEventListener("change", (event) => {

    state.sort = event.target.value;

    applyFilters();
  });


  /* QUICK FILTER */

  $$(".chip").forEach((chip) => {

    chip.addEventListener("click", () => {

      state.genre = chip.dataset.genre;

      $("#genreFilter").value = state.genre;

      syncGenreChips();

      applyFilters();
    });

  });


  /* OPEN MODAL */

  $("#addSongBtn")?.addEventListener(
    "click",
    openModal
  );

  $("#emptyUploadBtn")?.addEventListener(
    "click",
    openModal
  );

  $("#heroAdminBtn")?.addEventListener(
    "click",
    openModal
  );

  $("#mobileAdminBtn")?.addEventListener(
    "click",
    openModal
  );


  /* CLOSE MODAL */

  $("#closeModal")?.addEventListener(
    "click",
    closeModal
  );

  $("#cancelUpload")?.addEventListener(
    "click",
    closeModal
  );


  /* CLICK OUTSIDE MODAL */

  $("#uploadModal")?.addEventListener(
    "click",
    (event) => {

      if (event.target === $("#uploadModal")) {
        closeModal();
      }

    }
  );


  /* FORM */

  $("#uploadForm")?.addEventListener(
    "submit",
    uploadSong
  );


  /* AUDIO FILE */

  $("#uploadForm input[name='audio']")
    ?.addEventListener("change", (event) => {

      const file = event.target.files[0];

      $("#audioFileName").textContent =
        file?.name || "Belum dipilih";

    });


  /* COVER FILE */

  $("#uploadForm input[name='cover']")
    ?.addEventListener("change", (event) => {

      const file = event.target.files[0];

      $("#coverFileName").textContent =
        file?.name || "Opsional";

    });


  /* PLAYER */

  $("#playBtn")?.addEventListener(
    "click",
    togglePlay
  );

  $("#prevBtn")?.addEventListener(
    "click",
    previous
  );

  $("#nextBtn")?.addEventListener(
    "click",
    next
  );

  $("#muteBtn")?.addEventListener(
    "click",
    toggleMute
  );


  /* VOLUME */

  $("#volumeControl")?.addEventListener(
    "input",
    (event) => {

      state.volume = Number(event.target.value);

      state.muted = state.volume === 0;

      audio.volume =
        state.muted
          ? 0
          : state.volume;

      updatePlayer();
    }
  );


  /* PROGRESS */

  $("#progressBar")?.addEventListener(
    "input",
    (event) => {

      if (
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {

        audio.currentTime =
          (Number(event.target.value) / 100) *
          audio.duration;

      }

    }
  );


  /* MOBILE MENU */

  $("#menuToggle")?.addEventListener(
    "click",
    () => {

      const menu = $("#mobileMenu");

      const open =
        menu.classList.toggle("open");

      $("#menuToggle").setAttribute(
        "aria-expanded",
        String(open)
      );

    }
  );


  $$("#mobileMenu a").forEach((link) => {

    link.addEventListener("click", () => {

      $("#mobileMenu").classList.remove(
        "open"
      );

      $("#menuToggle").setAttribute(
        "aria-expanded",
        "false"
      );

    });

  });


  /* KEYBOARD */

  document.addEventListener(
    "keydown",
    keyboard
  );


  /* AUDIO EVENTS */

  audio.addEventListener(
    "timeupdate",
    updateProgress
  );

  audio.addEventListener(
    "loadedmetadata",
    updatePlayer
  );

  audio.addEventListener(
    "play",
    () => {

      state.playing = true;

      updatePlayer();

    }
  );

  audio.addEventListener(
    "pause",
    () => {

      state.playing = false;

      updatePlayer();

    }
  );

  audio.addEventListener(
    "ended",
    next
  );
}

/* ==========================================================
   FILTER & SORT
========================================================== */

function applyFilters() {

  const query =
    state.search.trim().toLowerCase();

  let list = [...state.songs];


  /* SEARCH */

  if (query) {

    list = list.filter((song) => {

      const title =
        String(song.title || "")
          .toLowerCase();

      const artist =
        String(song.artist || "")
          .toLowerCase();

      const album =
        String(song.album || "")
          .toLowerCase();

      return (
        title.includes(query) ||
        artist.includes(query) ||
        album.includes(query)
      );

    });

  }


  /* GENRE */

  if (state.genre !== "all") {

    list = list.filter(
      (song) =>
        song.genre === state.genre
    );

  }


  /* SORT */

  if (state.sort === "newest") {

    list.sort(
      (a, b) =>
        (b.createdAt || 0) -
        (a.createdAt || 0)
    );

  }

  else if (state.sort === "oldest") {

    list.sort(
      (a, b) =>
        (a.createdAt || 0) -
        (b.createdAt || 0)
    );

  }

  else if (state.sort === "az") {

    list.sort(
      (a, b) =>
        String(a.title).localeCompare(
          String(b.title)
        )
    );

  }

  else if (state.sort === "za") {

    list.sort(
      (a, b) =>
        String(b.title).localeCompare(
          String(a.title)
        )
    );

  }

  else if (state.sort === "played") {

    list.sort(
      (a, b) =>
        (b.plays || 0) -
        (a.plays || 0)
    );

  }


  state.filtered = list;

  renderSongs();

  $("#songCount").textContent =
    list.length;
}


function syncGenreChips() {

  $$(".chip").forEach((chip) => {

    chip.classList.toggle(
      "active",
      chip.dataset.genre === state.genre
    );

  });

}

/* ==========================================================
   RENDER SONGS
========================================================== */

function renderSongs() {

  const container = $("#songList");

  if (!state.filtered.length) {

    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-icon">
          ♪
        </div>

        <h3>
          ${
            state.search ||
            state.genre !== "all"
              ? "Tidak ada hasil"
              : "Belum ada lagu"
          }
        </h3>

        <p>
          ${
            state.search ||
            state.genre !== "all"
              ? "Coba ubah pencarian atau filter."
              : "Tambahkan rekaman pertama ke Music Library KOMSI."
          }
        </p>

        ${
          state.search ||
          state.genre !== "all"
            ? ""
            : `
              <button
                class="primary-btn small"
                id="emptyUploadBtn"
              >
                Tambah Lagu
              </button>
            `
        }

      </div>
    `;


    $("#emptyUploadBtn")
      ?.addEventListener(
        "click",
        openModal
      );

    return;
  }


  container.innerHTML =
    state.filtered
      .map((song) => {

        const cover =
          song.coverBlob
            ? URL.createObjectURL(
                song.coverBlob
              )
            : "";


        return `
          <article
            class="song-card"
            data-id="${escapeHTML(song.id)}"
          >

            <div class="song-cover">

              ${
                cover
                  ? `
                    <img
                      src="${cover}"
                      alt="${escapeHTML(song.title)}"
                    >
                  `
                  : `
                    <div class="default-cover">
                      <span>♪</span>
                    </div>
                  `
              }

              <button
                class="play-card-btn"
                data-action="play"
                data-id="${escapeHTML(song.id)}"
                aria-label="Putar"
              >
                ▶
              </button>

            </div>


            <div class="song-info">

              <h3>
                ${escapeHTML(song.title)}
              </h3>

              <p class="song-artist">
                ${escapeHTML(
                  song.artist ||
                  "Unknown Artist"
                )}
              </p>

              <div class="song-meta">

                <span>
                  ${escapeHTML(
                    song.genre ||
                    "Other"
                  )}
                </span>

                <span>
                  ${Number(
                    song.plays || 0
                  )} plays
                </span>

              </div>

            </div>


            <div class="song-actions">

              <button
                class="icon-btn"
                data-action="play"
                data-id="${escapeHTML(song.id)}"
                title="Putar"
              >
                ▶
              </button>

              <button
                class="icon-btn danger"
                data-action="delete"
                data-id="${escapeHTML(song.id)}"
                title="Hapus"
              >
                ×
              </button>

            </div>

          </article>
        `;

      })
      .join("");


  /* ACTION BUTTONS */

  $$("#songList [data-action]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        async () => {

          const action =
            button.dataset.action;

          const songId =
            button.dataset.id;


          if (action === "play") {

            await playById(songId);

          }


          if (action === "delete") {

            await deleteById(songId);

          }

        }
      );

    });
}

/* ==========================================================
   PLAYER
========================================================== */

async function playById(songId) {

  const index =
    state.filtered.findIndex(
      (song) =>
        song.id === songId
    );

  const song =
    state.filtered[index];


  if (!song?.audioBlob) {

    toast(
      "File audio tidak tersedia.",
      "error"
    );

    return;
  }


  state.currentIndex = index;

  state.currentSong = song;


  audio.pause();

  audio.src =
    URL.createObjectURL(
      song.audioBlob
    );

  audio.currentTime = 0;

  audio.volume =
    state.muted
      ? 0
      : state.volume;


  try {

    await audio.play();


    song.plays =
      Number(song.plays || 0) + 1;


    await putSong(song);


    state.songs =
      state.songs.map(
        (item) =>
          item.id === song.id
            ? song
            : item
      );


    applyFilters();

  }

  catch (error) {

    console.error(error);

    toast(
      "Audio tidak dapat diputar.",
      "error"
    );

  }


  updatePlayer();
}


async function togglePlay() {

  if (!state.currentSong) {

    if (state.filtered.length) {

      await playById(
        state.filtered[0].id
      );

    }

    return;
  }


  if (audio.paused) {

    try {

      await audio.play();

    }

    catch (error) {

      console.error(error);

    }

  }

  else {

    audio.pause();

  }

}


async function next() {

  if (!state.filtered.length) {
    return;
  }


  let index =
    state.currentIndex + 1;


  if (
    index >= state.filtered.length ||
    state.currentIndex < 0
  ) {

    index = 0;

  }


  await playById(
    state.filtered[index].id
  );
}


async function previous() {

  if (!state.filtered.length) {
    return;
  }


  let index =
    state.currentIndex - 1;


  if (index < 0) {

    index =
      state.filtered.length - 1;

  }


  await playById(
    state.filtered[index].id
  );
}


/* ==========================================================
   PLAYER UI
========================================================== */

function updatePlayer() {

  const song =
    state.currentSong;


  $("#playerTitle").textContent =
    song?.title ||
    "Belum ada lagu";


  $("#playerArtist").textContent =
    song?.artist ||
    "Pilih musik untuk mulai";


  $("#playBtn").textContent =
    state.playing
      ? "Ⅱ"
      : "▶";


  $("#muteBtn").textContent =
    state.muted ||
    state.volume === 0
      ? "🔇"
      : "🔊";


  $("#volumeControl").value =
    state.muted
      ? 0
      : state.volume;


  const cover =
    $("#playerCover");


  if (song?.coverBlob) {

    cover.innerHTML = `
      <img
        src="${URL.createObjectURL(
          song.coverBlob
        )}"
        alt=""
      >
    `;

  }

  else {

    cover.innerHTML =
      `<span>♪</span>`;

  }


  $("#currentTime").textContent =
    formatTime(
      audio.currentTime
    );


  $("#duration").textContent =
    formatTime(
      audio.duration
    );


  updateProgress();
}


function updateProgress() {

  const percent =
    Number.isFinite(
      audio.duration
    ) &&
    audio.duration > 0

      ? (
          audio.currentTime /
          audio.duration
        ) * 100

      : 0;


  $("#progressBar").value =
    percent;


  $("#currentTime").textContent =
    formatTime(
      audio.currentTime
    );
}


/* ==========================================================
   MUTE
========================================================== */

function toggleMute() {

  state.muted =
    !state.muted;


  audio.volume =
    state.muted
      ? 0
      : state.volume;


  updatePlayer();
}

/* ==========================================================
   UPLOAD SONG
========================================================== */

async function uploadSong(event) {

  event.preventDefault();


  const form =
    event.currentTarget;


  const formData =
    new FormData(form);


  const audioFile =
    formData.get("audio");


  const coverFile =
    formData.get("cover");


  if (
    !audioFile ||
    !audioFile.type?.startsWith(
      "audio/"
    )
  ) {

    toast(
      "Pilih file audio yang valid.",
      "error"
    );

    return;
  }


  const song = {

    id: generateId(),

    title:
      String(
        formData.get("title") ||
        "Tanpa Judul"
      ).trim(),

    artist:
      String(
        formData.get("artist") ||
        "Unknown Artist"
      ).trim(),

    album:
      String(
        formData.get("album") ||
        ""
      ).trim(),

    genre:
      String(
        formData.get("genre") ||
        "Other"
      ),

    audioBlob:
      audioFile,

    coverBlob:
      coverFile instanceof File &&
      coverFile.size
        ? coverFile
        : null,

    plays: 0,

    createdAt:
      Date.now()

  };


  try {

    await putSong(song);


    state.songs.push(song);


    closeModal();


    form.reset();


    $("#audioFileName").textContent =
      "Belum dipilih";


    $("#coverFileName").textContent =
      "Opsional";


    applyFilters();


    toast(
      "Lagu berhasil ditambahkan.",
      "success"
    );

  }

  catch (error) {

    console.error(error);

    toast(
      "Gagal menyimpan lagu.",
      "error"
    );

  }
}

/* ==========================================================
   DELETE SONG
========================================================== */

async function deleteById(songId) {

  const song =
    state.songs.find(
      (item) =>
        item.id === songId
    );


  if (!song) {
    return;
  }


  const confirmed =
    confirm(
      `Hapus "${song.title}" dari Music Library?`
    );


  if (!confirmed) {
    return;
  }


  try {

    await removeSong(songId);


    state.songs =
      state.songs.filter(
        (item) =>
          item.id !== songId
      );


    if (
      state.currentSong?.id ===
      songId
    ) {

      audio.pause();

      audio.src = "";

      state.currentSong =
        null;

      state.currentIndex =
        -1;

      state.playing =
        false;

    }


    applyFilters();

    updatePlayer();


    toast(
      "Lagu berhasil dihapus.",
      "success"
    );

  }

  catch (error) {

    console.error(error);

    toast(
      "Gagal menghapus lagu.",
      "error"
    );

  }
}

/* ==========================================================
   MODAL
========================================================== */

function openModal() {

  const modal =
    $("#uploadModal");


  modal.classList.add(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body.style.overflow =
    "hidden";
}


function closeModal() {

  const modal =
    $("#uploadModal");


  modal.classList.remove(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body.style.overflow =
    "";
}

/* ==========================================================
   TOAST
========================================================== */

let toastTimer;


function toast(
  message,
  type = "info"
) {

  const element =
    $("#toast");


  element.textContent =
    message;


  element.className =
    `toast ${type} show`;


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(() => {

      element.classList.remove(
        "show"
      );

    }, 2800);
}

/* ==========================================================
   KEYBOARD SHORTCUTS
========================================================== */

function keyboard(event) {

  const tag =
    document.activeElement?.tagName;


  const typing =
    [
      "INPUT",
      "TEXTAREA",
      "SELECT"
    ].includes(tag);


  /* CTRL + K */

  if (
    (event.ctrlKey ||
      event.metaKey) &&
    event.key.toLowerCase() === "k"
  ) {

    event.preventDefault();

    $("#searchInput").focus();

  }


  if (typing) {
    return;
  }


  /* SPACE = PLAY */

  if (
    event.code === "Space"
  ) {

    event.preventDefault();

    togglePlay();

  }


  /* ARROW RIGHT */

  if (
    event.code === "ArrowRight"
  ) {

    next();

  }


  /* ARROW LEFT */

  if (
    event.code === "ArrowLeft"
  ) {

    previous();

  }
}


/* ==========================================================
   GLOBAL KOMSI API
========================================================== */

window.KOMSI = {

  state,

  playById,

  next,

  previous,

  togglePlay,

  openModal,

  closeModal

};
