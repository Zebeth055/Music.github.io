// =====================================================================
//  Play Music — lógica de la aplicación
// =====================================================================

// =====================================================================
//  MIGRACION DESDE "NINTENDO MUSIC"
//  La app se renombro a Play Music. Las claves de localStorage y la base de
//  datos tambien, pero antes de renombrarlas se copian los datos del usuario
//  para que no pierda su biblioteca, playlists, favoritos ni volumen.
//  Es idempotente: si no quedan datos antiguos, no hace nada.
// =====================================================================
const CLAVES_LEGADAS = {
    nintendoPlaylists: 'playMusicPlaylists',
    nintendoPlaylistCovers: 'playMusicPlaylistCovers',
    nintendoRecent: 'playMusicRecent',
    nintendoFavorites: 'playMusicFavorites',
    nintendoRecentlyAddedGames: 'playMusicRecentlyAddedGames',
    nintendoVolume: 'playMusicVolume'
};

function migrarClavesLocales() {
    for (const [vieja, nueva] of Object.entries(CLAVES_LEGADAS)) {
        let valor = null;
        try { valor = localStorage.getItem(vieja); } catch (e) { continue; }
        if (valor === null) continue;
        try {
            if (localStorage.getItem(nueva) === null) localStorage.setItem(nueva, valor);
            localStorage.removeItem(vieja);
        } catch (e) { /* cuota llena: se conserva la clave antigua */ }
    }
}
migrarClavesLocales();

// --- Variables Globales y Estado ---
let libraryData = {};
let globalAllTracks = {};
let currentPlaylist = [];
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;
let trackPendingToAdd = null;
let currentGameView = null;
let playlistToEditCover = null;
let currentEditingPlaylist = null;

let currentSortOrder = 'alpha-asc';
let currentDerivedColor = '230, 0, 18';
let vinylAnim = null;
let isTempMixPlaying = false;
let currentObjectUrl = null;
let colorToken = 0;
let lastRenderedRecentTop = null;
let lastFocusedEl = null;

// Persistencia en LocalStorage
let customPlaylists = JSON.parse(localStorage.getItem('playMusicPlaylists')) || {};
let playlistCovers = JSON.parse(localStorage.getItem('playMusicPlaylistCovers')) || {};
let recentlyPlayedPaths = JSON.parse(localStorage.getItem('playMusicRecent')) || [];
let favoriteTracks = JSON.parse(localStorage.getItem('playMusicFavorites')) || [];

// Almacenaje de Juegos (Carpetas) añadidas recientemente con temporizador
let recentlyAddedGames = JSON.parse(localStorage.getItem('playMusicRecentlyAddedGames')) || [];

// --- Elementos del DOM ---
const audioPlayer = new Audio();
audioPlayer.preload = 'metadata';

const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const appContent = document.getElementById('app-content');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchSuggestions = document.getElementById('search-suggestions');
const exploreContainer = document.getElementById('explore-container');
const recentContainer = document.getElementById('recent-container');
const homeGamesContainer = document.getElementById('home-games-container');
const playlistsContainer = document.getElementById('playlists-container');
const playlistCoverInput = document.getElementById('playlist-cover-input');
const toastContainer = document.getElementById('toast-container');
const miniPlayerEl = document.getElementById('mini-player');
const fullPlayerEl = document.getElementById('full-player');

const playPauseBtns = [document.getElementById('mini-play-pause'), document.getElementById('btn-play-pause')];
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const miniRepeat = document.getElementById('mini-repeat');
const miniNext = document.getElementById('mini-next');
const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');

// =====================================================================
//  UTILIDADES
// =====================================================================
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Escapa texto para insertarlo de forma segura en innerHTML
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// El atributo `hidden` solo lo aplica la hoja del navegador y cualquier regla
// de autor con `display` lo anula, así que se marca también la clase `.hidden`
// (que el CSS define como `display: none !important`).
function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = hidden;
    el.classList.toggle('hidden', hidden);
}

function isElementVisible(el) {
    if (!el) return false;
    if (el.closest('.hidden')) return false;
    return el.clientWidth > 0 && el.clientHeight > 0;
}

// =====================================================================
//  NOTIFICACIONES (TOASTS)
// =====================================================================
const TOAST_ICONS = { success: 'check_circle', error: 'error', info: 'info' };

function toast(message, type = 'info', duration = 3200) {
    if (!toastContainer) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span>${esc(message)}</span>`;
    toastContainer.appendChild(el);

    while (toastContainer.children.length > 3) {
        toastContainer.firstElementChild.remove();
    }

    setTimeout(() => {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 400);
    }, duration);
}

// =====================================================================
//  SISTEMA DE MODALES (accesible: Escape, backdrop, foco atrapado)
// =====================================================================
const openModals = [];

function getFocusable(root) {
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll(selector))
        .filter(el => el.getClientRects().length > 0 || el === document.activeElement);
}

function openModalEl(el) {
    if (!el) return;
    if (el.classList.contains('hidden')) {
        lastFocusedEl = document.activeElement;
        openModals.push(el);
    }
    setHidden(el, false);
    // Si no hay un control visible, el foco queda en el panel del modal
    const target = getFocusable(el)[0] || el.querySelector('.modal-content') || el;
    if (target && typeof target.focus === 'function') target.focus();
}

function closeModalEl(el) {
    if (!el) return;
    setHidden(el, true);
    const index = openModals.indexOf(el);
    if (index > -1) openModals.splice(index, 1);
    if (!openModals.length && lastFocusedEl && document.contains(lastFocusedEl)) {
        lastFocusedEl.focus();
    }
    lastFocusedEl = null;
}

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModalEl(modal);
    });
    const content = modal.querySelector('.modal-content');
    if (content && !content.hasAttribute('tabindex')) content.setAttribute('tabindex', '-1');
});

function showModal(title, message) {
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    if (modalTitle) modalTitle.textContent = title;
    if (modalText) modalText.textContent = message;
    openModalEl(document.getElementById('custom-modal'));
}
document.getElementById('modal-close')?.addEventListener('click', () => closeModalEl(document.getElementById('custom-modal')));
document.getElementById('close-modal')?.addEventListener('click', () => closeModalEl(document.getElementById('playlist-modal')));

let inputModalCallback = null;
function showInputModal(title, placeholder, callback) {
    const inputTitle = document.getElementById('input-modal-title');
    const inputEl = document.getElementById('input-modal-value');
    inputModalCallback = callback;
    if (inputTitle) inputTitle.textContent = title;
    if (inputEl) {
        inputEl.placeholder = placeholder;
        inputEl.value = '';
    }
    openModalEl(document.getElementById('input-modal'));
}
document.getElementById('input-modal-cancel')?.addEventListener('click', () => closeModalEl(document.getElementById('input-modal')));
document.getElementById('input-modal-confirm')?.addEventListener('click', () => {
    const inputEl = document.getElementById('input-modal-value');
    const val = inputEl ? inputEl.value.trim() : '';
    if (val && inputModalCallback) inputModalCallback(val);
    closeModalEl(document.getElementById('input-modal'));
});
document.getElementById('input-modal-value')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('input-modal-confirm')?.click();
    }
});

let confirmModalCallback = null;
function showConfirmModal(title, text, callback) {
    const titleEl = document.getElementById('confirm-modal-title');
    const textEl = document.getElementById('confirm-modal-text');
    confirmModalCallback = callback;
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    openModalEl(document.getElementById('confirm-modal'));
}
document.getElementById('confirm-modal-cancel')?.addEventListener('click', () => closeModalEl(document.getElementById('confirm-modal')));
document.getElementById('confirm-modal-accept')?.addEventListener('click', () => {
    if (confirmModalCallback) confirmModalCallback();
    closeModalEl(document.getElementById('confirm-modal'));
});

// Escape cierra el modal superior; si no hay modales, minimiza el reproductor
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openModals.length) {
        closeModalEl(openModals[openModals.length - 1]);
        return;
    }
    if (document.getElementById('theme-menu')?.classList.contains('open')) {
        document.getElementById('theme-menu').classList.remove('open');
        document.getElementById('theme-trigger')?.setAttribute('aria-expanded', 'false');
        return;
    }
    if (fullPlayerEl && !fullPlayerEl.classList.contains('hidden')) {
        fullPlayerEl.classList.add('hidden');
    }
});

// Atrapa el foco dentro del modal abierto
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !openModals.length) return;
    const modal = openModals[openModals.length - 1];
    const focusable = getFocusable(modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

// Atajo "/" para ir al buscador
document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    switchView('view-search');
    searchInput?.focus();
});

// =====================================================================
//  SCROLL HORIZONTAL
// =====================================================================
function updateScrollArrows() {
    document.querySelectorAll('.scroll-arrow').forEach(arrow => {
        const container = document.getElementById(arrow.dataset.target);
        if (!container) return;
        const max = container.scrollWidth - container.clientWidth;
        if (max <= 2) {
            arrow.disabled = true;
            return;
        }
        const isLeft = arrow.classList.contains('left-arrow');
        arrow.disabled = isLeft ? container.scrollLeft <= 2 : container.scrollLeft >= max - 2;
    });
}

const scheduleArrowUpdate = () => requestAnimationFrame(updateScrollArrows);

document.querySelectorAll('.scroll-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
        const container = document.getElementById(arrow.dataset.target);
        if (!container) return;
        const dir = arrow.classList.contains('left-arrow') ? -1 : 1;
        container.scrollBy({ left: (container.clientWidth * 0.8) * dir, behavior: 'smooth' });
    });
});

document.querySelectorAll('.horizontal-scroll').forEach(container => {
    container.addEventListener('scroll', scheduleArrowUpdate, { passive: true });
});
window.addEventListener('resize', scheduleArrowUpdate);

// =====================================================================
//  VOLUMEN
// =====================================================================
function paintSlider(slider, value) {
    if (!slider) return;
    slider.style.setProperty('--fill', `${value}%`);
}

function paintVolumeIcons(value) {
    const icons = document.querySelectorAll('.volume-container .material-symbols-rounded');
    if (icons.length !== 2) return;
    icons[0].textContent = value === 0 ? 'volume_off' : value < 50 ? 'volume_down' : 'volume_up';
    icons[1].textContent = value === 0 ? 'volume_off' : value < 50 ? 'volume_down' : 'volume_up';
}

function setVolume(value, persist = false) {
    const clamped = Math.min(100, Math.max(0, value));
    audioPlayer.volume = clamped / 100;
    if (volumeSlider) {
        volumeSlider.value = clamped;
        paintSlider(volumeSlider, clamped);
    }
    paintVolumeIcons(clamped);
    if (persist) {
        try { localStorage.setItem('playMusicVolume', String(clamped)); } catch (e) { /* cuota llena */ }
    }
}

volumeSlider?.addEventListener('input', (e) => setVolume(Number(e.target.value), true));

// =====================================================================
//  BASE DE DATOS (IndexedDB)
// =====================================================================
const DB_NAME = 'PlayMusicDB';
const DB_LEGADA = 'NintendoMusicDB';

function abrirDB(nombre) {
    return new Promise((res, rej) => {
        const req = indexedDB.open(nombre, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

function openDB() { return abrirDB(DB_NAME); }

// Copia los archivos de la base de datos antigua a la nueva y luego la borra,
// para que el usuario no pierda la biblioteca al renombrar la app.
async function migrarBaseDeDatos() {
    let vieja = null;
    try { vieja = await abrirDB(DB_LEGADA); } catch (e) { return; }
    if (!vieja) return;

    let registros = [];
    try {
        if (vieja.objectStoreNames.contains('files')) {
            registros = await new Promise((res, rej) => {
                const rq = vieja.transaction('files', 'readonly').objectStore('files').getAll();
                rq.onsuccess = () => res(rq.result || []);
                rq.onerror = () => rej(rq.error);
            });
        }
    } catch (e) {
        registros = [];
    } finally {
        vieja.close();
    }

    if (registros.length === 0) {
        // No habia nada guardado: se borra la base vacia que se abrio al vuelo.
        indexedDB.deleteDatabase(DB_LEGADA);
        return;
    }

    try {
        const nueva = await openDB();
        const total = await new Promise((res, rej) => {
            const tx = nueva.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            registros.forEach(reg => { try { store.put(reg); } catch (e) { /* registro ilegible */ } });
            tx.oncomplete = () => res(registros.length);
            tx.onerror = () => rej(tx.error);
        });
        nueva.close();
        indexedDB.deleteDatabase(DB_LEGADA);
        console.info('Biblioteca migrada a ' + DB_NAME + ': ' + total + ' archivos.');
    } catch (e) {
        console.warn('No se pudo migrar la base de datos anterior:', e);
    }
}

async function loadFilesFromDB() {
    const statusEl = document.getElementById('db-status');
    const clearBtn = document.getElementById('clear-db-btn');
    let data = [];

    try {
        const db = await openDB();
        const store = db.transaction('files', 'readonly').objectStore('files');
        data = await new Promise((res, rej) => {
            const req = store.getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
        db.close();
    } catch (err) {
        console.error('Error al leer la base de datos:', err);
        if (statusEl) statusEl.textContent = 'No se pudo leer la biblioteca guardada.';
    }

    if (data.length > 0) {
        datosBiblioteca = data;
        if (statusEl) statusEl.textContent = `Música cargada (${data.length} archivos).`;
        setHidden(clearBtn, false);
        await processLibrary(data);
        renderFoldersList(data);
        return;
    }

    datosBiblioteca = [];
    setHidden(clearBtn, true);
    if (statusEl && !statusEl.textContent.startsWith('No se pudo')) {
        statusEl.textContent = 'Carga una carpeta. Se guardará automáticamente.';
    }
    libraryData = {};
    globalAllTracks = {};
    dominantColorCache.clear();
    renderFoldersList([]);
    renderHomeCards();
    renderRecent(true);
    renderRecentlyAdded();
    renderSearchSuggestions();
    updateSidebarPlaylists();
}

// =====================================================================
//  EXTRACCIÓN DE PORTADAS EMBUTIDAS (FLAC / MP3)
// =====================================================================
async function extractEmbeddedCover(file) {
    try {
        const buffer = await file.slice(0, 3 * 1024 * 1024).arrayBuffer();
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        // 1. Detección de FLAC (Firma "fLaC")
        if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
            let offset = 4;
            while (offset < bytes.length) {
                const header = view.getUint32(offset);
                const isLast = (header >>> 31) === 1;
                const blockType = (header >>> 24) & 0x7F;
                const blockLen = header & 0xFFFFFF;
                offset += 4;

                if (blockType === 6) { // METADATA_BLOCK_PICTURE
                    let pOffset = offset;
                    view.getUint32(pOffset); pOffset += 4;
                    const mimeLen = view.getUint32(pOffset); pOffset += 4;
                    const mimeStr = new TextDecoder().decode(bytes.subarray(pOffset, pOffset + mimeLen)); pOffset += mimeLen;
                    const descLen = view.getUint32(pOffset); pOffset += 4;
                    pOffset += descLen;
                    pOffset += 16;
                    const picDataLen = view.getUint32(pOffset); pOffset += 4;

                    const picData = bytes.subarray(pOffset, pOffset + picDataLen);
                    return URL.createObjectURL(new Blob([picData], { type: mimeStr || 'image/jpeg' }));
                }
                offset += blockLen;
                if (isLast) break;
            }
        }

        // 2. Detección de MP3 con ID3v2 (Firma "ID3")
        if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
            const version = bytes[3];
            const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
            let offset = 10;
            const end = Math.min(offset + tagSize, bytes.length);

            while (offset < end) {
                if (bytes[offset] === 0) break;
                const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

                let frameSize;
                if (version === 3) frameSize = view.getUint32(offset + 4);
                else if (version === 4) frameSize = (bytes[offset + 4] << 21) | (bytes[offset + 5] << 14) | (bytes[offset + 6] << 7) | bytes[offset + 7];
                else break;

                const frameOffset = offset + 10;
                if (frameId === 'APIC') {
                    let pOffset = frameOffset;
                    const encoding = bytes[pOffset++];

                    const mimeStart = pOffset;
                    while (bytes[pOffset] !== 0) pOffset++;
                    const mimeStr = new TextDecoder().decode(bytes.subarray(mimeStart, pOffset));
                    pOffset++;
                    pOffset++;

                    if (encoding === 1 || encoding === 2) {
                        while (pOffset < end && (bytes[pOffset] !== 0 || bytes[pOffset + 1] !== 0)) pOffset += 2;
                        pOffset += 2;
                    } else {
                        while (pOffset < end && bytes[pOffset] !== 0) pOffset++;
                        pOffset++;
                    }

                    const picData = bytes.subarray(pOffset, frameOffset + frameSize);
                    return URL.createObjectURL(new Blob([picData], { type: mimeStr || 'image/jpeg' }));
                }
                offset += 10 + frameSize;
            }
        }
    } catch (e) {
        console.warn('No se pudo leer la metadata interna de la pista.');
    }
    return null;
}

// =====================================================================
//  COLOR DOMINANTE DE LA PORTADA (memoizado por URL)
// =====================================================================
const dominantColorCache = new Map();
const colorSampleCanvas = document.createElement('canvas');
const colorSampleCtx = colorSampleCanvas.getContext('2d', { willReadFrequently: true });

function getDominantColor(coverUrl) {
    if (!coverUrl) return Promise.resolve(null);
    if (dominantColorCache.has(coverUrl)) return Promise.resolve(dominantColorCache.get(coverUrl));

    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 32;
                colorSampleCanvas.width = size;
                colorSampleCanvas.height = size;
                colorSampleCtx.clearRect(0, 0, size, size);
                colorSampleCtx.drawImage(img, 0, 0, size, size);

                const data = colorSampleCtx.getImageData(0, 0, size, size).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] > 0) { r += data[i]; g += data[i + 1]; b += data[i + 2]; count++; }
                }
                if (count === 0) count = 1;
                const result = { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
                dominantColorCache.set(coverUrl, result);
                resolve(result);
            } catch (e) {
                dominantColorCache.set(coverUrl, null);
                resolve(null);
            }
        };
        img.onerror = () => {
            dominantColorCache.set(coverUrl, null);
            resolve(null);
        };
        img.src = coverUrl;
    });
}

function applyTrackColors(track, hasBg) {
    const token = ++colorToken;
    const root = document.documentElement;
    const full = fullPlayerEl;
    const mini = miniPlayerEl;

    getDominantColor(track.coverUrl).then(color => {
        if (token !== colorToken) return; // llegó una respuesta vieja: ignorar

        if (!color) {
            currentDerivedColor = '230, 0, 18';
            root.style.setProperty('--color-enfasis', '#e60012');
            root.style.setProperty('--accent-glow', 'rgba(230, 0, 18, 0.6)');
            if (full) full.style.background = hasBg
                ? 'linear-gradient(to bottom, rgba(230, 0, 18, 0.45), rgba(0, 0, 0, 0.85))'
                : 'linear-gradient(to bottom, rgb(190, 24, 38), #000000)';
            if (mini) mini.style.background = 'var(--surface-light)';
        } else {
            const { r, g, b } = color;
            currentDerivedColor = `${r}, ${g}, ${b}`;
            root.style.setProperty('--color-enfasis', `rgb(${r}, ${g}, ${b})`);
            root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.55)`);
            if (full) full.style.background = hasBg
                ? `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.45), rgba(0, 0, 0, 0.85))`
                : `linear-gradient(to bottom, rgb(${r}, ${g}, ${b}), #000000)`;
            if (mini) mini.style.background = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.35), var(--surface-color))`;
        }

        paintSlider(progressBar, Number(progressBar?.value || 0));
    });
}

// =====================================================================
//  DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Primero se copian los datos del nombre anterior; despues se lee nada.
    migrarBaseDeDatos().finally(() => loadFilesFromDB());
    renderPlaylistsUI();
    renderHomeCustomPlaylists();
    updateRepeatUI();
    updateSidebarPlaylists();
    updateScrollArrows();

    const storedVolume = Number(localStorage.getItem('playMusicVolume'));
    setVolume(Number.isFinite(storedVolume) && localStorage.getItem('playMusicVolume') !== null ? storedVolume : 100);

    // El progreso se pinta en el color del tema (estable y siempre visible)
    paintSlider(progressBar, 0);

    // Anillo del vinilo: se anima con la Web Animations API
    const vinylEl = document.getElementById('vinyl-record');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (vinylEl && !reduceMotion && typeof vinylEl.animate === 'function') {
        vinylAnim = vinylEl.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
            { duration: 4000, iterations: Infinity }
        );
        vinylAnim.pause();
    }

    const btnClearDB = document.getElementById('clear-db-btn');
    btnClearDB?.addEventListener('click', () => {
        showConfirmModal('¿Borrar TODA la biblioteca?', 'Se eliminarán todos los juegos locales, playlists e historial.', () => {
            const statusEl = document.getElementById('db-status');
            if (statusEl) statusEl.textContent = 'Borrando base de datos, por favor espera...';
            openDB().then(db => {
                const tx = db.transaction('files', 'readwrite');
                tx.objectStore('files').clear();
                tx.oncomplete = () => {
                    ['playMusicPlaylists', 'playMusicPlaylistCovers', 'playMusicRecent', 'playMusicRecentlyAddedGames', 'playMusicFavorites']
                        .forEach(key => localStorage.removeItem(key));
                    location.reload();
                };
                tx.onerror = () => showModal('Error', 'Hubo un problema al intentar borrar la base de datos.');
            });
        });
    });

    document.getElementById('btn-nav-favorites')?.addEventListener('click', openFavoritesView);
    document.getElementById('open-favorites-card')?.addEventListener('click', openFavoritesView);
    document.getElementById('open-favorites-card')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFavoritesView(); }
    });

    const btnRandomMix = document.getElementById('btn-random-mix');
    const btnSaveMix = document.getElementById('btn-save-mix');

    btnRandomMix?.addEventListener('click', () => {
        const allTracksArray = Object.values(globalAllTracks);
        if (allTracksArray.length === 0) {
            toast('No hay música cargada para hacer un mix.', 'error');
            return;
        }

        const shuffled = [...allTracksArray].sort(() => Math.random() - 0.5);
        currentPlaylist = shuffled;
        isTempMixPlaying = true;
        setHidden(btnSaveMix, false);
        openGameView({ title: 'Mix Aleatorio', tracks: currentPlaylist, coverUrl: null }, false);
        playTrack(0);
    });

    btnSaveMix?.addEventListener('click', () => {
        if (!isTempMixPlaying) return;
        showInputModal('Guardar Mix', 'Nombre para esta playlist', (mixName) => {
            mixName = mixName.trim();
            if (!mixName) return;
            if (customPlaylists[mixName]) {
                showModal('Error', 'Ya existe una playlist con ese nombre.');
                return;
            }
            customPlaylists[mixName] = currentPlaylist.map(t => t.path);
            savePlaylists();
            isTempMixPlaying = false;
            setHidden(btnSaveMix, true);
            toast(`Mix «${mixName}» guardado en tus listas.`, 'success');
        });
    });
});

// =====================================================================
//  FAVORITOS Y SIDEBAR
// =====================================================================
function openFavoritesView() {
    const favTracks = favoriteTracks.map(path => globalAllTracks[path]).filter(Boolean);
    if (favTracks.length === 0) {
        toast('Todavía no marcaste ninguna canción como favorita.', 'info');
        return;
    }
    openGameView({ title: 'Mis Favoritos', tracks: favTracks, coverUrl: null }, false);
}

function syncFavButtons(path) {
    const active = favoriteTracks.includes(path);
    document.querySelectorAll('.fav-btn').forEach(btn => {
        if (btn.dataset.path !== path) return;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.setAttribute('aria-label', active ? 'Quitar de favoritos' : 'Añadir a favoritos');
        const icon = btn.querySelector('.material-symbols-rounded');
        if (icon) icon.style.fontVariationSettings = active ? "'FILL' 1" : "'FILL' 0";
    });
}

function toggleFavorite(path, e) {
    if (e) e.stopPropagation();
    const index = favoriteTracks.indexOf(path);
    if (index > -1) {
        favoriteTracks.splice(index, 1);
    } else {
        favoriteTracks.push(path);
    }
    try {
        localStorage.setItem('playMusicFavorites', JSON.stringify(favoriteTracks));
    } catch (err) {
        toast('No se pudo guardar el favorito (almacenamiento lleno).', 'error');
    }
    syncFavButtons(path);
}

function favButtonHTML(track) {
    const isFav = favoriteTracks.includes(track.path);
    return `<button type="button" class="fav-btn${isFav ? ' is-active' : ''}" data-path="${esc(track.path)}" aria-pressed="${isFav}" aria-label="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
        <span class="material-symbols-rounded" style="font-variation-settings: 'FILL' ${isFav ? 1 : 0};" aria-hidden="true">favorite</span>
    </button>`;
}

function updateSidebarPlaylists() {
    const sidebarList = document.getElementById('sidebar-playlists-list');
    if (!sidebarList) return;

    sidebarList.replaceChildren();
    const fragment = document.createDocumentFragment();

    Object.keys(customPlaylists).forEach(listName => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-playlist-item bouncy';
        button.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">queue_music</span><span>${esc(listName)}</span>`;
        button.addEventListener('click', () => {
            const pl = customPlaylists[listName].map(path => globalAllTracks[path]).filter(Boolean);
            if (pl.length === 0) {
                toast('Esta playlist está vacía.', 'info');
                return;
            }
            openGameView({ title: listName, tracks: pl, coverUrl: playlistCovers[listName] || null }, true);
        });
        li.appendChild(button);
        fragment.appendChild(li);
    });

    sidebarList.appendChild(fragment);
}

// =====================================================================
//  CARGA DE CARPETAS
// =====================================================================

// Estado de la carga en curso, para poder cancelarla a mitad
const CARGA = { activa: false, cancelada: false, total: 0, procesados: 0 };

// Todos los items que hay en la biblioteca (los de la BD). Se mantiene para
// poder repintar las carpetas mientras carga, sin releer la base de datos.
let datosBiblioteca = [];

function setCargaUI(visible) {
    setHidden(document.getElementById('cancel-load-btn'), !visible);
    setHidden(document.getElementById('load-progress'), !visible);
    setHidden(document.getElementById('load-current'), !visible);
    if (!visible) {
        const bar = document.getElementById('load-progress-bar');
        if (bar) bar.style.width = '0%';
        const cur = document.getElementById('load-current');
        if (cur) cur.textContent = '';
    }
}

function setProgresoCarga(hechos, total, nombreActual) {
    const pct = total > 0 ? Math.min(100, Math.round((hechos / total) * 100)) : 0;
    const statusEl = document.getElementById('db-status');
    const bar = document.getElementById('load-progress-bar');
    const cur = document.getElementById('load-current');
    if (statusEl) statusEl.textContent = `Cargando ${hechos} / ${total} archivos (${pct}%)`;
    if (bar) bar.style.width = `${pct}%`;
    if (cur) cur.textContent = nombreActual || '';
}

function obtenerJuego(nombre) {
    if (!libraryData[nombre]) {
        libraryData[nombre] = { title: nombre, tracks: [], coverUrl: null, composerInfo: '', customBackground: null };
    }
    return libraryData[nombre];
}

// Incorpora un lote de archivos ya a la biblioteca en memoria, para que
// aparezcan en pantalla segun llegan en vez de al final.
// Devuelve los juegos tocados por este lote.
async function ingestarLote(items) {
    const juegos = new Set();

    // Recursos del juego: portada, compositor y fondo
    for (const item of items) {
        const parts = item.path.split('/');
        const nombre = parts.length > 1 ? parts[parts.length - 2] : 'Otros';
        const juego = obtenerJuego(nombre);
        juegos.add(nombre);

        if (item.file.name.match(/\.(jpe?g|png|webp|gif)$/i)) {
            // La portada puede llegar despues que las canciones: se les
            // actualiza a las pistas ya guardadas de ese juego.
            if (juego.coverUrl) URL.revokeObjectURL(juego.coverUrl);
            juego.coverUrl = URL.createObjectURL(item.file);
            juego.tracks.forEach(t => { t.coverUrl = juego.coverUrl; });
        } else if (item.file.name.match(/\.txt$/i)) {
            try { juego.composerInfo = (await item.file.text()).trim(); } catch { /* ilegible */ }
        } else if (item.file.name.match(/\.(mp4|gif|webm)$/i)) {
            if (juego.customBackground) URL.revokeObjectURL(juego.customBackground.url);
            juego.customBackground = {
                url: URL.createObjectURL(item.file),
                isVideo: item.file.name.match(/\.(mp4|webm)$/i) !== null
            };
        }
    }

    // Pistas de audio
    for (const item of items) {
        if (!isAudioFile(item.file)) continue;
        const parts = item.path.split('/');
        const nombre = parts.length > 1 ? parts[parts.length - 2] : 'Otros';
        const juego = obtenerJuego(nombre);
        juegos.add(nombre);

        const trackObj = {
            path: item.path,
            name: item.file.name.replace(/\.[^/.]+$/, ''),
            gameName: nombre,
            file: item.file,
            coverUrl: juego.coverUrl,
            composerInfo: juego.composerInfo,
            customBackground: juego.customBackground
        };
        juego.tracks.push(trackObj);
        globalAllTracks[item.path] = trackObj;
    }

    return juegos;
}

async function borrarRutas(db, rutas) {
    for (let i = 0; i < rutas.length; i += 200) {
        const trozo = rutas.slice(i, i + 200);
        await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            trozo.forEach(p => store.delete(p));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

document.getElementById('cancel-load-btn')?.addEventListener('click', () => {
    if (!CARGA.activa) return;
    CARGA.cancelada = true;
    const statusEl = document.getElementById('db-status');
    if (statusEl) statusEl.textContent = 'Cancelando...';
});

document.getElementById('audio-upload')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (CARGA.activa) {
        toast('Espera a que termine la carga actual.', 'info');
        e.target.value = '';
        return;
    }

    const statusEl = document.getElementById('db-status');
    const db = await openDB();
    const CHUNK_SIZE = 100;

    // Rutas que ya estaban en la biblioteca: si se cancela, solo se borra lo
    // que se haya anadido ahora, nunca lo que ya estaba.
    const existentes = new Set(await new Promise((res, rej) => {
        const rq = db.transaction('files', 'readonly').objectStore('files').getAllKeys();
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
    }));

    CARGA.activa = true;
    CARGA.cancelada = false;
    CARGA.total = files.length;
    CARGA.procesados = 0;
    setCargaUI(true);
    setProgresoCarga(0, files.length, '');

    const rutasNuevas = [];
    const juegosNuevos = new Set();
    let ultimoPintado = 0;

    try {
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            if (CARGA.cancelada) break;

            const chunk = files.slice(i, i + CHUNK_SIZE);
            const items = chunk.map(f => ({ file: f, path: f.webkitRelativePath || f.name }));

            await new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                const store = tx.objectStore('files');
                items.forEach(it => {
                    store.put({ file: it.file, path: it.path });
                    rutasNuevas.push(it.path);
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            datosBiblioteca = datosBiblioteca.concat(items);
            const tocados = await ingestarLote(items);
            tocados.forEach(j => juegosNuevos.add(j));
            CARGA.procesados += chunk.length;

            const ultimo = items[items.length - 1];
            setProgresoCarga(CARGA.procesados, files.length, ultimo.path);

            // Se repinta de forma progresiva y espaciada: la interfaz sigue
            // respondiendo aunque sean miles de archivos.
            const ahora = performance.now();
            if (ultimoPintado === 0 || ahora - ultimoPintado > 250) {
                ultimoPintado = ahora;
                renderFoldersList(datosBiblioteca);
                renderHomeCards();
                setHidden(document.getElementById('clear-db-btn'), false);
            }
            await new Promise(r => setTimeout(r, 0));
        }

        // Portadas incrustadas: la parte lenta, y tambien se puede cancelar
        const pendientes = [...juegosNuevos].filter(n => !libraryData[n].coverUrl && libraryData[n].tracks.length > 0);
        for (let i = 0; i < pendientes.length; i++) {
            if (CARGA.cancelada) break;
            const nombre = pendientes[i];
            const juego = libraryData[nombre];
            if (statusEl) statusEl.textContent = `Analizando metadata (${i + 1}/${pendientes.length}): ${nombre}...`;
            const cover = await extractEmbeddedCover(juego.tracks[0].file);
            if (cover) {
                juego.coverUrl = cover;
                juego.tracks.forEach(t => { t.coverUrl = cover; });
            }
            await new Promise(r => setTimeout(r, 0));
        }
    } catch (err) {
        console.error('Error durante la carga:', err);
        if (statusEl) statusEl.textContent = 'Hubo un error al cargar. Se ha restaurado la biblioteca.';
    }

    if (CARGA.cancelada) {
        if (statusEl) statusEl.textContent = 'Cancelando...';
        await borrarRutas(db, rutasNuevas.filter(p => !existentes.has(p)));
        db.close();
        setCargaUI(false);
        // Se sigue marcando como activa hasta terminar de restaurar, para que
        // el estado no desaparezca mientras se está limpiando.
        await loadFilesFromDB();
        CARGA.activa = false;
        if (statusEl) statusEl.textContent = 'Carga cancelada.';
        toast('Carga cancelada.', 'info');
        e.target.value = '';
        return;
    }

    db.close();
    CARGA.activa = false;
    setCargaUI(false);

    const now = Date.now();
    juegosNuevos.forEach(gameName => {
        recentlyAddedGames = recentlyAddedGames.filter(g => g.name !== gameName);
        recentlyAddedGames.unshift({ name: gameName, timestamp: now });
    });
    recentlyAddedGames = recentlyAddedGames.slice(0, 20);
    localStorage.setItem('playMusicRecentlyAddedGames', JSON.stringify(recentlyAddedGames));

    if (statusEl) statusEl.textContent = `Música cargada (${Object.keys(globalAllTracks).length} canciones).`;
    renderFoldersList(datosBiblioteca);
    renderHomeCards();
    renderRecent(true);
    renderRecentlyAdded();
    renderSearchSuggestions();
    scheduleArrowUpdate();
    toast(`${files.length} archivos añadidos.`, 'success');
    e.target.value = '';
});


// =====================================================================
//  GESTIÓN DE CARPETAS INDIVIDUALES
// =====================================================================
const AUDIO_EXT_RE = /\.(mp3|flac|wav|m4a|ogg|aac|opus|wma|ape)$/i;

function isAudioFile(file) {
    return (file.type && file.type.startsWith('audio/')) || AUDIO_EXT_RE.test(file.name);
}

function renderFoldersList(dbData) {
    const list = document.getElementById('added-folders-list');
    if (!list) return;

    const folders = {};
    dbData.forEach(item => {
        if (!isAudioFile(item.file)) return;
        const pathParts = item.path.split('/');
        const folderPath = pathParts.slice(0, -1).join('/');
        const finalPath = folderPath === '' ? 'Raíz' : folderPath;
        folders[finalPath] = (folders[finalPath] || 0) + 1;
    });

    const entries = Object.entries(folders).filter(([, count]) => count > 0);

    if (entries.length === 0) {
        list.innerHTML = `<li class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">folder_off</span><strong>Sin carpetas</strong><span>Cargá una carpeta para empezar.</span></li>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const [folderPath, count] of entries) {
        const li = document.createElement('li');
        li.className = 'folder-item';
        const shortName = folderPath.split('/').pop();
        const displayName = esc(folderPath).replace(/\//g, '<span class="folder-sep" aria-hidden="true">&gt;</span>');

        li.innerHTML = `
            <div class="folder-item-main">
                <span class="material-symbols-rounded folder-item-icon" aria-hidden="true">folder</span>
                <div class="folder-item-text">
                    <p class="song-title folder-item-name">${displayName}</p>
                    <p class="song-game">${count} ${count === 1 ? 'canción' : 'canciones'}</p>
                </div>
            </div>
            <button type="button" class="delete-folder-btn" title="Eliminar carpeta" aria-label="Eliminar la carpeta ${esc(shortName)}">
                <span class="material-symbols-rounded" aria-hidden="true">delete</span>
            </button>`;

        li.querySelector('.delete-folder-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            showConfirmModal(`¿Eliminar «${shortName}»?`, 'Se borrarán sus canciones de tu biblioteca local.', () => {
                deleteFolderFromDB(folderPath);
            });
        });

        fragment.appendChild(li);
    }

    list.replaceChildren(fragment);
}

async function deleteFolderFromDB(folderPath) {
    try {
        const db = await openDB();
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const keys = await new Promise((res, rej) => {
            const req = store.getAllKeys();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });

        const keysToDelete = folderPath === 'Raíz'
            ? keys.filter(key => !key.includes('/'))
            : keys.filter(key => key.startsWith(folderPath + '/'));

        const deletedSet = new Set(keysToDelete);
        keysToDelete.forEach(key => store.delete(key));

        await new Promise((res, rej) => {
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
        });
        db.close();

        recentlyPlayedPaths = recentlyPlayedPaths.filter(p => !deletedSet.has(p));
        favoriteTracks = favoriteTracks.filter(p => !deletedSet.has(p));
        localStorage.setItem('playMusicRecent', JSON.stringify(recentlyPlayedPaths));
        localStorage.setItem('playMusicFavorites', JSON.stringify(favoriteTracks));
        lastRenderedRecentTop = null;

        toast(`Carpeta «${folderPath.split('/').pop()}» eliminada.`, 'success');
        loadFilesFromDB();
    } catch (err) {
        console.error(err);
        showModal('Error', 'No se pudo eliminar la carpeta.');
    }
}

// =====================================================================
//  PROCESAMIENTO DE LA BIBLIOTECA
// =====================================================================
async function processLibrary(dbData) {
    libraryData = {};
    globalAllTracks = {};
    dominantColorCache.clear();

    // PRIMERA PASADA: portadas, textos de compositor y fondos
    for (const item of dbData) {
        const parts = item.path.split('/');
        const game = parts.length > 1 ? parts[parts.length - 2] : 'Otros';

        if (!libraryData[game]) {
            libraryData[game] = { title: game, tracks: [], coverUrl: null, composerInfo: '', customBackground: null };
        }

        if (item.file.name.match(/\.(jpe?g|png|webp|gif)$/i)) {
            if (libraryData[game].coverUrl) URL.revokeObjectURL(libraryData[game].coverUrl);
            libraryData[game].coverUrl = URL.createObjectURL(item.file);
        } else if (item.file.name.match(/\.txt$/i)) {
            libraryData[game].composerInfo = (await item.file.text()).trim();
        } else if (item.file.name.match(/\.(mp4|gif|webm)$/i)) {
            if (libraryData[game].customBackground) URL.revokeObjectURL(libraryData[game].customBackground.url);
            libraryData[game].customBackground = {
                url: URL.createObjectURL(item.file),
                isVideo: item.file.name.match(/\.(mp4|webm)$/i) !== null
            };
        }
    }

    // SEGUNDA PASADA: pistas de audio
    for (const item of dbData) {
        if (!isAudioFile(item.file)) continue;
        const parts = item.path.split('/');
        const game = parts.length > 1 ? parts[parts.length - 2] : 'Otros';

        if (!libraryData[game]) {
            libraryData[game] = { title: game, tracks: [], coverUrl: null, composerInfo: '', customBackground: null };
        }

        const trackObj = {
            path: item.path,
            name: item.file.name.replace(/\.[^/.]+$/, ''),
            gameName: game,
            file: item.file,
            coverUrl: libraryData[game].coverUrl,
            composerInfo: libraryData[game].composerInfo,
            customBackground: libraryData[game].customBackground
        };
        libraryData[game].tracks.push(trackObj);
        globalAllTracks[item.path] = trackObj;
    }

    // TERCERA PASADA: portada incrustada (FLAC/MP3) si el álbum no tiene imagen
    const statusEl = document.getElementById('db-status');
    const gameEntries = Object.entries(libraryData);
    for (let i = 0; i < gameEntries.length; i++) {
        const [gameName, game] = gameEntries[i];
        if (game.coverUrl || game.tracks.length === 0) continue;
        if (statusEl) statusEl.textContent = `Analizando metadata (${i + 1}/${gameEntries.length}): ${gameName}...`;
        const embeddedCover = await extractEmbeddedCover(game.tracks[0].file);
        if (embeddedCover) {
            game.coverUrl = embeddedCover;
            game.tracks.forEach(t => { t.coverUrl = embeddedCover; });
        }
        await new Promise(r => setTimeout(r, 0));
    }

    if (statusEl) {
        statusEl.textContent = `Música cargada (${Object.keys(globalAllTracks).length} canciones).`;
    }
    renderHomeCards();
    renderRecent(true);
    renderRecentlyAdded();
    renderSearchSuggestions();
    scheduleArrowUpdate();
}

// =====================================================================
//  TARJETAS
// =====================================================================
function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'card bouncy';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir ${game.title}`);

    if (game.coverUrl) {
        card.innerHTML = `<div class="card-img-placeholder" style="background-image: url('${esc(game.coverUrl)}');"></div><p class="card-title">${esc(game.title)}</p>`;
    } else {
        card.innerHTML = `<div class="card-img-placeholder is-accent"><span>${esc(game.title)}</span></div><p class="card-title">${esc(game.title)}</p>`;
    }

    const open = () => openGameView(game);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return card;
}

// Un placeholder de "vacío" persistente por grilla (no lo pisa el buscador local)
function setGridEmptyState(grid, html) {
    if (!grid) return;
    let el = grid.querySelector('[data-empty-state]');
    if (!html) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('p');
        el.className = 'empty-state';
        el.setAttribute('data-empty-state', '');
        grid.appendChild(el);
    }
    el.innerHTML = html;
}

function sortGames(games) {
    const sorted = [...games];
    if (currentSortOrder === 'alpha-asc') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (currentSortOrder === 'alpha-desc') sorted.sort((a, b) => b.title.localeCompare(a.title));
    else if (currentSortOrder === 'songs-desc') sorted.sort((a, b) => b.tracks.length - a.tracks.length);
    else if (currentSortOrder === 'songs-asc') sorted.sort((a, b) => a.tracks.length - b.tracks.length);
    return sorted;
}

function renderHomeCards() {
    const allGamesGrid = document.getElementById('all-games-grid');
    if (homeGamesContainer) homeGamesContainer.replaceChildren();
    if (allGamesGrid) {
        allGamesGrid.querySelectorAll('.card').forEach(c => c.remove());
    }

    const games = sortGames(Object.values(libraryData).filter(g => g.tracks.length > 0));

    if (games.length === 0) {
        if (homeGamesContainer) {
            homeGamesContainer.innerHTML = '<p class="helper-text">Cargá una carpeta en «My Music» para ver tus juegos.</p>';
        }
        setGridEmptyState(allGamesGrid, '<span class="material-symbols-rounded" aria-hidden="true">videogame_asset</span><strong>Aún no hay juegos</strong><span>Añadí una carpeta de música para empezar.</span>');
        return;
    }

    setGridEmptyState(allGamesGrid, null);

    if (homeGamesContainer) {
        const fragment = document.createDocumentFragment();
        games.forEach(game => fragment.appendChild(createGameCard(game)));
        homeGamesContainer.appendChild(fragment);
    }
    if (allGamesGrid) {
        const fragment = document.createDocumentFragment();
        games.forEach(game => fragment.appendChild(createGameCard(game)));
        allGamesGrid.appendChild(fragment);
    }
    scheduleArrowUpdate();
}

const sortHome = document.getElementById('sort-home');
const sortAll = document.getElementById('sort-all');

function handleSortChange(e) {
    currentSortOrder = e.target.value;
    if (sortHome) sortHome.value = currentSortOrder;
    if (sortAll) sortAll.value = currentSortOrder;
    renderHomeCards();
}
sortHome?.addEventListener('change', handleSortChange);
sortAll?.addEventListener('change', handleSortChange);

function createRecentCard(track) {
    const card = document.createElement('div');
    card.className = 'card bouncy';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Reproducir ${track.name}`);

    const coverStyle = track.coverUrl ? `background-image: url('${esc(track.coverUrl)}');` : '';
    card.innerHTML = `<div class="card-img-placeholder" style="${coverStyle}"></div><p class="card-title">${esc(track.name)}</p>`;

    const play = () => {
        const game = libraryData[track.gameName];
        if (!game) return;
        openGameView(game);
        currentPlaylist = [...game.tracks];
        const i = currentPlaylist.findIndex(t => t.path === track.path);
        playTrack(i < 0 ? 0 : i);
    };
    card.addEventListener('click', play);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
    });
    return card;
}

const TEN_MINUTES_IN_MS = 10 * 60 * 1000;

function renderRecentlyAdded() {
    const section = document.getElementById('recently-added-section');
    const container = document.getElementById('recently-added-container');
    if (!section || !container) return;

    const now = Date.now();
    const validGames = recentlyAddedGames.filter(g => libraryData[g.name] && (now - g.timestamp) <= TEN_MINUTES_IN_MS);

    if (validGames.length !== recentlyAddedGames.length) {
        recentlyAddedGames = validGames;
        localStorage.setItem('playMusicRecentlyAddedGames', JSON.stringify(recentlyAddedGames));
    }

    setHidden(section, recentlyAddedGames.length === 0);
    if (recentlyAddedGames.length === 0) {
        container.replaceChildren();
        return;
    }

    const fragment = document.createDocumentFragment();
    recentlyAddedGames.forEach(entry => {
        const game = libraryData[entry.name];
        if (!game) return;
        const card = createGameCard(game);
        card.addEventListener('click', () => {
            recentlyAddedGames = recentlyAddedGames.filter(g => g.name !== game.title);
            localStorage.setItem('playMusicRecentlyAddedGames', JSON.stringify(recentlyAddedGames));
            renderRecentlyAdded();
        });
        fragment.appendChild(card);
    });
    container.replaceChildren(fragment);
    scheduleArrowUpdate();
}

function renderRecent(force = false) {
    const top = recentlyPlayedPaths[0] || null;
    if (!force && top === lastRenderedRecentTop) return; // el orden no cambió
    lastRenderedRecentTop = top;

    const allRecentGrid = document.getElementById('all-recent-grid');

    if (recentlyPlayedPaths.length === 0) {
        if (recentContainer) {
            recentContainer.innerHTML = '<p class="helper-text">Aquí aparecerá lo que escuches.</p>';
        }
        setGridEmptyState(allRecentGrid, '<span class="material-symbols-rounded" aria-hidden="true">history</span><strong>Sin historial</strong><span>Reproducí una canción para empezar.</span>');
        return;
    }

    const tracks = recentlyPlayedPaths.map(path => globalAllTracks[path]).filter(Boolean);

    if (tracks.length === 0) {
        if (recentContainer) recentContainer.innerHTML = '<p class="helper-text">Aquí aparecerá lo que escuches.</p>';
        setGridEmptyState(allRecentGrid, '<span class="material-symbols-rounded" aria-hidden="true">history_toggle_off</span><strong>El historial apunta a archivos que ya no están</strong><span>Volvé a cargar la carpeta correspondiente.</span>');
        return;
    }

    setGridEmptyState(allRecentGrid, null);

    if (recentContainer) {
        const fragment = document.createDocumentFragment();
        tracks.forEach(track => fragment.appendChild(createRecentCard(track)));
        recentContainer.replaceChildren(fragment);
    }
    if (allRecentGrid) {
        const fragment = document.createDocumentFragment();
        tracks.forEach(track => fragment.appendChild(createRecentCard(track)));
        allRecentGrid.replaceChildren(fragment);
    }
    scheduleArrowUpdate();
}

document.getElementById('btn-clear-recent')?.addEventListener('click', () => {
    showConfirmModal('¿Vaciar historial?', 'Se borrará tu lista de temas escuchados recientemente.', () => {
        recentlyPlayedPaths = [];
        localStorage.setItem('playMusicRecent', JSON.stringify(recentlyPlayedPaths));
        renderRecent(true);
        toast('Historial vaciado.', 'success');
    });
});

document.getElementById('btn-see-all-games')?.addEventListener('click', () => switchView('view-all-games'));
document.getElementById('btn-see-all-recent')?.addEventListener('click', () => switchView('view-all-recent'));
document.getElementById('btn-back-from-games')?.addEventListener('click', () => switchView('view-home'));
document.getElementById('btn-back-from-recent')?.addEventListener('click', () => switchView('view-home'));

// =====================================================================
//  BÚSQUEDA
// =====================================================================
function renderSearchSuggestions() {
    if (!exploreContainer) return;
    const games = Object.values(libraryData).filter(g => g.tracks.length > 0);

    if (games.length === 0) {
        exploreContainer.innerHTML = '<p class="helper-text">Cargá tu música para ver sugerencias.</p>';
        return;
    }

    const shuffled = [...games].sort(() => 0.5 - Math.random()).slice(0, 10);
    const fragment = document.createDocumentFragment();

    shuffled.forEach(game => {
        const card = createGameCard(game);
        card.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            setHidden(searchSuggestions, false);
            setHidden(searchResults, true);
            openGameView(game);
        });
        fragment.appendChild(card);
    });
    exploreContainer.replaceChildren(fragment);
    scheduleArrowUpdate();
}

searchInput?.addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!searchResults) return;

    if (q === '') {
        setHidden(searchSuggestions, false);
        setHidden(searchResults, true);
        searchResults.replaceChildren();
        return;
    }

    setHidden(searchSuggestions, true);
    setHidden(searchResults, false);

    const matches = [];
    for (const track of Object.values(globalAllTracks)) {
        if (track.name.toLowerCase().includes(q) || track.gameName.toLowerCase().includes(q)) {
            matches.push(track);
            if (matches.length >= 60) break;
        }
    }

    if (matches.length === 0) {
        searchResults.innerHTML = `<li class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">search_off</span><strong>Sin resultados</strong><span>No encontramos nada para «${esc(e.target.value.trim())}».</span></li>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    matches.forEach(track => fragment.appendChild(createTrackRow(track, () => {
        const game = libraryData[track.gameName];
        if (!game) return;
        openGameView(game);
        currentPlaylist = [...game.tracks];
        const i = currentPlaylist.findIndex(t => t.path === track.path);
        playTrack(i < 0 ? 0 : i);
    })));
    searchResults.replaceChildren(fragment);
    updateNowPlayingUI();
}, 250));

// =====================================================================
//  FILA DE PISTA REUTILIZABLE
// =====================================================================
function createTrackRow(track, onPlay, index = null) {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.dataset.path = track.path;
    li.tabIndex = 0;
    li.setAttribute('aria-label', `Reproducir ${track.name}`);

    const coverStyle = track.coverUrl
        ? `background-image: url('${esc(track.coverUrl)}');`
        : 'background-color: var(--accent-red);';

    li.innerHTML = `
        ${index !== null ? `<span class="track-index" aria-hidden="true">${index + 1}</span>` : ''}
        <div class="mini-art" style="${coverStyle}"></div>
        <div class="track-text">
            <p class="song-title">${esc(track.name)}</p>
            <p class="song-game">${esc(track.gameName)}</p>
        </div>
        <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
        ${favButtonHTML(track)}`;

    li.querySelector('.fav-btn')?.addEventListener('click', (ev) => toggleFavorite(track.path, ev));
    li.addEventListener('click', (ev) => {
        if (ev.target.closest('.fav-btn')) return;
        onPlay();
    });
    li.addEventListener('keydown', (ev) => {
        if (ev.target.closest('.fav-btn')) return;
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPlay(); }
    });
    return li;
}

function updateNowPlayingUI() {
    const current = currentPlaylist[currentTrackIndex];
    document.querySelectorAll('#game-track-list .track-item, #search-results .track-item').forEach(li => {
        const isCurrent = !!current && li.dataset.path === current.path;
        li.classList.toggle('is-playing', isCurrent);
        if (isCurrent) li.setAttribute('aria-current', 'true');
        else li.removeAttribute('aria-current');
        li.querySelector('.eq')?.classList.toggle('is-paused', !isPlaying);
    });
}

// =====================================================================
//  VISTA DE JUEGO / PLAYLIST
// =====================================================================

// Lotes de pintado. Con listas enormes, dibujar todas las filas de golpe
// congela la ventana durante segundos.
const PISTAS_LOTE = 150;
let tokenPintadoPistas = 0;

function pintarPistas(listEl, game) {
    const tracks = game.tracks;
    const token = ++tokenPintadoPistas;

    // Caso normal (lista corta): se dibuja entero, como siempre.
    if (tracks.length <= PISTAS_LOTE) {
        const fragment = document.createDocumentFragment();
        tracks.forEach((track, index) => {
            const idx = index;
            fragment.appendChild(createTrackRow(track, () => {
                currentPlaylist = [...game.tracks];
                playTrack(idx);
            }, idx));
        });
        listEl.appendChild(fragment);
        return;
    }

    // Lista larga: por tandas, cediendo el hilo entre cada una.
    const aviso = document.createElement('li');
    aviso.className = 'track-list-loading';
    aviso.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">hourglass_top</span> Cargando más canciones...';
    listEl.appendChild(aviso);

    let i = 0;
    const tanda = () => {
        // Si el usuario abrio otra vista mientras tanto, se abandona.
        if (token !== tokenPintadoPistas || !listEl.isConnected) return;

        const fin = Math.min(i + PISTAS_LOTE, tracks.length);
        const fragment = document.createDocumentFragment();
        for (; i < fin; i++) {
            const idx = i;
            fragment.appendChild(createTrackRow(tracks[i], () => {
                currentPlaylist = [...game.tracks];
                playTrack(idx);
            }, idx));
        }
        listEl.insertBefore(fragment, aviso);

        if (i < tracks.length) {
            requestAnimationFrame(tanda);
        } else {
            aviso.remove();
        }
    };
    requestAnimationFrame(tanda);
}
function openGameView(game, isCustomPlaylist = false) {
    currentGameView = game;
    switchView('view-game');

    const titleEl = document.getElementById('game-view-title');
    const composerEl = document.getElementById('game-view-composer');
    const statsEl = document.getElementById('game-view-stats');
    const coverEl = document.getElementById('game-view-cover');

    if (titleEl) titleEl.textContent = game.title;
    if (statsEl) statsEl.textContent = `${game.tracks.length} ${game.tracks.length === 1 ? 'tema' : 'temas'}`;
    if (composerEl) composerEl.textContent = game.composerInfo || '';
    if (coverEl) {
        if (game.coverUrl) {
            coverEl.style.backgroundImage = `url('${game.coverUrl}')`;
            coverEl.style.backgroundColor = '';
        } else {
            coverEl.style.backgroundImage = 'none';
            coverEl.style.backgroundColor = 'var(--accent-red)';
        }
    }

    const settingsBtn = document.getElementById('btn-playlist-settings');
    currentEditingPlaylist = isCustomPlaylist ? game.title : null;
    setHidden(settingsBtn, !isCustomPlaylist);

    const listEl = document.getElementById('game-track-list');
    if (listEl) {
        listEl.replaceChildren();
        if (game.tracks.length === 0) {
            listEl.innerHTML = `<li class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">queue_music</span><strong>Esta lista está vacía</strong><span>Añadí canciones desde el reproductor.</span></li>`;
        } else {
            pintarPistas(listEl, game);
        }
    }

    const playAllBtn = document.getElementById('btn-play-all');
    const shuffleAllBtn = document.getElementById('btn-shuffle-all');
    if (playAllBtn) {
        playAllBtn.onclick = () => {
            if (game.tracks.length === 0) return;
            currentPlaylist = [...game.tracks];
            playTrack(0);
        };
    }
    if (shuffleAllBtn) {
        shuffleAllBtn.onclick = () => {
            if (game.tracks.length === 0) return;
            currentPlaylist = [...game.tracks].sort(() => Math.random() - 0.5);
            playTrack(0);
        };
    }

    updateNowPlayingUI();
}

// =====================================================================
//  MOTOR DE REPRODUCCIÓN
// =====================================================================
function playTrack(index) {
    if (currentPlaylist.length === 0) return;

    const track = currentPlaylist[index];
    if (!track) return;

    currentTrackIndex = index;

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(track.file);
    audioPlayer.src = currentObjectUrl;
    audioPlayer.play().catch(() => { /* el navegador bloqueó el autoplay: el usuario va a pulsar play */ });

    initVisualizer();
    isPlaying = true;
    vinylAnim?.play();

    setText('mini-title', track.name);
    setText('full-title', track.name);
    setText('mini-game', track.gameName);
    setText('full-game', track.gameName);
    setText('full-composer', track.composerInfo ? `Compositor: ${track.composerInfo}` : '');

    const bg = track.coverUrl ? `url('${track.coverUrl}')` : 'none';
    ['full-art', 'mini-art-cover', 'vinyl-label'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.backgroundImage = bg;
    });

    // Reset síncrono: el color real llega tras leer la portada (evita destellos del tema anterior)
    if (miniPlayerEl) miniPlayerEl.style.background = 'var(--surface-light)';

    const bgContainer = document.getElementById('background-video-container');
    let hasBg = false;
    if (bgContainer) {
        if (track.customBackground) {
            hasBg = true;
            if (track.customBackground.isVideo) {
                bgContainer.innerHTML = `<video src="${esc(track.customBackground.url)}" autoplay loop muted playsinline></video>`;
            } else {
                bgContainer.innerHTML = `<img src="${esc(track.customBackground.url)}" alt="">`;
            }
        } else {
            bgContainer.replaceChildren();
        }
    }

    applyTrackColors(track, hasBg);

    if (miniPlayerEl) miniPlayerEl.classList.remove('hidden');
    setIsPlaying(true);
    updateNowPlayingUI();

    if (recentlyPlayedPaths[0] !== track.path) {
        recentlyPlayedPaths = [track.path, ...recentlyPlayedPaths.filter(p => p !== track.path)].slice(0, 50);
        try {
            localStorage.setItem('playMusicRecent', JSON.stringify(recentlyPlayedPaths));
        } catch (err) {
            console.warn('No se pudo guardar el historial:', err);
        }
        renderRecent();
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function togglePlay() {
    if (!audioPlayer.src) {
        toast('Elegí una canción para reproducir.', 'info');
        return;
    }
    if (isPlaying) {
        audioPlayer.pause();
    } else {
        audioPlayer.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
}

function setIsPlaying(value) {
    if (isPlaying === value) return;
    isPlaying = value;
    updatePlayPauseIcons();
}

function updatePlayPauseIcons() {
    const icon = isPlaying ? 'pause' : 'play_arrow';
    playPauseBtns.forEach(btn => {
        const span = btn?.querySelector('span');
        if (span) span.textContent = icon;
        btn?.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    });

    if (isPlaying) vinylAnim?.play();
    else vinylAnim?.pause();

    const vinyl = document.getElementById('vinyl-record');
    if (vinyl) vinyl.classList.toggle('is-playing', isPlaying);

    updateNowPlayingUI();
}

function playNext() {
    if (currentPlaylist.length === 0) return;
    if (repeatMode === 2) {
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(() => {});
        return;
    }
    if (isShuffle) {
        let r = Math.floor(Math.random() * currentPlaylist.length);
        if (currentPlaylist.length > 1 && r === currentTrackIndex) r = (r + 1) % currentPlaylist.length;
        playTrack(r);
        return;
    }
    if (currentTrackIndex < currentPlaylist.length - 1) {
        playTrack(currentTrackIndex + 1);
    } else if (repeatMode === 1) {
        playTrack(0);
    } else {
        setIsPlaying(false);
    }
}

function playPrev() {
    if (currentPlaylist.length === 0) return;
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        return;
    }
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
    else if (repeatMode === 1) playTrack(currentPlaylist.length - 1);
    else audioPlayer.currentTime = 0;
}

// =====================================================================
//  CONTROLES
// =====================================================================
audioPlayer.addEventListener('ended', playNext);
// El elemento multimedia es la fuente de verdad: refleja cambios externos
// (controles del sistema, atajos) sin pelearse con los cambios de pista.
audioPlayer.addEventListener('play', () => setIsPlaying(true));
audioPlayer.addEventListener('pause', () => setIsPlaying(!audioPlayer.paused));

playPauseBtns.forEach(btn => btn?.addEventListener('click', e => { e.stopPropagation(); togglePlay(); }));
btnNext?.addEventListener('click', playNext);
miniNext?.addEventListener('click', e => { e.stopPropagation(); playNext(); });
btnPrev?.addEventListener('click', playPrev);

btnShuffle?.addEventListener('click', () => {
    isShuffle = !isShuffle;
    btnShuffle.classList.toggle('is-active', isShuffle);
    btnShuffle.setAttribute('aria-pressed', String(isShuffle));
    toast(isShuffle ? 'Aleatorio activado' : 'Aleatorio desactivado', 'info', 1600);
});

function cycleRepeatMode(e) {
    e?.stopPropagation();
    repeatMode = (repeatMode + 1) % 3;
    updateRepeatUI();
}

const REPEAT_LABELS = ['Repetición desactivada', 'Repetir toda la lista', 'Repetir la canción'];

function updateRepeatUI() {
    const icon = repeatMode === 2 ? 'repeat_one' : 'repeat';
    const active = repeatMode !== 0;

    [btnRepeat, miniRepeat].forEach(btn => {
        if (!btn) return;
        const span = btn.querySelector('span');
        if (span) span.textContent = icon;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-label', REPEAT_LABELS[repeatMode]);
    });
}
btnRepeat?.addEventListener('click', cycleRepeatMode);
miniRepeat?.addEventListener('click', cycleRepeatMode);

audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    const p = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    if (progressBar) {
        if (document.activeElement !== progressBar) progressBar.value = p;
        paintSlider(progressBar, p);
    }
    setText('current-time', formatTime(audioPlayer.currentTime));
    setText('total-time', formatTime(audioPlayer.duration));
});

progressBar?.addEventListener('input', (e) => {
    if (!audioPlayer.duration) return;
    paintSlider(progressBar, e.target.value);
    audioPlayer.currentTime = (Number(e.target.value) / 100) * audioPlayer.duration;
});

function formatTime(s) {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

document.getElementById('btn-close-mini-player')?.addEventListener('click', e => {
    e.stopPropagation();
    audioPlayer.pause();
    setIsPlaying(false);
    vinylAnim?.pause();
    miniPlayerEl?.classList.add('hidden');
    fullPlayerEl?.classList.add('hidden');
});

// Compartir la canción actual
document.getElementById('btn-share')?.addEventListener('click', async () => {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) {
        toast('No hay ninguna canción reproduciéndose.', 'info');
        return;
    }
    const shareData = { title: track.name, text: `${track.name} — ${track.gameName}` };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(`${shareData.title} — ${shareData.text}`);
            toast('Título copiado al portapapeles.', 'success');
        }
    } catch (err) {
        if (err?.name !== 'AbortError') toast('No se pudo compartir.', 'error');
    }
});

// =====================================================================
//  PLAYLISTAS PERSONALIZADAS
// =====================================================================
function createPlaylistCard(listName) {
    const card = document.createElement('div');
    card.className = 'card bouncy';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir la playlist ${listName}`);
    const customCover = playlistCovers[listName];

    if (customCover) {
        card.innerHTML = `<div class="card-img-placeholder" style="background-image: url('${esc(customCover)}');"></div><p class="card-title">${esc(listName)}</p>`;
    } else {
        card.innerHTML = `<div class="card-img-placeholder is-accent"><span class="material-symbols-rounded card-art-icon" aria-hidden="true">queue_music</span></div><p class="card-title">${esc(listName)}</p>`;
    }

    const open = () => {
        const pl = customPlaylists[listName].map(path => globalAllTracks[path]).filter(Boolean);
        if (pl.length === 0) {
            toast('Esta playlist está vacía.', 'info');
            return;
        }
        openGameView({ title: listName, tracks: pl, coverUrl: customCover || null }, true);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return card;
}

function renderPlaylistsUI() {
    if (!playlistsContainer) return;
    const names = Object.keys(customPlaylists);
    if (names.length === 0) {
        playlistsContainer.innerHTML = `<p class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">queue_music</span><strong>Sin playlists</strong><span>Creá una con el botón «Crear Lista».</span></p>`;
        return;
    }
    const fragment = document.createDocumentFragment();
    names.forEach(name => fragment.appendChild(createPlaylistCard(name)));
    playlistsContainer.replaceChildren(fragment);
}

function renderHomeCustomPlaylists() {
    const grid = document.getElementById('custom-playlists-grid');
    if (!grid) return;

    const names = Object.keys(customPlaylists);
    if (names.length === 0) {
        grid.innerHTML = `<p class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">queue_music</span><strong>Aún no tenés playlists</strong><span>Creá una desde «My Music».</span></p>`;
        return;
    }
    const fragment = document.createDocumentFragment();
    names.forEach(name => fragment.appendChild(createPlaylistCard(name)));
    grid.replaceChildren(fragment);
}

function savePlaylists() {
    try {
        localStorage.setItem('playMusicPlaylists', JSON.stringify(customPlaylists));
    } catch (err) {
        showModal('Error', 'No se pudo guardar la playlist: el almacenamiento del navegador está lleno.');
        return;
    }
    renderPlaylistsUI();
    renderHomeCustomPlaylists();
    updateSidebarPlaylists();
}

function savePlaylistCovers() {
    try {
        localStorage.setItem('playMusicPlaylistCovers', JSON.stringify(playlistCovers));
    } catch (err) {
        showModal('Error', 'No se pudo guardar la portada: el almacenamiento del navegador está lleno.');
    }
}

document.getElementById('btn-playlist-settings')?.addEventListener('click', () => {
    if (!currentEditingPlaylist) return;
    const titleEl = document.getElementById('settings-modal-title');
    if (titleEl) titleEl.textContent = `Ajustes: ${currentEditingPlaylist}`;
    openModalEl(document.getElementById('playlist-settings-modal'));
});
document.getElementById('close-settings-modal')?.addEventListener('click', () => closeModalEl(document.getElementById('playlist-settings-modal')));
document.getElementById('btn-edit-cover')?.addEventListener('click', () => {
    playlistToEditCover = currentEditingPlaylist;
    closeModalEl(document.getElementById('playlist-settings-modal'));
    playlistCoverInput?.click();
});
document.getElementById('btn-rename-playlist')?.addEventListener('click', () => {
    const oldName = currentEditingPlaylist;
    closeModalEl(document.getElementById('playlist-settings-modal'));
    showInputModal('Renombrar Playlist', oldName, (newName) => {
        newName = newName.trim();
        if (!newName || newName === oldName) return;
        if (customPlaylists[newName]) {
            showModal('Error', 'Ya existe una playlist con ese nombre.');
            return;
        }
        customPlaylists[newName] = customPlaylists[oldName];
        delete customPlaylists[oldName];
        if (playlistCovers[oldName]) {
            playlistCovers[newName] = playlistCovers[oldName];
            delete playlistCovers[oldName];
        }
        savePlaylists();
        savePlaylistCovers();

        const pl = customPlaylists[newName].map(path => globalAllTracks[path]).filter(Boolean);
        openGameView({ title: newName, tracks: pl, coverUrl: playlistCovers[newName] || null }, true);
        toast(`Playlist renombrada a «${newName}».`, 'success');
    });
});
document.getElementById('btn-delete-playlist')?.addEventListener('click', () => {
    const name = currentEditingPlaylist;
    closeModalEl(document.getElementById('playlist-settings-modal'));
    showConfirmModal(`¿Eliminar «${name}»?`, 'No perderás tus canciones, solo la lista.', () => {
        delete customPlaylists[name];
        delete playlistCovers[name];
        savePlaylists();
        savePlaylistCovers();
        toast(`Playlist «${name}» eliminada.`, 'success');
        switchView('view-home');
        setActiveNav('view-home');
    });
});

playlistCoverInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !playlistToEditCover) {
        e.target.value = '';
        return;
    }
    const reader = new FileReader();

    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const MAX_SIZE = 300;
            let width = img.width;
            let height = img.height;
            if (width > height) {
                if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
            } else if (height > MAX_SIZE) {
                width *= MAX_SIZE / height;
                height = MAX_SIZE;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const resizedBase64 = canvas.toDataURL('image/jpeg', 0.8);

            playlistCovers[playlistToEditCover] = resizedBase64;
            savePlaylistCovers();
            renderPlaylistsUI();
            renderHomeCustomPlaylists();

            if (currentGameView && currentGameView.title === playlistToEditCover) {
                const coverEl = document.getElementById('game-view-cover');
                if (coverEl) coverEl.style.backgroundImage = `url('${resizedBase64}')`;
                currentGameView.coverUrl = resizedBase64;
            }
            playlistCoverInput.value = '';
        };
        img.onerror = () => {
            showModal('Error', 'No se pudo leer la imagen seleccionada.');
            playlistCoverInput.value = '';
        };
        img.src = ev.target.result;
    };
    reader.onerror = () => {
        showModal('Error', 'No se pudo leer el archivo.');
        playlistCoverInput.value = '';
    };
    reader.readAsDataURL(file);
});

document.getElementById('create-playlist-btn')?.addEventListener('click', () => {
    showInputModal('Nueva Playlist', 'Nombre de la playlist', (name) => {
        name = name.trim();
        if (!name) return;
        if (customPlaylists[name]) {
            showModal('Error', 'La playlist ya existe.');
            return;
        }
        customPlaylists[name] = [];
        savePlaylists();
        toast(`Playlist «${name}» creada.`, 'success');
    });
});

document.getElementById('btn-add-to-playlist')?.addEventListener('click', () => {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) return;
    trackPendingToAdd = track;

    const listUI = document.getElementById('modal-playlist-list');
    if (!listUI) return;

    const names = Object.keys(customPlaylists);
    if (names.length === 0) {
        listUI.innerHTML = `<li class="empty-state"><span class="material-symbols-rounded" aria-hidden="true">playlist_add</span><strong>No tenés playlists</strong><span>Creá una desde «My Music».</span></li>`;
    } else {
        const fragment = document.createDocumentFragment();
        names.forEach(listName => {
            const li = document.createElement('li');
            li.className = 'track-item bouncy';
            li.tabIndex = 0;
            li.setAttribute('role', 'button');
            li.setAttribute('aria-label', `Añadir a ${listName}`);
            const inList = customPlaylists[listName].includes(trackPendingToAdd.path);
            li.innerHTML = `<div class="track-text"><p class="song-title">${esc(listName)}</p>${inList ? '<p class="song-game">Ya incluida</p>' : ''}</div>`;

            const add = () => {
                if (customPlaylists[listName].includes(trackPendingToAdd.path)) {
                    toast('La canción ya está en esta lista.', 'info');
                } else {
                    customPlaylists[listName].push(trackPendingToAdd.path);
                    savePlaylists();
                    toast(`Añadido a «${listName}».`, 'success');
                }
                closeModalEl(document.getElementById('playlist-modal'));
            };
            li.addEventListener('click', add);
            li.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); add(); }
            });
            fragment.appendChild(li);
        });
        listUI.replaceChildren(fragment);
    }

    openModalEl(document.getElementById('playlist-modal'));
});

document.getElementById('export-btn')?.addEventListener('click', () => {
    const payload = JSON.stringify({ lists: customPlaylists, covers: playlistCovers });
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'play_music_playlists.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Playlists exportadas.', 'success');
});

document.getElementById('import-upload')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.lists) {
                customPlaylists = { ...customPlaylists, ...data.lists };
                playlistCovers = { ...playlistCovers, ...(data.covers || {}) };
            } else {
                customPlaylists = { ...customPlaylists, ...data };
            }
            savePlaylists();
            savePlaylistCovers();
            toast('Playlists importadas.', 'success');
        } catch (err) {
            showModal('Error', 'El archivo no tiene un formato válido.');
        }
    };
    reader.onerror = () => showModal('Error', 'No se pudo leer el archivo.');
    reader.readAsText(file);
    e.target.value = '';
});

// =====================================================================
//  NAVEGACIÓN
// =====================================================================
function setActiveNav(targetId) {
    navItems.forEach(item => {
        const isTarget = item.dataset.target === targetId;
        item.classList.toggle('active', isTarget);
        if (isTarget) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
    });
}

function switchView(targetId) {
    // Validar antes de tocar nada: un target inválido dejaba la pantalla en blanco
    const targetView = targetId ? document.getElementById(targetId) : null;
    if (!targetView) return;

    views.forEach(v => v.classList.remove('active'));
    targetView.classList.add('active');
    setActiveNav(targetId);

    // Cada vista arranca arriba del todo
    if (appContent) appContent.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'auto' });
    scheduleArrowUpdate();
}

navItems.forEach(item => item.addEventListener('click', () => switchView(item.dataset.target)));

const openFullPlayer = () => fullPlayerEl?.classList.remove('hidden');
document.getElementById('open-full-player')?.addEventListener('click', openFullPlayer);
document.getElementById('open-full-player')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFullPlayer(); }
});
document.getElementById('close-full-player')?.addEventListener('click', () => fullPlayerEl?.classList.add('hidden'));
document.getElementById('btn-show-playlist-player')?.addEventListener('click', () => {
    fullPlayerEl?.classList.add('hidden');
    if (currentGameView) switchView('view-game');
});
document.getElementById('btn-back-home')?.addEventListener('click', () => switchView('view-home'));

// =====================================================================
//  VISUALIZADOR (Web Audio API)
// =====================================================================
let audioCtx = null;
let analyser = null;
let source = null;
let freqData = null;
let visualizerStarted = false;

const canvasFull = document.getElementById('visualizer');
const canvasFullCtx = canvasFull ? canvasFull.getContext('2d') : null;
const canvasMini = document.getElementById('mini-visualizer');
const canvasMiniCtx = canvasMini ? canvasMini.getContext('2d') : null;

function initVisualizer() {
    if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;

        audioCtx = new AudioCtxClass();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;

        source = audioCtx.createMediaElementSource(audioPlayer);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);

        freqData = new Uint8Array(analyser.frequencyBinCount);
        startVisualizerLoop();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startVisualizerLoop() {
    if (visualizerStarted) return;
    visualizerStarted = true;

    const loop = () => {
        requestAnimationFrame(loop);

        if (!analyser || freqData === null) return;
        const showFull = isElementVisible(canvasFull);
        const showMini = isElementVisible(canvasMini);
        if (!showFull && !showMini) return;
        if (audioPlayer.paused) return;

        analyser.getByteFrequencyData(freqData); // una sola lectura por frame
        if (showFull) drawBars(canvasFull, canvasFullCtx, 0.92);
        if (showMini) drawBars(canvasMini, canvasMiniCtx, 0.75);
    };
    loop();
}

function drawBars(canvas, ctx, gain) {
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    // Solo se reasigna el tamaño cuando realmente cambia (evita realocar el buffer)
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const barCount = Math.max(16, Math.min(96, Math.floor(cssW / 6)));
    const binStep = freqData.length / barCount;
    const gap = 2;
    const barW = Math.max(2, cssW / barCount - gap);

    for (let i = 0; i < barCount; i++) {
        const start = Math.floor(i * binStep);
        const end = Math.max(start + 1, Math.floor((i + 1) * binStep));

        let sum = 0;
        for (let j = start; j < end && j < freqData.length; j++) sum += freqData[j];
        const level = (sum / (end - start)) / 255;

        const barH = Math.max(2, level * cssH * gain);
        const x = i * (barW + gap);
        ctx.fillStyle = `rgba(${currentDerivedColor}, ${(0.22 + level * 0.5).toFixed(3)})`;
        ctx.fillRect(x, cssH - barH, barW, barH);
    }
}

// =====================================================================
//  VISTA LISTA/GRILLA Y BÚSQUEDA LOCAL
// =====================================================================
function setupViewToggle(btnId, iconId, gridId) {
    const btn = document.getElementById(btnId);
    const grid = document.getElementById(gridId);
    const icon = document.getElementById(iconId);
    if (!btn || !grid) return;

    let listMode = false;
    btn.addEventListener('click', () => {
        listMode = !listMode;
        grid.classList.toggle('list-view-mode', listMode);
        if (icon) icon.textContent = listMode ? 'grid_view' : 'view_list';
        btn.setAttribute('aria-label', listMode ? 'Ver en grilla' : 'Ver en lista');
    });
}

function setupLocalSearch(inputId, gridId) {
    const input = document.getElementById(inputId);
    const grid = document.getElementById(gridId);
    if (!input || !grid) return;

    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.setAttribute('data-search-empty', '');
    empty.hidden = true;
    empty.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">search_off</span><strong>Sin coincidencias</strong><span>Probá con otro término.</span>';
    grid.appendChild(empty);

    input.addEventListener('input', debounce(() => {
        const term = input.value.trim().toLowerCase();
        const cards = grid.querySelectorAll('.card');
        let visible = 0;
        cards.forEach(card => {
            const titleEl = card.querySelector('.card-title');
            const match = !term || !titleEl || titleEl.textContent.toLowerCase().includes(term);
            card.classList.toggle('is-filtered-out', !match);
            if (match) visible++;
        });
        // Solo tiene sentido mostrarlo si la grilla realmente tiene contenido
        empty.hidden = !(cards.length > 0 && term !== '' && visible === 0);
    }, 150));
}

setupViewToggle('btn-toggle-view', 'icon-toggle-view', 'all-games-grid');
setupLocalSearch('search-all-games', 'all-games-grid');
setupViewToggle('btn-toggle-recent-view', 'icon-toggle-recent-view', 'all-recent-grid');
setupLocalSearch('search-recent', 'all-recent-grid');

// Revisa si algún juego reciente ya pasó de los 10 minutos
setInterval(() => {
    if (recentlyAddedGames.length > 0) renderRecentlyAdded();
}, 60000);

// =====================================================================
//  DROPDOWN DE TEMAS
// =====================================================================
const themeTrigger = document.getElementById('theme-trigger');
const themeMenu = document.getElementById('theme-menu');
const themeItems = document.querySelectorAll('.dropdown-item');
const selectedIconContainer = document.getElementById('selected-icon-container');

const THEME_BG = { dark: '#000000', light: '#ffffff', gamecube: '#2b2b5c', sheikah: '#061722', metroid: '#070d14', bayonetta: '#0a0203' };

function applyTheme(theme, { persist = true } = {}) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
        try { localStorage.setItem('app-theme', theme); } catch (err) { /* cuota llena */ }
    }

    themeItems.forEach(item => {
        const isActive = item.dataset.value === theme;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-checked', String(isActive));
        if (isActive && selectedIconContainer) {
            selectedIconContainer.innerHTML = item.querySelector('.icon-wrapper').innerHTML;
        }
    });

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta && THEME_BG[theme]) {
        themeColorMeta.setAttribute('content', THEME_BG[theme]);
    }
}

function setThemeMenu(open) {
    if (!themeMenu || !themeTrigger) return;
    themeMenu.classList.toggle('open', open);
    themeTrigger.setAttribute('aria-expanded', String(open));
}

if (themeTrigger && themeMenu && themeItems.length && selectedIconContainer) {
    applyTheme(localStorage.getItem('app-theme') || 'dark', { persist: false });

    themeTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        setThemeMenu(!themeMenu.classList.contains('open'));
    });

    document.addEventListener('click', (e) => {
        if (!themeMenu.classList.contains('open')) return;
        if (!themeTrigger.contains(e.target) && !themeMenu.contains(e.target)) setThemeMenu(false);
    });

    themeItems.forEach(item => {
        item.addEventListener('click', () => {
            applyTheme(item.dataset.value);
            setThemeMenu(false);
            themeTrigger.focus();
        });
    });
}
