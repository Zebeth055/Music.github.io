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
let ytPlayer = null; 

let currentSortOrder = 'alpha-asc'; // ESTADO GLOBAL PARA EL ORDEN

// Persistencia en LocalStorage
let customPlaylists = JSON.parse(localStorage.getItem('nintendoPlaylists')) || {};
let playlistCovers = JSON.parse(localStorage.getItem('nintendoPlaylistCovers')) || {};
let recentlyPlayedPaths = JSON.parse(localStorage.getItem('nintendoRecent')) || [];

// Playlists dinámicas de YouTube (Home)
const youtubePlaylists = [
    { title: "Nintendo Switch Music Selects", youtubeListId: "PLrL344CrHANP5UG2yt_f9eBn8RB75W5bw", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Nintendo_Switch_logo.svg/500px-Nintendo_Switch_logo.svg.png" },
    { title: "Zelda: Ocarina of Time OST", youtubeListId: "PLqSYV7fIfmTSioyTAcFe3ZbikHyhb2D-x", thumbnail: "https://upload.wikimedia.org/wikipedia/en/3/30/The_Legend_of_Zelda_Ocarina_of_Time_3D_box_art.png" },
    { title: "Super Mario Galaxy OST", youtubeListId: "PL821DF3D553F1E8B9", thumbnail: "https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch/70010000104187/7ccc1c07ba3995da1dbd7320e726e063eaba9445a5741281d19c3b8fb1c144df" },
    { title: "Donkey Kong Bananza", youtubeListId: "PL3Ydt8g2VQ4Hrag6mehy1t9P3p2im57as", thumbnail: "https://www.nintendo.com/eu/media/images/assets/nintendo_switch_2_games/donkey_kong_bananza/16x9_DonkeyKongBananza_image1600w.jpg" },
    { title: "F-Zero X OST", youtubeListId: "PL5123E919D2B619CC", thumbnail: "https://sm.ign.com/ign_es/cover/f/f-zero-x/f-zero-x_uyh9.jpg" }
];

// --- Elementos del DOM ---
const audioPlayer = new Audio();
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchSuggestions = document.getElementById('search-suggestions');
const exploreContainer = document.getElementById('explore-container');
const recentContainer = document.getElementById('recent-container');
const homeGamesContainer = document.getElementById('home-games-container');
const ytRecommendedContainer = document.getElementById('recommended-container');
const playlistsContainer = document.getElementById('playlists-container');
const playlistCoverInput = document.getElementById('playlist-cover-input');

// Controles Reproductor
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

// --- Inicialización de YouTube API ---
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('yt-player-container', {
        height: '100%', width: '100%',
        playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0, 'fs': 1 }
    });
}
document.getElementById('close-yt-modal').addEventListener('click', () => {
    document.getElementById('youtube-modal').classList.add('hidden');
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
});

// --- SISTEMA DE MODALES ---
function showModal(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = message;
    document.getElementById('custom-modal').classList.remove('hidden');
}
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('custom-modal').classList.add('hidden'));

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('playlist-modal').classList.add('hidden');
});

// Input Modal
let inputModalCallback = null;
function showInputModal(title, placeholder, callback) {
    document.getElementById('input-modal-title').textContent = title;
    const inputEl = document.getElementById('input-modal-value');
    inputEl.placeholder = placeholder;
    inputEl.value = '';
    inputModalCallback = callback;
    document.getElementById('input-modal').classList.remove('hidden');
    inputEl.focus();
}
document.getElementById('input-modal-cancel').addEventListener('click', () => document.getElementById('input-modal').classList.add('hidden'));
document.getElementById('input-modal-confirm').addEventListener('click', () => {
    const val = document.getElementById('input-modal-value').value.trim();
    if(val && inputModalCallback) inputModalCallback(val);
    document.getElementById('input-modal').classList.add('hidden');
});

// Confirm Modal
let confirmModalCallback = null;
function showConfirmModal(title, text, callback) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-text').textContent = text;
    confirmModalCallback = callback;
    document.getElementById('confirm-modal').classList.remove('hidden');
}
document.getElementById('confirm-modal-cancel').addEventListener('click', () => document.getElementById('confirm-modal').classList.add('hidden'));
document.getElementById('confirm-modal-accept').addEventListener('click', () => {
    if(confirmModalCallback) confirmModalCallback();
    document.getElementById('confirm-modal').classList.add('hidden');
});

// --- Scroll Horizontal ---
document.querySelectorAll('.scroll-arrow').forEach(arrow => {
    arrow.addEventListener('click', (e) => {
        const container = document.getElementById(e.currentTarget.getAttribute('data-target'));
        if (container) {
            const dir = e.currentTarget.classList.contains('left-arrow') ? -1 : 1;
            container.scrollBy({ left: (container.clientWidth * 0.8) * dir, behavior: 'smooth' });
        }
    });
});

volumeSlider.addEventListener('input', (e) => {
    audioPlayer.volume = e.target.value / 100;
    const p = e.target.value;
    volumeSlider.style.background = `linear-gradient(to right, #fff 0%, #fff ${p}%, #333 ${p}%, #333 100%)`;
});

// --- Base de Datos ---
const DB_NAME = 'NintendoMusicDB';
function openDB() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('files', { keyPath: 'path' });
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}
async function loadFilesFromDB() {
    const db = await openDB();
    const store = db.transaction('files', 'readonly').objectStore('files');
    const req = store.getAll();
    req.onsuccess = async () => {
        if(req.result.length > 0) {
            document.getElementById('db-status').textContent = `Música cargada (${req.result.length} archivos).`;
            document.getElementById('clear-db-btn').style.display = 'inline-flex';
            await processLibrary(req.result);
        }
    };
}
document.addEventListener('DOMContentLoaded', () => {
    loadFilesFromDB(); 
    renderPlaylistsUI(); 
    renderHomeCustomPlaylists(); 
    renderYoutubeHome(); 
    updateRepeatUI();
    volumeSlider.style.background = `linear-gradient(to right, #fff 0%, #fff 100%, #333 100%, #333 100%)`;
});

// Carga Progresiva
document.getElementById('audio-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if(files.length === 0) return;
    const statusEl = document.getElementById('db-status');
    statusEl.textContent = `Preparando ${files.length} archivos...`;
    const db = await openDB();
    const CHUNK_SIZE = 100; 
    let processedCount = 0;

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            chunk.forEach(f => store.put({ file: f, path: f.webkitRelativePath || f.name }));
            tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
        processedCount += chunk.length;
        statusEl.textContent = `Guardando... ${processedCount} / ${files.length} archivos`;
        await new Promise(r => setTimeout(r, 10)); 
    }
    statusEl.textContent = "¡Carga completada! Actualizando biblioteca...";
    loadFilesFromDB(); 
});
document.getElementById('clear-db-btn').addEventListener('click', async () => {
    const tx = (await openDB()).transaction('files', 'readwrite');
    tx.objectStore('files').clear();
    location.reload(); 
});

// --- Procesar Archivos Locales ---
async function processLibrary(dbData) {
    libraryData = {}; globalAllTracks = {};
    for (const item of dbData) {
        const parts = item.path.split('/');
        const game = parts.length > 1 ? parts[parts.length - 2] : "Otros";
        if (!libraryData[game]) libraryData[game] = { title: game, tracks: [], coverUrl: null, composerInfo: "" };
        if (item.file.name.match(/\.(jpe?g|png|webp)$/i)) {
            if(libraryData[game].coverUrl) URL.revokeObjectURL(libraryData[game].coverUrl);
            libraryData[game].coverUrl = URL.createObjectURL(item.file);
        } else if (item.file.name.match(/\.txt$/i)) {
            libraryData[game].composerInfo = await item.file.text();
        }
    }
    for (const item of dbData) {
        if (!item.file.type.startsWith('audio/')) continue;
        const parts = item.path.split('/');
        const game = parts.length > 1 ? parts[parts.length - 2] : "Otros";
        const trackObj = { path: item.path, name: item.file.name.replace(/\.[^/.]+$/, ""), gameName: game, file: item.file, coverUrl: libraryData[game].coverUrl, composerInfo: libraryData[game].composerInfo };
        libraryData[game].tracks.push(trackObj);
        globalAllTracks[item.path] = trackObj;
    }
    renderHomeCards(); renderRecent(); renderSearchSuggestions();
}

// Generador único de tarjetas de juego
function createGameCard(game) {
    const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
    const coverStyle = game.coverUrl ? `background-image: url('${game.coverUrl}');` : `background: var(--nintendo-red); display:flex; align-items:center; justify-content:center; text-align:center; font-weight:bold; font-size:12px;`;
    card.innerHTML = `<div class="card-img-placeholder" style="${coverStyle}">${game.coverUrl ? '' : game.title}</div><p class="card-title">${game.title}</p>`;
    card.addEventListener('click', () => openGameView(game));
    return card;
}

// SISTEMA DE ORDENAMIENTO
function renderHomeCards() {
    if (homeGamesContainer) homeGamesContainer.innerHTML = '';
    const allGamesGrid = document.getElementById('all-games-grid');
    if (allGamesGrid) allGamesGrid.innerHTML = '';

    let gamesArray = Object.values(libraryData).filter(g => g.tracks.length > 0);
    
    if (currentSortOrder === 'alpha-asc') {
        gamesArray.sort((a, b) => a.title.localeCompare(b.title));
    } else if (currentSortOrder === 'alpha-desc') {
        gamesArray.sort((a, b) => b.title.localeCompare(a.title));
    } else if (currentSortOrder === 'songs-desc') {
        gamesArray.sort((a, b) => b.tracks.length - a.tracks.length);
    } else if (currentSortOrder === 'songs-asc') {
        gamesArray.sort((a, b) => a.tracks.length - b.tracks.length);
    }

    gamesArray.forEach(game => {
        if (homeGamesContainer) homeGamesContainer.appendChild(createGameCard(game));
        if (allGamesGrid) allGamesGrid.appendChild(createGameCard(game));
    });
}

// Controladores para los menús desplegables
const sortHome = document.getElementById('sort-home');
const sortAll = document.getElementById('sort-all');

function handleSortChange(e) {
    currentSortOrder = e.target.value;
    // Sincroniza ambos menús
    if (sortHome) sortHome.value = currentSortOrder;
    if (sortAll) sortAll.value = currentSortOrder;
    renderHomeCards();
}

sortHome?.addEventListener('change', handleSortChange);
sortAll?.addEventListener('change', handleSortChange);

// Generador único de canciones/recientes
function createRecentCard(track) {
    const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
    const coverStyle = track.coverUrl ? `background-image: url('${track.coverUrl}');` : `background: var(--surface-light);`;
    card.innerHTML = `<div class="card-img-placeholder" style="${coverStyle}"></div><p class="card-title">${track.name}</p>`;
    card.addEventListener('click', () => {
        const game = libraryData[track.gameName];
        if(game) { openGameView(game); currentPlaylist = [...game.tracks]; playTrack(currentPlaylist.findIndex(t => t.path === track.path) || 0); }
    });
    return card;
}

function renderRecent() {
    if (recentContainer) recentContainer.innerHTML = '';
    const allRecentGrid = document.getElementById('all-recent-grid');
    if (allRecentGrid) allRecentGrid.innerHTML = '';

    if (recentlyPlayedPaths.length === 0) {
        if (allRecentGrid) allRecentGrid.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px; grid-column: 1/-1;">No tienes temas escuchados recientemente.</p>';
        if (recentContainer) recentContainer.innerHTML = '<p style="color: var(--text-muted); padding: 10px;">Vacío</p>';
        return;
    }

    recentlyPlayedPaths.forEach(path => {
        const track = globalAllTracks[path];
        if(!track) return;
        if (recentContainer) recentContainer.appendChild(createRecentCard(track));
        if (allRecentGrid) allRecentGrid.appendChild(createRecentCard(track));
    });
}

// Controlador para botón Vaciar Recientes
document.getElementById('btn-clear-recent')?.addEventListener('click', () => {
    showConfirmModal("¿Vaciar historial?", "¿Estás seguro de que quieres borrar tu lista de temas recientes?", () => {
        recentlyPlayedPaths = [];
        localStorage.setItem('nintendoRecent', JSON.stringify(recentlyPlayedPaths));
        renderRecent();
        showModal("Éxito", "Historial de reproducción vaciado correctamente.");
    });
});

// Controladores de navegación para las páginas extra
document.getElementById('btn-see-all-games')?.addEventListener('click', () => switchView('view-all-games'));
document.getElementById('btn-see-all-recent')?.addEventListener('click', () => switchView('view-all-recent'));
document.getElementById('btn-back-from-games')?.addEventListener('click', () => switchView('view-home'));
document.getElementById('btn-back-from-recent')?.addEventListener('click', () => switchView('view-home'));


function renderYoutubeHome() {
    ytRecommendedContainer.innerHTML = '';
    youtubePlaylists.forEach(list => {
        const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
        card.innerHTML = `<div class="card-img-placeholder" style="background-image: url('${list.thumbnail}');"></div><p class="card-title">${list.title}</p>`;
        card.addEventListener('click', () => {
            if (isPlaying) togglePlay(); 
            document.getElementById('yt-modal-title').textContent = list.title;
            document.getElementById('youtube-modal').classList.remove('hidden');
            if (ytPlayer && ytPlayer.loadPlaylist) ytPlayer.loadPlaylist({ listType: 'playlist', list: list.youtubeListId });
        });
        ytRecommendedContainer.appendChild(card);
    });
}

function renderSearchSuggestions() {
    exploreContainer.innerHTML = '';
    const games = Object.values(libraryData).filter(g => g.tracks.length > 0).sort(() => 0.5 - Math.random()).slice(0, 10);
    games.forEach(game => {
        const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
        const coverStyle = game.coverUrl ? `background-image: url('${game.coverUrl}');` : `background: var(--nintendo-red);`;
        card.innerHTML = `<div class="card-img-placeholder" style="${coverStyle}"></div><p class="card-title">${game.title}</p>`;
        card.addEventListener('click', () => { searchInput.value = ''; searchSuggestions.style.display = 'block'; searchResults.style.display = 'none'; openGameView(game); });
        exploreContainer.appendChild(card);
    });
}
searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if(q.trim() === '') { searchSuggestions.style.display = 'block'; searchResults.style.display = 'none'; return; }
    searchSuggestions.style.display = 'none'; searchResults.style.display = 'block';
    Object.values(globalAllTracks).filter(t => t.name.toLowerCase().includes(q) || t.gameName.toLowerCase().includes(q)).forEach(track => {
        const li = document.createElement('li'); li.className = 'track-item nintendo-bouncy';
        li.innerHTML = `<div class="mini-art" style="${track.coverUrl ? `background-image: url('${track.coverUrl}');` : ''}"></div><div><p class="song-title">${track.name}</p><p class="song-game">${track.gameName}</p></div>`;
        li.addEventListener('click', () => {
            const game = libraryData[track.gameName];
            if(game) { openGameView(game); currentPlaylist = [...game.tracks]; playTrack(currentPlaylist.findIndex(t => t.path === track.path) || 0); }
        });
        searchResults.appendChild(li);
    });
});

// --- Vista de Juego / Playlist ---
function openGameView(game, isCustomPlaylist = false) {
    currentGameView = game; switchView('view-game');
    navItems.forEach(nav => nav.classList.remove('active'));
    document.getElementById('game-view-title').textContent = game.title;
    document.getElementById('game-view-stats').textContent = `${game.tracks.length} temas`;
    const coverEl = document.getElementById('game-view-cover');
    if (game.coverUrl) coverEl.style.backgroundImage = `url('${game.coverUrl}')`;
    else { coverEl.style.backgroundImage = 'none'; coverEl.style.backgroundColor = 'var(--nintendo-red)'; }

    const settingsBtn = document.getElementById('btn-playlist-settings');
    if (settingsBtn) {
        if (isCustomPlaylist) {
            settingsBtn.style.display = 'block';
            currentEditingPlaylist = game.title;
        } else {
            settingsBtn.style.display = 'none';
            currentEditingPlaylist = null;
        }
    }

    const listEl = document.getElementById('game-track-list'); listEl.innerHTML = '';
    if (game.tracks.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Esta playlist está vacía.</p>';
    } else {
        game.tracks.forEach((track, index) => {
            const li = document.createElement('li'); li.className = 'track-item';
            li.innerHTML = `<div class="mini-art" style="${track.coverUrl ? `background-image: url('${track.coverUrl}');` : 'background:var(--nintendo-red);'}"></div><div style="flex-grow: 1;"><p class="song-title">${track.name}</p></div>`;
            li.addEventListener('click', () => { currentPlaylist = [...game.tracks]; playTrack(index); });
            listEl.appendChild(li);
        });
    }

    document.getElementById('btn-play-all').onclick = () => { if(game.tracks.length>0) { currentPlaylist = [...game.tracks]; playTrack(0); } };
    document.getElementById('btn-shuffle-all').onclick = () => { if(game.tracks.length>0) { currentPlaylist = [...game.tracks].sort(() => Math.random() - 0.5); playTrack(0); } };
}

// --- Motor de Reproducción Local ---
function playTrack(index) {
    if (currentPlaylist.length === 0) return;
    if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    currentTrackIndex = index;
    const track = currentPlaylist[index];
    if(!track) return;

    audioPlayer.src = URL.createObjectURL(track.file); 
    audioPlayer.play(); 
    initVisualizer();
    isPlaying = true;

    document.getElementById('mini-title').textContent = track.name; 
    document.getElementById('full-title').textContent = track.name;
    document.getElementById('mini-game').textContent = track.gameName; 
    document.getElementById('full-game').textContent = track.gameName;
    document.getElementById('full-composer').textContent = track.composerInfo ? `Compositor: ${track.composerInfo}` : '';

    const bg = track.coverUrl ? `url('${track.coverUrl}')` : 'none';
    document.getElementById('full-art').style.backgroundImage = bg; 
    document.getElementById('mini-art-cover').style.backgroundImage = bg;
    
    document.getElementById('full-player').style.background = `linear-gradient(to bottom, #2a2a35, #000000)`;
    if (track.coverUrl) {
        const img = new Image(); img.src = track.coverUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
            try {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let r=0,g=0,b=0;
                for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
                const c = data.length/4; document.getElementById('full-player').style.background = `linear-gradient(to bottom, rgb(${Math.floor(r/c)},${Math.floor(g/c)},${Math.floor(b/c)}), #000000)`;
            } catch (e) {}
        };
    }
    document.getElementById('mini-player').classList.remove('hidden'); 
    updatePlayPauseIcons();

    recentlyPlayedPaths = [track.path, ...recentlyPlayedPaths.filter(p => p !== track.path)].slice(0, 10);
    localStorage.setItem('nintendoRecent', JSON.stringify(recentlyPlayedPaths)); 
    renderRecent();
}

function togglePlay() { 
    if(!audioPlayer.src) return; 
    isPlaying ? audioPlayer.pause() : audioPlayer.play(); 
    isPlaying = !isPlaying; 
    updatePlayPauseIcons(); 
}
function updatePlayPauseIcons() { playPauseBtns.forEach(btn => btn.querySelector('span').textContent = isPlaying ? 'pause' : 'play_arrow'); }
function playNext() {
    if (currentPlaylist.length === 0) return;
    if (repeatMode === 2) { audioPlayer.currentTime = 0; audioPlayer.play(); return; } 
    if (isShuffle) { let r = Math.floor(Math.random() * currentPlaylist.length); if(currentPlaylist.length>1 && r===currentTrackIndex) r = (r+1)%currentPlaylist.length; playTrack(r); return; }
    if (currentTrackIndex < currentPlaylist.length - 1) playTrack(currentTrackIndex + 1); else if (repeatMode === 1) playTrack(0); else { isPlaying = false; updatePlayPauseIcons(); }
}
function playPrev() {
    if (currentPlaylist.length === 0) return;
    if (audioPlayer.currentTime > 3) { audioPlayer.currentTime = 0; return; }
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1); else if (repeatMode === 1) playTrack(currentPlaylist.length - 1); else audioPlayer.currentTime = 0;
}

audioPlayer.addEventListener('ended', playNext);
playPauseBtns.forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); }));
btnNext.addEventListener('click', playNext); miniNext.addEventListener('click', (e) => { e.stopPropagation(); playNext(); });
btnPrev.addEventListener('click', playPrev);
btnShuffle.addEventListener('click', () => { isShuffle = !isShuffle; btnShuffle.classList.toggle('active-control', isShuffle); });
function cycleRepeatMode(e) { e.stopPropagation(); repeatMode = (repeatMode + 1) % 3; updateRepeatUI(); }
function updateRepeatUI() {
    const icon = repeatMode === 2 ? 'repeat_one' : 'repeat';
    btnRepeat.querySelector('span').textContent = icon; btnRepeat.classList.toggle('active-control', repeatMode !== 0);
    miniRepeat.querySelector('span').textContent = icon; miniRepeat.style.color = repeatMode !== 0 ? 'var(--nintendo-red)' : 'white';
}
btnRepeat.addEventListener('click', cycleRepeatMode); miniRepeat.addEventListener('click', cycleRepeatMode);

audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration) {
        const p = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = p;
        progressBar.style.background = `linear-gradient(to right, #e60012 0%, #e60012 ${p}%, #333 ${p}%, #333 100%)`;
        currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
        totalTimeEl.textContent = formatTime(audioPlayer.duration);
    }
});
progressBar.addEventListener('input', (e) => audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration);
function formatTime(s) { if(isNaN(s)) return "0:00"; const min = Math.floor(s / 60), sec = Math.floor(s % 60); return `${min}:${sec < 10 ? '0' : ''}${sec}`; }

// Cerrar Reproductor
document.getElementById('btn-close-mini-player').addEventListener('click', (e) => {
    e.stopPropagation();
    audioPlayer.pause();
    isPlaying = false;
    updatePlayPauseIcons();
    document.getElementById('mini-player').classList.add('hidden');
    document.getElementById('full-player').classList.add('hidden');
});


// --- Playlists Personalizadas ---
function renderPlaylistsUI() {
    playlistsContainer.innerHTML = '';
    Object.keys(customPlaylists).forEach(listName => {
        const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
        const customCover = playlistCovers[listName];
        const coverStyle = customCover ? `background-image: url('${customCover}');` : `background: var(--nintendo-red);`;
        
        card.innerHTML = `
            <div class="card-img-placeholder" style="${coverStyle}">
                ${!customCover ? '<span class="material-symbols-rounded" style="font-size:40px; color:white;">queue_music</span>' : ''}
            </div>
            <p class="card-title">${listName}</p>
        `;
        
        card.addEventListener('click', () => {
            const pl = customPlaylists[listName].map(path => globalAllTracks[path]).filter(Boolean);
            openGameView({ title: listName, tracks: pl, coverUrl: customCover || null }, true);
        });
        playlistsContainer.appendChild(card);
    });
}

function renderHomeCustomPlaylists() {
    const grid = document.getElementById('custom-playlists-grid');
    if (!grid) return;
    
    grid.innerHTML = ''; 
    const playlistNames = Object.keys(customPlaylists);

    if (playlistNames.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Aún no tienes playlists creadas.</p>';
        return;
    }

    playlistNames.forEach(listName => {
        const card = document.createElement('div'); card.className = 'card nintendo-bouncy';
        const customCover = playlistCovers[listName];
        const coverStyle = customCover ? `background-image: url('${customCover}');` : `background: var(--nintendo-red);`;
        
        card.innerHTML = `
            <div class="card-img-placeholder" style="${coverStyle}">
                ${!customCover ? '<span class="material-symbols-rounded" style="font-size:40px; color:white;">queue_music</span>' : ''}
            </div>
            <p class="card-title">${listName}</p>
        `;
        
        card.addEventListener('click', () => {
            const pl = customPlaylists[listName].map(path => globalAllTracks[path]).filter(Boolean);
            openGameView({ title: listName, tracks: pl, coverUrl: customCover || null }, true);
        });
        grid.appendChild(card);
    });
}

// Configuración de Playlists (Engrane)
document.getElementById('btn-playlist-settings').addEventListener('click', () => {
    document.getElementById('settings-modal-title').textContent = `Ajustes: ${currentEditingPlaylist}`;
    document.getElementById('playlist-settings-modal').classList.remove('hidden');
});
document.getElementById('close-settings-modal').addEventListener('click', () => {
    document.getElementById('playlist-settings-modal').classList.add('hidden');
});

document.getElementById('btn-edit-cover').addEventListener('click', () => {
    playlistToEditCover = currentEditingPlaylist;
    playlistCoverInput.click();
    document.getElementById('playlist-settings-modal').classList.add('hidden');
});

document.getElementById('btn-rename-playlist').addEventListener('click', () => {
    document.getElementById('playlist-settings-modal').classList.add('hidden');
    showInputModal("Renombrar Playlist", currentEditingPlaylist, (newName) => {
        if (newName && newName !== currentEditingPlaylist && !customPlaylists[newName]) {
            customPlaylists[newName] = customPlaylists[currentEditingPlaylist];
            delete customPlaylists[currentEditingPlaylist];
            if (playlistCovers[currentEditingPlaylist]) {
                playlistCovers[newName] = playlistCovers[currentEditingPlaylist];
                delete playlistCovers[currentEditingPlaylist];
            }
            savePlaylists(); localStorage.setItem('nintendoPlaylistCovers', JSON.stringify(playlistCovers)); renderPlaylistsUI(); renderHomeCustomPlaylists();
            
            const pl = customPlaylists[newName].map(path => globalAllTracks[path]).filter(Boolean);
            openGameView({ title: newName, tracks: pl, coverUrl: playlistCovers[newName] || null }, true);
        } else if (customPlaylists[newName]) {
            showModal("Error", "Ya existe una playlist con ese nombre.");
        }
    });
});

document.getElementById('btn-delete-playlist').addEventListener('click', () => {
    document.getElementById('playlist-settings-modal').classList.add('hidden');
    showConfirmModal(`¿Eliminar "${currentEditingPlaylist}"?`, "No perderás tus canciones.", () => {
        delete customPlaylists[currentEditingPlaylist];
        delete playlistCovers[currentEditingPlaylist];
        savePlaylists(); localStorage.setItem('nintendoPlaylistCovers', JSON.stringify(playlistCovers)); renderPlaylistsUI(); renderHomeCustomPlaylists();
        document.getElementById('btn-back-home').click(); 
    });
});

playlistCoverInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && playlistToEditCover) {
        const reader = new FileReader();
        
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 300; 
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const resizedBase64 = canvas.toDataURL('image/jpeg', 0.8);

                try {
                    playlistCovers[playlistToEditCover] = resizedBase64;
                    localStorage.setItem('nintendoPlaylistCovers', JSON.stringify(playlistCovers));
                    
                    renderPlaylistsUI();
                    renderHomeCustomPlaylists();
                    
                    if (currentGameView && currentGameView.title === playlistToEditCover) {
                        document.getElementById('game-view-cover').style.backgroundImage = `url('${resizedBase64}')`;
                        currentGameView.coverUrl = resizedBase64; 
                    }
                } catch (error) {
                    showModal("Error", "La memoria del navegador está llena. No se pudo guardar la portada.");
                    console.error("LocalStorage error:", error);
                }
                
                playlistCoverInput.value = '';
            };
            
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Crear y añadir playlists
document.getElementById('create-playlist-btn').addEventListener('click', () => {
    showInputModal("Nueva Playlist", "Nombre de la playlist", (name) => {
        if(name && !customPlaylists[name]) { customPlaylists[name] = []; savePlaylists(); renderPlaylistsUI(); renderHomeCustomPlaylists(); }
        else { showModal("Error", "La playlist ya existe."); }
    });
});
document.getElementById('btn-add-to-playlist').addEventListener('click', () => {
    const track = currentPlaylist[currentTrackIndex]; if(!track) return; trackPendingToAdd = track;
    const listUI = document.getElementById('modal-playlist-list'); listUI.innerHTML = '';
    Object.keys(customPlaylists).forEach(listName => {
        const li = document.createElement('li'); li.className = 'track-item nintendo-bouncy'; li.innerHTML = `<p class="song-title">${listName}</p>`;
        li.addEventListener('click', () => {
            if(!customPlaylists[listName].includes(trackPendingToAdd.path)) {
                customPlaylists[listName].push(trackPendingToAdd.path); savePlaylists(); renderPlaylistsUI(); renderHomeCustomPlaylists(); showModal("Éxito", `Añadido a ${listName}`);
            } else showModal("Aviso", "La canción ya está en esta lista.");
            document.getElementById('playlist-modal').classList.add('hidden');
        });
        listUI.appendChild(li);
    });
    document.getElementById('playlist-modal').classList.remove('hidden');
});

function savePlaylists() { 
    localStorage.setItem('nintendoPlaylists', JSON.stringify(customPlaylists)); 
    renderHomeCustomPlaylists(); 
}

document.getElementById('export-btn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ lists: customPlaylists, covers: playlistCovers }));
    const a = document.createElement('a'); a.href = dataStr; a.download = "nintendo_playlists.json"; a.click();
});
document.getElementById('import-upload').addEventListener('change', (e) => {
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if(data.lists) { customPlaylists = {...customPlaylists, ...data.lists}; playlistCovers = {...playlistCovers, ...(data.covers||{})}; }
            else customPlaylists = {...customPlaylists, ...data}; 
            savePlaylists(); localStorage.setItem('nintendoPlaylistCovers', JSON.stringify(playlistCovers)); renderPlaylistsUI(); renderHomeCustomPlaylists(); showModal("Éxito", "Importado.");
        } catch(err) { showModal("Error", "Archivo inválido."); }
    };
    if(e.target.files[0]) reader.readAsText(e.target.files[0]);
});

// --- UI General ---
function switchView(targetId) {
    views.forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(targetId);
    if (targetView) targetView.classList.add('active');
}
navItems.forEach(item => item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active')); item.classList.add('active');
    switchView(item.getAttribute('data-target'));
}));
document.getElementById('open-full-player').addEventListener('click', () => document.getElementById('full-player').classList.remove('hidden'));
document.getElementById('close-full-player').addEventListener('click', () => document.getElementById('full-player').classList.add('hidden'));
document.getElementById('btn-show-playlist-player').addEventListener('click', () => { document.getElementById('full-player').classList.add('hidden'); if(currentGameView) switchView('view-game'); });
document.getElementById('btn-back-home').addEventListener('click', () => { switchView('view-home'); navItems[0].classList.add('active'); });

// --- Visualizador de Audio (Web Audio API) ---
let audioCtx;
let analyser;
let source;
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas ? canvas.getContext('2d') : null;

function initVisualizer() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        
        source = audioCtx.createMediaElementSource(audioPlayer);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        analyser.fftSize = 256; 
        drawVisualizer();
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function drawVisualizer() {
    if (!canvas || !canvasCtx) return;
    requestAnimationFrame(drawVisualizer);

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] * 2.5; 

        canvasCtx.fillStyle = `rgba(255, 255, 255, ${dataArray[i] / 255})`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 2; 
    }
}