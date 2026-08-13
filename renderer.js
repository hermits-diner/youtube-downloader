// ═══════════════════════════════════════════════════
//  YouTube Downloader - Renderer Process
// ═══════════════════════════════════════════════════

// NOTE: preload의 contextBridge가 window.electronAPI를 non-configurable 전역으로 만들기 때문에
// 같은 이름으로 최상위 const를 선언하면 스크립트 전체가 SyntaxError로 죽는다. 전역을 그대로 쓴다.

// ─── State ───
let downloadPath = '';
let currentVideoInfo = null;
let currentPlaylist = null;
let currentSearch = null;
let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory') || '[]');

// ─── Settings (앱을 껐다 켜도 유지) ───
// 저장 위치와 형식을 매번 다시 고르게 하는 것은 번거롭다.
const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = {
  downloadPath: '',
  quality: 'best',
  codecMode: 'compat',
  subtitles: true,
  audioOnly: false,
  skipExisting: false,
  clipboardWatch: true,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // 저장에 실패해도 이번 실행에는 영향이 없다.
  }
}

// ─── DOM Elements ───
const urlInput = document.getElementById('url-input');
const btnFetch = document.getElementById('btn-fetch');
const videoInfoSection = document.getElementById('video-info-section');
const videoThumbnail = document.getElementById('video-thumbnail');
const videoTitle = document.getElementById('video-title');
const videoDuration = document.getElementById('video-duration');
const videoUploader = document.getElementById('video-uploader');
const videoViews = document.getElementById('video-views');
const qualitySelect = document.getElementById('quality-select');
const downloadPathEl = document.getElementById('download-path');
const btnBrowse = document.getElementById('btn-browse');
const btnDownload = document.getElementById('btn-download');
const progressSection = document.getElementById('progress-section');
const progressTitle = document.getElementById('progress-title');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const statSpeed = document.getElementById('stat-speed');
const statSize = document.getElementById('stat-size');
const statEta = document.getElementById('stat-eta');
const btnCancel = document.getElementById('btn-cancel');
const completeSection = document.getElementById('complete-section');
const completeFilename = document.getElementById('complete-filename');
const btnOpenFile = document.getElementById('btn-open-file');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnSendPolyglot = document.getElementById('btn-send-polyglot');
const btnNewDownload = document.getElementById('btn-new-download');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const btnClearHistory = document.getElementById('btn-clear-history');
const loadingOverlay = document.getElementById('loading-overlay');
const depWarning = document.getElementById('dependency-warning');
const depMessage = document.getElementById('dep-message');
const depInstallCmd = document.getElementById('dep-install-cmd');
const toastContainer = document.getElementById('toast-container');

// Playlist elements
const playlistSection = document.getElementById('playlist-section');
const playlistTitleEl = document.getElementById('playlist-title');
const playlistUploaderEl = document.getElementById('playlist-uploader');
const playlistItemsEl = document.getElementById('playlist-items');
const playlistCountText = document.getElementById('playlist-count-text');
const playlistFolderHint = document.getElementById('playlist-folder-hint');
const plQualitySelect = document.getElementById('pl-quality-select');
const plDownloadPathEl = document.getElementById('pl-download-path');
const btnPlBrowse = document.getElementById('btn-pl-browse');
const btnSelectAll = document.getElementById('btn-select-all');
const btnSelectNone = document.getElementById('btn-select-none');
const btnDownloadPlaylist = document.getElementById('btn-download-playlist');
const btnDownloadPlaylistLabel = document.getElementById('btn-download-playlist-label');
const overallProgress = document.getElementById('overall-progress');
const overallCount = document.getElementById('overall-count');
const overallFill = document.getElementById('overall-fill');
const overallCurrent = document.getElementById('overall-current');
// Engine status
const engineDot = document.getElementById('engine-dot');
const engineStatus = document.getElementById('engine-status');
const engineHint = document.getElementById('engine-hint');
const btnEngineUpdate = document.getElementById('btn-engine-update');
const btnEngineNightly = document.getElementById('btn-engine-nightly');

// Search results
const searchSection = document.getElementById('search-section');
const searchQueryEl = document.getElementById('search-query');
const searchItemsEl = document.getElementById('search-items');
const searchCountText = document.getElementById('search-count-text');
const btnSearchAll = document.getElementById('btn-search-all');
const btnSearchNone = document.getElementById('btn-search-none');
const btnDownloadSearch = document.getElementById('btn-download-search');
const btnDownloadSearchLabel = document.getElementById('btn-download-search-label');
const srQualitySelect = document.getElementById('sr-quality-select');
const srDownloadPathEl = document.getElementById('sr-download-path');
const btnSrBrowse = document.getElementById('btn-sr-browse');
const srCodecMode = document.getElementById('sr-codec-mode');
const srCodecHint = document.getElementById('sr-codec-hint');
const srSubEnable = document.getElementById('sr-sub-enable');


// Video format (codec)
const codecMode = document.getElementById('codec-mode');
const codecHint = document.getElementById('codec-hint');
const plCodecMode = document.getElementById('pl-codec-mode');
const plCodecHint = document.getElementById('pl-codec-hint');

// Subtitle options
const subEnable = document.getElementById('sub-enable');
const skipExisting = document.getElementById('skip-existing');
const plSkipExisting = document.getElementById('pl-skip-existing');
const srSkipExisting = document.getElementById('sr-skip-existing');

const plSubEnable = document.getElementById('pl-sub-enable');


// Clip (구간) controls
const clipEnable = document.getElementById('clip-enable');
const clipStart = document.getElementById('clip-start');
const clipEnd = document.getElementById('clip-end');
const clipHint = document.getElementById('clip-hint');

// Download queue
const queueSection = document.getElementById('queue-section');
const queueCount = document.getElementById('queue-count');
const queueItems = document.getElementById('queue-items');
const btnQueueClear = document.getElementById('btn-queue-clear');

// Clipboard watch
const clipboardWatchEl = document.getElementById('clipboard-watch');

// Make (변환)
const btnMake = document.getElementById('btn-make');
const makeSection = document.getElementById('make-section');
const makeSourceTitle = document.getElementById('make-source-title');
const btnMakeClose = document.getElementById('btn-make-close');
const makeOptions = document.getElementById('make-options');
const makeOptGif = document.getElementById('make-opt-gif');
const makeOptMirror = document.getElementById('make-opt-mirror');
const makeOptNote = document.getElementById('make-opt-note');
const makeOptNoteText = document.getElementById('make-opt-note-text');
const makeGifStart = document.getElementById('make-gif-start');
const makeGifEnd = document.getElementById('make-gif-end');
const btnMakeRun = document.getElementById('btn-make-run');
const btnMakeRunLabel = document.getElementById('btn-make-run-label');

const completeSummary = document.getElementById('complete-summary');
const summaryOk = document.getElementById('summary-ok');
const summaryFail = document.getElementById('summary-fail');
const summaryFailedList = document.getElementById('summary-failed-list');

// ─── Initialization ───
// 세 화면(단일·재생목록·검색)의 같은 성격 컨트롤을 묶어둔다.
function settingControls() {
  return {
    quality: [qualitySelect, plQualitySelect, srQualitySelect],
    codecMode: [codecMode, plCodecMode, srCodecMode],
    subtitles: [subEnable, plSubEnable, srSubEnable],
    skipExisting: [skipExisting, plSkipExisting, srSkipExisting],
  };
}

function applySettings() {
  const c = settingControls();
  for (const el of c.quality) {
    if ([...el.options].some((o) => o.value === settings.quality)) el.value = settings.quality;
  }
  for (const el of c.codecMode) el.value = settings.codecMode;
  for (const el of c.subtitles) el.checked = settings.subtitles;
  for (const el of c.skipExisting) el.checked = settings.skipExisting;
  clipboardWatchEl.checked = settings.clipboardWatch;
}

// 한 화면에서 바꾼 값을 나머지 화면과 저장소에 함께 반영한다.
// 화면마다 설정이 달라지면 사용자가 어디서 무엇을 골랐는지 기억해야 해서 혼란스럽다.
function wireSettingsPersistence() {
  const c = settingControls();
  const sync = (key, group, read) => {
    for (const el of group) {
      el.addEventListener('change', () => {
        settings[key] = read(el);
        for (const other of group) {
          if (other !== el) {
            if (other.type === 'checkbox') other.checked = settings[key];
            else if ([...other.options].some((o) => o.value === settings[key])) other.value = settings[key];
          }
        }
        saveSettings();
      });
    }
  };
  sync('quality', c.quality, (el) => el.value);
  sync('codecMode', c.codecMode, (el) => el.value);
  sync('subtitles', c.subtitles, (el) => el.checked);
  sync('skipExisting', c.skipExisting, (el) => el.checked);

  clipboardWatchEl.addEventListener('change', () => {
    settings.clipboardWatch = clipboardWatchEl.checked;
    saveSettings();
  });
}

// ─── Theme Picker ───

const THEME_KEY = 'theme';
const THEMES = ['polyglot', 'ink-gold', 'slate', 'teal-copper', 'wine', 'neon'];

function wireThemePicker() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
  const current = THEMES.includes(saved) ? saved : 'polyglot';
  applyTheme(current);
  for (const btn of document.querySelectorAll('.theme-swatch')) {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  }
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'polyglot';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  for (const btn of document.querySelectorAll('.theme-swatch')) {
    btn.classList.toggle('is-active', btn.dataset.theme === theme);
  }
}

async function init() {
  // 저장해둔 폴더가 아직 있으면 그것을, 없으면 기본 다운로드 폴더를 쓴다.
  const fallback = await electronAPI.getDefaultDownloadPath();
  downloadPath = settings.downloadPath || fallback;
  if (settings.downloadPath) {
    const ok = await electronAPI.pathExists(settings.downloadPath);
    if (!ok) downloadPath = fallback;
  }
  updatePathDisplay();
  applySettings();

  // Check dependencies
  const deps = await electronAPI.checkDependencies();
  if (!deps.ytdlp || !deps.ffmpeg) {
    showDependencyWarning(deps);
  }

  // Render history
  renderHistory();

  // Setup event listeners
  setupEventListeners();
  wireSettingsPersistence();
  wireThemePicker();

  // Setup progress listener
  electronAPI.onDownloadProgress(handleProgress);

  // 복사한 유튜브 주소 자동 감지
  electronAPI.onClipboardUrl(handleClipboardUrl);

  // 엔진 갱신은 시작을 막지 않도록 백그라운드로 돌린다.
  refreshEngineInfo().then(() => autoUpdateEngine());
}

// ─── Engine (yt-dlp) Status & Update ───

function setEngineState(state, statusText) {
  engineDot.className = 'engine-dot' + (state ? ` is-${state}` : '');
  if (statusText !== undefined) engineStatus.textContent = statusText;
}

function engineLabel(version, channel, suffix = '') {
  const chan = channel === 'nightly' ? ' (nightly)' : '';
  return `버전 ${version}${chan}${suffix}`;
}

async function refreshEngineInfo() {
  try {
    const info = await electronAPI.getEngineInfo();
    if (!info.version) {
      setEngineState('error', '엔진을 실행할 수 없습니다');
      return null;
    }
    setEngineState('ok', engineLabel(info.version, info.channel));
    if (!info.updatable) {
      btnEngineUpdate.disabled = true;
      btnEngineNightly.disabled = true;
      engineHint.textContent =
        '엔진을 쓰기 가능한 위치에 준비하지 못했습니다. 자동 업데이트가 비활성화됩니다.';
    }
    return info;
  } catch (error) {
    setEngineState('error', '엔진 확인 실패');
    return null;
  }
}

// 시작 시 조용히 갱신한다. 실패해도 사용자를 방해하지 않는다 — 기존 버전으로 계속 쓸 수 있다.
async function autoUpdateEngine() {
  if (btnEngineUpdate.disabled) return;

  setEngineState('busy', '최신 버전 확인 중...');
  try {
    // 채널을 지정하지 않는다 — 사용자가 nightly로 옮겨둔 상태를 시작할 때마다 되돌리면 안 된다.
    const result = await electronAPI.updateEngine({});
    if (result.ok && result.changed) {
      setEngineState('ok', engineLabel(result.version, result.channel, ' · 업데이트됨'));
      showToast(`엔진을 ${result.version}로 업데이트했습니다.`, 'success');
    } else if (result.ok) {
      setEngineState('ok', engineLabel(result.version, result.channel, ' · 최신'));
    } else {
      // 오프라인 등으로 확인만 실패한 경우. 다운로드 자체는 정상 동작한다.
      await refreshEngineInfo();
    }
  } catch (error) {
    await refreshEngineInfo();
  }
}

async function updateEngineManually(channel) {
  btnEngineUpdate.disabled = true;
  btnEngineNightly.disabled = true;
  setEngineState('busy', channel === 'nightly' ? 'nightly로 전환 중...' : '업데이트 중...');

  try {
    const result = await electronAPI.updateEngine({ channel });
    if (result.ok) {
      setEngineState('ok', engineLabel(result.version, result.channel));
      const chanName = result.channel === 'nightly' ? 'nightly' : '안정판';
      showToast(
        result.changed
          ? `엔진을 ${chanName} ${result.version}로 변경했습니다.`
          : `이미 최신 ${chanName}입니다. (${result.version})`,
        'success'
      );
    } else {
      setEngineState('error', '업데이트 실패');
      showToast(`업데이트 실패: ${result.message || '알 수 없는 오류'}`, 'error');
      await refreshEngineInfo();
    }
  } catch (error) {
    setEngineState('error', '업데이트 실패');
    showToast(`업데이트 실패: ${error.message}`, 'error');
  } finally {
    btnEngineUpdate.disabled = false;
    btnEngineNightly.disabled = false;
  }
}

function setupEventListeners() {
  // Window controls
  document.getElementById('btn-minimize').addEventListener('click', () => electronAPI.minimizeWindow());
  document.getElementById('btn-maximize').addEventListener('click', () => electronAPI.maximizeWindow());
  document.getElementById('btn-close').addEventListener('click', () => electronAPI.closeWindow());

  // URL input - Enter key
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      fetchVideoInfo();
    }
  });

  // URL input - paste detection
  urlInput.addEventListener('paste', () => {
    setTimeout(() => {
      if (isValidYoutubeUrl(urlInput.value.trim())) {
        fetchVideoInfo();
      }
    }, 100);
  });

  // Fetch button
  btnFetch.addEventListener('click', fetchVideoInfo);

  // Browse folder
  btnBrowse.addEventListener('click', selectDownloadFolder);
  btnPlBrowse.addEventListener('click', selectDownloadFolder);
  btnSrBrowse.addEventListener('click', selectDownloadFolder);

  // Search result controls
  btnSearchAll.addEventListener('click', () => setAllSearchChecked(true));
  btnSearchNone.addEventListener('click', () => setAllSearchChecked(false));
  btnDownloadSearch.addEventListener('click', startSearchDownload);

  // Download button
  btnDownload.addEventListener('click', startDownload);

  // Playlist controls
  btnSelectAll.addEventListener('click', () => setAllPlaylistChecked(true));
  btnSelectNone.addEventListener('click', () => setAllPlaylistChecked(false));
  btnDownloadPlaylist.addEventListener('click', startPlaylistDownload);

  // Cancel button
  btnCancel.addEventListener('click', cancelDownload);

  // Complete actions
  btnOpenFile.addEventListener('click', () => {
    reportOpenResult(electronAPI.openFile(lastCompletedPath || currentVideoInfo?._filePath));
  });

  btnOpenFolder.addEventListener('click', () => {
    const p = lastCompletedPath || currentVideoInfo?._filePath;
    reportOpenResult(p ? electronAPI.showItemInFolder(p) : electronAPI.openFolder(downloadPath));
  });

  btnSendPolyglot.addEventListener('click', async () => {
    const p = lastCompletedPath || currentVideoInfo?._filePath;
    if (!p) { showToast('보낼 파일을 찾지 못했습니다.', 'error'); return; }
    try {
      const r = await electronAPI.sendToPolyglot(p);
      if (r && r.ok) showToast(r.message || 'Polyglot Player로 보냈습니다.', 'success');
      else showToast((r && r.message) || 'Polyglot Player로 보내지 못했습니다.', 'error');
    } catch (e) {
      showToast(`Polyglot Player로 보내지 못했습니다: ${e.message}`, 'error');
    }
  });

  btnNewDownload.addEventListener('click', resetToInput);

  // Clear history
  btnClearHistory.addEventListener('click', clearHistory);

  // Clip (구간) controls
  clipEnable.addEventListener('change', syncClipControls);

  // Queue controls
  btnQueueClear.addEventListener('click', clearWaitingJobs);

  // Make (변환) controls
  btnMake.addEventListener('click', openMakePanel);
  btnMakeClose.addEventListener('click', () => { makeSection.style.display = 'none'; });
  for (const card of document.querySelectorAll('.make-card')) {
    card.addEventListener('click', () => selectMakeType(card.dataset.make));
  }
  btnMakeRun.addEventListener('click', runMake);
  electronAPI.onConvertProgress(handleConvertProgress);

  // Engine update controls
  btnEngineUpdate.addEventListener('click', () => updateEngineManually('stable'));
  btnEngineNightly.addEventListener('click', () => updateEngineManually('nightly'));

  // Video format hints — 화질과 형식 중 무엇이 바뀌어도 다시 계산한다.
  for (const [mode, quality, hint] of [
    [codecMode, qualitySelect, codecHint],
    [plCodecMode, plQualitySelect, plCodecHint],
    [srCodecMode, srQualitySelect, srCodecHint],
  ]) {
    const sync = () => updateCodecHint(mode, quality, hint);
    mode.addEventListener('change', sync);
    quality.addEventListener('change', sync);
    sync();
  }

}

// 열기 동작은 실패해도 예외를 던지지 않는다. 결과를 확인해 알려주지 않으면
// 사용자에게는 "버튼이 안 눌린다"로만 보인다.
async function reportOpenResult(promise) {
  try {
    const result = await promise;
    if (result && result.ok === false) {
      showToast(result.message || '열 수 없습니다.', 'error');
    }
  } catch (error) {
    showToast(`열 수 없습니다: ${error.message}`, 'error');
  }
}

// Polyglot으로 보내기 버튼은 재생 가능한 미디어(영상·음원) 한 개일 때만 보인다.
// GIF·PDF·장면 이미지나 일괄 다운로드에는 넘길 대상이 없으므로 숨긴다.
const POLYGLOT_MEDIA_RE = /\.(mp4|m4v|webm|mov|avi|mkv|mp3|m4a|wav|flac|ogg|oga|opus|aac|wma)$/i;
function updatePolyglotButton(filePath) {
  btnSendPolyglot.style.display = filePath && POLYGLOT_MEDIA_RE.test(filePath) ? '' : 'none';
}

// 쓰는 사람이 한국어 화자라 한국어 자막은 필요가 없다(한국어 영상은 알아듣고,
// 영어 영상에 붙는 한국어 자막은 기계 번역이라 품질이 낮다). 영어로 고정한다.
const SUBTITLE_LANGS = 'en';

function getSubtitleOptions(checkbox) {
  return { enabled: checkbox.checked, langs: SUBTITLE_LANGS };
}

// 유튜브는 H.264를 1080p까지만 제공한다. 호환성 우선인데 2K/4K를 고르면 조용히
// 1080p로 떨어지므로, 그 사실을 미리 알려준다.
function updateCodecHint(modeSelect, qualityEl, hintEl) {
  const compat = modeSelect.value === 'compat';
  const audio = modeSelect.value === 'audio';
  const q = parseInt(qualityEl.value, 10);
  const wantsHigh = !isNaN(q) && q > 1080;

  // 음원만 받을 때는 화질이 의미가 없다. 고를 수 있게 두면 잘못 이해하게 된다.
  const qualityGroup = qualityEl.closest('.option-group');
  if (qualityGroup) qualityGroup.style.opacity = audio ? '0.4' : '';
  qualityEl.disabled = audio;

  if (audio) {
    hintEl.className = 'codec-hint';
    hintEl.textContent =
      '영상 없이 소리만 MP3로 저장합니다. 화질 설정은 쓰이지 않습니다. 수업용 듣기 자료나 음원이 필요할 때 쓰세요.';
    return;
  }

  if (compat && wantsHigh) {
    hintEl.className = 'codec-hint is-warning';
    hintEl.textContent =
      '유튜브는 H.264를 1080p까지만 제공합니다. 지금 설정으로는 1080p로 저장됩니다. 4K가 필요하면 형식을 «화질 우선»으로 바꾸세요.';
    return;
  }

  hintEl.className = 'codec-hint';
  hintEl.textContent = compat
    ? '파워포인트·윈도우 기본 플레이어·편집 프로그램에서 바로 열립니다. 최대 1080p.'
    : 'AV1/VP9 코덱을 허용해 4K까지 받습니다. 일부 프로그램에서 재생되지 않을 수 있습니다.';
}

function describeSubtitles(files) {
  if (!files || files.length === 0) return '';
  // 파일명 끝의 언어 코드(예: video.ko.srt)를 뽑아 언어별로 센다.
  const langs = new Set();
  for (const f of files) {
    const m = f.match(/\.([a-z]{2}(?:-[A-Za-z]+)?)\.srt$/i);
    if (m) langs.add(m[1].toLowerCase());
  }
  const names = { ko: '한국어', en: '영어' };
  const label = [...langs].map((l) => names[l] || l).join(', ');
  return label ? `자막 ${files.length}개 (${label})` : `자막 ${files.length}개`;
}

// ─── Utility Functions ───

function cleanYoutubeUrl(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i) || trimmed.match(/(www\.)?(youtube\.com|youtu\.be)[^\s]+/i);
  let cleaned = urlMatch ? urlMatch[0] : trimmed;
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned;
}

function isValidYoutubeUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('youtube.com') || lower.includes('youtu.be');
}

function isPlaylistUrl(url) {
  return /[?&]list=/i.test(url) || /\/playlist\?/i.test(url);
}

// 채널 주소 판별. @핸들, /channel/UC..., /c/이름, /user/이름 형태를 모두 받는다.
const CHANNEL_PATH = String.raw`(?:@[^/?#]+|channel/[^/?#]+|c/[^/?#]+|user/[^/?#]+)`;
const CHANNEL_TABS = ['videos', 'streams', 'shorts', 'playlists', 'featured', 'podcasts', 'releases'];

function isChannelUrl(url) {
  return new RegExp(String.raw`youtube\.com/${CHANNEL_PATH}`, 'i').test(url);
}

// 채널 주소를 그대로 넘기면 yt-dlp가 영상이 아니라 탭 목록(Videos / Live / Shorts)을 돌려준다.
// 영상 탭을 명시해야 실제 영상이 나온다.
function normalizeChannelUrl(url) {
  const m = url.match(new RegExp(String.raw`^(https?://[^/]*youtube\.com/${CHANNEL_PATH})(/[^/?#]*)?`, 'i'));
  if (!m) return url;
  const tab = (m[2] || '').replace('/', '').toLowerCase();
  return CHANNEL_TABS.includes(tab) ? `${m[1]}/${tab}` : `${m[1]}/videos`;
}

// 검색어와 주소를 가른다. 공백이 있으면 사람이 친 낱말로 본다.
function looksLikeUrl(input) {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  return /^https?:\/\//i.test(s) || /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(s);
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViewCount(count) {
  if (!count) return '';
  if (count >= 100000000) return `조회수 ${(count / 100000000).toFixed(1)}억회`;
  if (count >= 10000) return `조회수 ${(count / 10000).toFixed(1)}만회`;
  if (count >= 1000) return `조회수 ${(count / 1000).toFixed(1)}천회`;
  return `조회수 ${count.toLocaleString()}회`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  return date.toLocaleDateString('ko-KR');
}

function updatePathDisplay() {
  const maxLen = 35;
  let display = downloadPath;
  if (display.length > maxLen) {
    display = '...' + display.slice(-maxLen);
  }
  downloadPathEl.textContent = display;
  downloadPathEl.title = downloadPath;
  plDownloadPathEl.textContent = display;
  plDownloadPathEl.title = downloadPath;
  srDownloadPathEl.textContent = display;
  srDownloadPathEl.title = downloadPath;
}

// ─── Toast Notifications ───

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="11" x2="12" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="8" x2="12.01" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Dependency Warning ───

function showDependencyWarning(deps) {
  depWarning.style.display = 'flex';

  const missing = [];
  if (!deps.ytdlp) missing.push('yt-dlp');
  if (!deps.ffmpeg) missing.push('ffmpeg');

  depMessage.textContent = `${missing.join(', ')}이(가) 설치되어 있지 않습니다. 다운로드 기능을 사용하려면 먼저 설치해주세요.`;

  const commands = [];
  if (!deps.ytdlp) commands.push('pip install yt-dlp');
  if (!deps.ffmpeg) commands.push('winget install ffmpeg');
  depInstallCmd.textContent = commands.join('\n');
}

// ─── Fetch Video Info ───

async function fetchVideoInfo() {
  const rawInput = urlInput.value.trim();

  if (!rawInput) {
    showToast('유튜브 URL이나 검색어를 입력해주세요.', 'warning');
    urlInput.focus();
    return;
  }

  loadingOverlay.style.display = 'flex';
  btnFetch.disabled = true;
  completeSection.style.display = 'none';
  if (!runningJob) progressSection.style.display = 'none';

  // URL 형태가 아니면 검색어로 취급한다. 예전에는 여기서 오류 토스트를 띄웠다.
  if (!looksLikeUrl(rawInput)) {
    await searchVideos(rawInput);
    return;
  }

  const url = cleanYoutubeUrl(rawInput);
  if (url && url !== rawInput) {
    urlInput.value = url;
  }

  if (!isValidYoutubeUrl(url)) {
    loadingOverlay.style.display = 'none';
    btnFetch.disabled = false;
    showToast('유튜브 주소가 아닙니다. 검색하려면 주소가 아닌 낱말을 입력하세요.', 'error');
    urlInput.focus();
    return;
  }

  searchSection.style.display = 'none';
  currentSearch = null;

  if (isChannelUrl(url)) {
    await fetchPlaylistInfo(normalizeChannelUrl(url));
    return;
  }

  if (isPlaylistUrl(url)) {
    await fetchPlaylistInfo(url);
    return;
  }

  playlistSection.style.display = 'none';
  currentPlaylist = null;

  try {
    const info = await electronAPI.getVideoInfo(url);
    currentVideoInfo = info;

    // Update UI
    videoThumbnail.src = info.thumbnail;
    videoTitle.textContent = info.title;
    videoDuration.textContent = formatDuration(info.duration);
    videoUploader.textContent = info.uploader;
    videoViews.textContent = formatViewCount(info.viewCount);

    // Update quality select with available formats
    qualitySelect.innerHTML = '<option value="best" selected>최고 화질 (Auto Best)</option>';

    const defaultQualities = [
      { value: '2160', label: '4K (2160p)' },
      { value: '1440', label: '2K (1440p)' },
      { value: '1080', label: 'Full HD (1080p)' },
      { value: '720', label: 'HD (720p)' },
      { value: '480', label: 'SD (480p)' },
      { value: '360', label: 'Low (360p)' },
    ];

    const availableHeights = new Set((info.formats || []).map((f) => f.height));

    for (const q of defaultQualities) {
      if (availableHeights.has(parseInt(q.value))) {
        const option = document.createElement('option');
        option.value = q.value;
        option.textContent = q.label;
        qualitySelect.appendChild(option);
      }
    }

    // Show video info section
    videoInfoSection.style.display = 'block';

    showToast('영상 정보를 불러왔습니다.', 'success');
  } catch (error) {
    showToast(`영상 정보를 가져올 수 없습니다: ${error.message}`, 'error');
  } finally {
    loadingOverlay.style.display = 'none';
    btnFetch.disabled = false;
  }
}

// ─── Search ───

async function searchVideos(query) {
  try {
    const result = await electronAPI.searchVideos({ query, limit: 20 });
    currentSearch = result;
    currentVideoInfo = null;
    currentPlaylist = null;

    videoInfoSection.style.display = 'none';
    playlistSection.style.display = 'none';
    renderSearchResults(result);
    searchSection.style.display = 'block';

    if (result.entries.length === 0) {
      showToast('검색 결과가 없습니다.', 'warning');
    } else {
      showToast(`${result.entries.length}개를 찾았습니다.`, 'success');
    }
  } catch (error) {
    showToast(`검색에 실패했습니다: ${error.message}`, 'error');
  } finally {
    loadingOverlay.style.display = 'none';
    btnFetch.disabled = false;
  }
}

function renderSearchResults(result) {
  searchQueryEl.textContent = `"${result.query}"`;
  searchItemsEl.innerHTML = '';

  if (result.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = '검색 결과가 없습니다. 다른 낱말로 찾아보세요.';
    searchItemsEl.appendChild(empty);
    updateSearchCount();
    return;
  }

  result.entries.forEach((entry, i) => {
    const row = document.createElement('label');
    row.className = 'search-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    // 검색은 훑어보고 고르는 행위다. 20개가 전부 체크된 채로 뜨면 사고가 난다.
    checkbox.checked = false;
    checkbox.dataset.index = String(i);
    checkbox.addEventListener('change', updateSearchCount);

    const thumb = document.createElement('div');
    thumb.className = 'search-thumb';
    if (entry.thumbnail) {
      const img = document.createElement('img');
      img.src = entry.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    }
    if (entry.duration) {
      const dur = document.createElement('span');
      dur.className = 'search-thumb-duration';
      dur.textContent = formatDuration(entry.duration);
      thumb.appendChild(dur);
    }

    const info = document.createElement('div');
    info.className = 'search-info';

    const title = document.createElement('div');
    title.className = 'search-row-title';
    title.textContent = entry.title;
    title.title = entry.title;

    const meta = document.createElement('div');
    meta.className = 'search-row-meta';
    if (entry.isLive) {
      const live = document.createElement('span');
      live.className = 'search-live-badge';
      live.textContent = '● LIVE';
      meta.appendChild(live);
    }
    if (entry.channel) {
      const ch = document.createElement('span');
      ch.textContent = entry.channel;
      meta.appendChild(ch);
    }
    if (entry.viewCount) {
      const vc = document.createElement('span');
      vc.textContent = formatViewCount(entry.viewCount);
      meta.appendChild(vc);
    }

    info.append(title, meta);
    row.append(checkbox, thumb, info);
    searchItemsEl.appendChild(row);
  });

  updateSearchCount();
}

function getSearchCheckboxes() {
  return [...searchItemsEl.querySelectorAll('input[type="checkbox"]')];
}

function getSelectedSearchVideos() {
  if (!currentSearch) return [];
  return getSearchCheckboxes()
    .filter((cb) => cb.checked)
    .map((cb) => currentSearch.entries[parseInt(cb.dataset.index, 10)])
    .filter(Boolean);
}

function setAllSearchChecked(checked) {
  getSearchCheckboxes().forEach((cb) => { cb.checked = checked; });
  updateSearchCount();
}

function updateSearchCount() {
  const total = currentSearch ? currentSearch.entries.length : 0;
  const selected = getSelectedSearchVideos().length;

  searchCountText.textContent = `${selected}개 선택 / 결과 ${total}개`;
  btnDownloadSearchLabel.textContent =
    selected > 0 ? `선택한 ${selected}개 다운로드` : '영상을 선택하세요';
  btnDownloadSearch.disabled = selected === 0;
}

// ─── Fetch Playlist Info ───

async function fetchPlaylistInfo(url) {
  try {
    const info = await electronAPI.getPlaylistInfo(url);
    currentPlaylist = { ...info, url };
    currentVideoInfo = null;

    videoInfoSection.style.display = 'none';
    renderPlaylist(info);
    playlistSection.style.display = 'block';

    const usable = info.entries.filter((e) => !e.unavailable).length;
    showToast(`재생목록 ${usable}개 영상을 불러왔습니다.`, 'success');
  } catch (error) {
    showToast(`재생목록을 가져올 수 없습니다: ${error.message}`, 'error');
  } finally {
    loadingOverlay.style.display = 'none';
    btnFetch.disabled = false;
  }
}

function renderPlaylist(info) {
  playlistTitleEl.textContent = info.playlistTitle;
  playlistUploaderEl.textContent = info.uploader || '';
  playlistFolderHint.textContent = info.playlistTitle;

  playlistItemsEl.innerHTML = '';

  for (const entry of info.entries) {
    const row = document.createElement('label');
    row.className = 'playlist-row' + (entry.unavailable ? ' is-unavailable' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !entry.unavailable;
    checkbox.disabled = entry.unavailable;
    checkbox.dataset.playlistIndex = String(entry.playlistIndex);
    checkbox.addEventListener('change', updateSelectionCount);

    const index = document.createElement('span');
    index.className = 'playlist-row-index';
    index.textContent = String(entry.playlistIndex);

    const title = document.createElement('span');
    title.className = 'playlist-row-title';
    title.textContent = entry.title;
    title.title = entry.title;

    const duration = document.createElement('span');
    duration.className = 'playlist-row-duration';
    duration.textContent = entry.duration ? formatDuration(entry.duration) : '--:--';

    row.append(checkbox, index, title, duration);
    playlistItemsEl.appendChild(row);
  }

  updateSelectionCount();
}

function getPlaylistCheckboxes() {
  return [...playlistItemsEl.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
}

function getSelectedIndices() {
  return getPlaylistCheckboxes()
    .filter((cb) => cb.checked)
    .map((cb) => parseInt(cb.dataset.playlistIndex, 10));
}

function setAllPlaylistChecked(checked) {
  getPlaylistCheckboxes().forEach((cb) => {
    cb.checked = checked;
  });
  updateSelectionCount();
}

function updateSelectionCount() {
  const total = currentPlaylist ? currentPlaylist.entries.length : 0;
  const selected = getSelectedIndices().length;

  playlistCountText.textContent = `${selected}개 선택 / 전체 ${total}개`;
  btnDownloadPlaylistLabel.textContent =
    selected > 0 ? `선택한 ${selected}개 다운로드` : '영상을 선택하세요';
  btnDownloadPlaylist.disabled = selected === 0;
}

// ─── Select Download Folder ───

async function selectDownloadFolder() {
  const dir = await electronAPI.selectDirectory();
  if (dir) {
    downloadPath = dir;
    settings.downloadPath = dir;
    saveSettings();
    updatePathDisplay();
    showToast('저장 위치가 변경되었습니다.', 'success');
  }
}

// ─── Pipeline Stepper Helper ───

function setPipelineStep(stepIndex) {
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step-${i}`);
    if (!stepEl) continue;
    if (i < stepIndex) {
      stepEl.className = 'step-item step-done';
    } else if (i === stepIndex) {
      stepEl.className = 'step-item step-active';
    } else {
      stepEl.className = 'step-item';
    }
  }

  for (let i = 1; i <= 3; i++) {
    const lineEl = document.getElementById(`line-${i}`);
    if (!lineEl) continue;
    if (i < stepIndex) {
      lineEl.className = 'step-line line-active';
    } else {
      lineEl.className = 'step-line';
    }
  }
}

// ─── Download Video ───

// ─── Clip (구간) ───

// "1:30", "90", "1:02:30" 을 초로. 형식이 아니면 null.
function parseTimeInput(str) {
  const t = (str || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = t.match(/^(\d+):([0-5]?\d)$/);
  if (m) return +m[1] * 60 + +m[2];
  if (/^\d+$/.test(t)) return +t;
  return null;
}

function syncClipControls() {
  const on = clipEnable.checked;
  clipStart.disabled = !on;
  clipEnd.disabled = !on;
  clipHint.style.display = on ? 'block' : 'none';
  // 구간 자막은 시간이 어긋나고, 아카이브는 전체 영상 기록과 충돌한다. 구간 모드에서는 잠근다.
  subEnable.disabled = on;
  skipExisting.disabled = on;
  subEnable.closest('.subtitle-toggle').style.opacity = on ? '0.4' : '';
  skipExisting.closest('.subtitle-toggle').style.opacity = on ? '0.4' : '';
  if (!on) {
    clipStart.classList.remove('is-invalid');
    clipEnd.classList.remove('is-invalid');
  }
}

// 검증에 실패하면 null을 돌려주고 이유를 토스트로 알린다.
function readClipSection() {
  clipStart.classList.remove('is-invalid');
  clipEnd.classList.remove('is-invalid');

  const start = parseTimeInput(clipStart.value);
  if (start === null) {
    clipStart.classList.add('is-invalid');
    showToast('시작 시간을 "1:30" 형식으로 입력해주세요.', 'warning');
    return null;
  }

  let end = null;
  if (clipEnd.value.trim()) {
    end = parseTimeInput(clipEnd.value);
    if (end === null) {
      clipEnd.classList.add('is-invalid');
      showToast('끝 시간을 "2:45" 형식으로 입력해주세요. 비우면 끝까지 받습니다.', 'warning');
      return null;
    }
    if (end <= start) {
      clipEnd.classList.add('is-invalid');
      showToast('끝 시간이 시작보다 빨라요.', 'warning');
      return null;
    }
  }

  const duration = currentVideoInfo?.duration || 0;
  if (duration && start >= duration) {
    clipStart.classList.add('is-invalid');
    showToast(`이 영상은 ${formatDuration(duration)}까지입니다.`, 'warning');
    return null;
  }

  return { start, end };
}

// ─── Download Queue ───
//
// 다운로드는 한 번에 하나씩만 돈다(yt-dlp 프로세스 추적이 하나뿐이다). 여기 대기열이
// 직렬화를 맡고, 화면 전환도 러너가 소유한다 — 각 작업이 직접 화면을 만지면
// 대기 중 다른 검색을 하는 순간 상태가 꼬인다.
//
// 중요한 규칙: 작업에 필요한 모든 값은 클릭 시점에 ctx로 스냅샷한다. 전역 상태
// (currentPlaylist 등)를 실행 시점에 읽으면, 대기하는 사이 사용자가 다른 목록을
// 열었을 때 엉뚱한 제목이 나오거나 null 참조가 난다.

const downloadQueue = [];
let runningJob = null;
let queueSeq = 0;
// 완료 화면의 "파일 열기"가 쓸 마지막 결과 경로. currentVideoInfo는 사용자가
// 새 영상을 조회하면 바뀌므로 결과 경로를 거기 실어두면 안 된다.
let lastCompletedPath = '';

function isJobTerminal(j) {
  return j.status === 'done' || j.status === 'failed' || j.status === 'cancelled';
}

function enqueueDownload(job) {
  // 이전 배치가 모두 끝난 상태에서 새로 추가하면 새 배치로 시작한다.
  if (!runningJob && downloadQueue.every(isJobTerminal)) {
    downloadQueue.length = 0;
  }
  job.id = ++queueSeq;
  job.status = 'waiting';
  downloadQueue.push(job);
  if (runningJob) {
    showToast(`대기열에 추가했습니다 (${downloadQueue.filter((j) => j.status === 'waiting').length}개 대기)`, 'info');
  }
  renderQueue();
  pumpQueue();
}

function resetProgressUI(ctx) {
  progressSection.style.display = 'block';
  completeSection.style.display = 'none';
  setPipelineStep(1);
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressTitle.textContent = ctx.itemCount > 1
    ? `유튜브 서버 연결 중... (${ctx.itemCount}개)`
    : '유튜브 서버 연결 중...';
  statSpeed.textContent = '--';
  statSize.textContent = '--';
  statEta.textContent = '--';

  if (ctx.itemCount > 1) {
    overallProgress.style.display = 'block';
    overallFill.style.width = '0%';
    overallCount.textContent = `0 / ${ctx.itemCount}`;
    overallCurrent.textContent = '';
  } else {
    overallProgress.style.display = 'none';
  }
}

async function pumpQueue() {
  if (runningJob) return;

  const job = downloadQueue.find((j) => j.status === 'waiting');
  if (!job) {
    finishQueueUI();
    return;
  }

  runningJob = job;
  job.status = 'running';
  renderQueue();
  resetProgressUI(job.ctx);

  try {
    const result = await job.run();
    if (job.cancelRequested) {
      // --ignore-errors 때문에 취소해도 부분 결과로 resolve될 수 있다. 취소로 처리한다.
      job.status = 'cancelled';
    } else {
      job.status = 'done';
      job.result = result;
      if (job.onDone) job.onDone(result, job.ctx);
    }
  } catch (error) {
    job.status = job.cancelRequested ? 'cancelled' : 'failed';
    job.error = error.message;
    if (!job.cancelRequested) {
      showToast(`다운로드 실패: ${String(error.message).slice(0, 90)}`, 'error');
    }
  }

  runningJob = null;
  renderQueue();
  pumpQueue();
}

// 대기열이 다 비었을 때: 진행 화면을 내리고 마지막 성공 작업의 결과를 보여준다.
function finishQueueUI() {
  progressSection.style.display = 'none';
  overallProgress.style.display = 'none';

  const lastDone = [...downloadQueue].reverse().find((j) => j.status === 'done');
  if (lastDone && lastDone.display) {
    lastDone.display(lastDone.result, lastDone.ctx);
  }
}

function renderQueue() {
  // 한 건짜리 일반 다운로드에는 패널을 보이지 않는다. 두 건째부터 대기열이 된다.
  const show = downloadQueue.length >= 2;
  queueSection.style.display = show ? 'block' : 'none';
  if (!show) return;

  const waiting = downloadQueue.filter((j) => j.status === 'waiting').length;
  queueCount.textContent = waiting ? `— ${waiting}개 대기` : '';

  const stText = { waiting: '대기', running: '진행 중', done: '완료', failed: '실패', cancelled: '취소' };
  queueItems.innerHTML = '';
  for (const job of downloadQueue) {
    const row = document.createElement('div');
    row.className = 'queue-row';

    const label = document.createElement('div');
    label.className = 'queue-row-label';
    label.textContent = job.label;
    label.title = job.label;

    const st = document.createElement('span');
    st.className = `queue-row-status st-${job.status}`;
    st.textContent = stText[job.status] || job.status;

    row.append(label, st);

    if (job.status === 'waiting') {
      const rm = document.createElement('button');
      rm.className = 'queue-row-remove';
      rm.textContent = '✕';
      rm.title = '대기열에서 제거';
      rm.addEventListener('click', () => {
        job.status = 'cancelled';
        renderQueue();
      });
      row.append(rm);
    }

    queueItems.appendChild(row);
  }
}

function clearWaitingJobs() {
  let n = 0;
  for (const job of downloadQueue) {
    if (job.status === 'waiting') { job.status = 'cancelled'; n += 1; }
  }
  renderQueue();
  if (n) showToast(`대기 중이던 ${n}개를 뺐습니다. 진행 중인 항목은 계속됩니다.`, 'info');
}

// ─── Download (single video) ───

function startDownload() {
  const url = urlInput.value.trim();
  if (!url || !currentVideoInfo) return;

  let section = null;
  if (clipEnable.checked) {
    section = readClipSection();
    if (!section) return;
  }

  const ctx = {
    kind: 'video',
    itemCount: 1,
    title: currentVideoInfo.title || url,
    subtitles: section ? false : subEnable.checked,
    qualityLabel: qualitySelect.options[qualitySelect.selectedIndex]?.text || '',
  };

  const quality = qualitySelect.value;
  const params = {
    url,
    quality: quality === 'best' ? 'best' : parseInt(quality),
    outputDir: downloadPath,
    subtitles: getSubtitleOptions(subEnable),
    codecMode: codecMode.value,
    skipExisting: skipExisting.checked,
    section,
  };

  enqueueDownload({
    label: section
      ? `${ctx.title} (구간 ${clipStart.value.trim()}~${clipEnd.value.trim() || '끝'})`
      : ctx.title,
    ctx,
    run: () => electronAPI.downloadVideo(params),
    onDone: (result, jctx) => {
      if (result.alreadyDownloaded) {
        showToast(`이미 받은 영상이라 건너뛰었습니다: ${jctx.title}`, 'info');
        return;
      }
      addToHistory({
        title: jctx.title,
        filePath: result.filePath,
        quality: jctx.qualityLabel,
        timestamp: Date.now(),
      });
      showToast('다운로드가 완료되었습니다!', 'success');
    },
    display: (result, jctx) => {
      if (result.alreadyDownloaded) return;
      displayVideoComplete(result, jctx);
    },
  });
}

function displayVideoComplete(result, ctx) {
  completeSection.style.display = 'block';
  lastCompletedPath = result.filePath || '';
  downloadedVideoPath = result.filePath || '';
  updatePolyglotButton(result.filePath);

  const filename = result.filePath ? result.filePath.split(/[\\/]/).pop() : 'video.mp4';
  completeFilename.textContent = filename;

  const subLabel = describeSubtitles(result.subtitleFiles);
  if (ctx.subtitles) {
    completeSummary.style.display = 'block';
    summaryFailedList.style.display = 'none';

    if (subLabel) {
      summaryOk.textContent = subLabel;
      summaryFail.style.display = 'none';
    } else if (result.subtitleFailed) {
      // 자막이 없는 것과 자막 요청이 실패한 것은 다르다. 후자는 다시 받으면 될 수 있다.
      summaryOk.textContent = '영상 저장 완료';
      summaryFail.style.display = 'inline-block';
      summaryFail.textContent = '자막 받기 실패 (잠시 후 다시 시도해보세요)';
    } else {
      summaryOk.textContent = '영어 자막이 없는 영상입니다';
      summaryFail.style.display = 'none';
    }
  } else {
    completeSummary.style.display = 'none';
  }
}

// ─── Download Playlist ───

function startPlaylistDownload() {
  if (!currentPlaylist) return;

  const items = getSelectedIndices();
  if (items.length === 0) {
    showToast('다운로드할 영상을 선택해주세요.', 'warning');
    return;
  }

  const ctx = {
    kind: 'playlist',
    itemCount: items.length,
    playlistTitle: currentPlaylist.playlistTitle,
    entries: currentPlaylist.entries,
    selection: items,
    qualityLabel: plQualitySelect.options[plQualitySelect.selectedIndex]?.text || '',
  };

  const quality = plQualitySelect.value;
  const params = {
    url: currentPlaylist.url,
    quality: quality === 'best' ? 'best' : parseInt(quality),
    outputDir: downloadPath,
    items,
    subtitles: getSubtitleOptions(plSubEnable),
    codecMode: plCodecMode.value,
    skipExisting: plSkipExisting.checked,
  };

  enqueueDownload({
    label: `${ctx.playlistTitle} (${items.length}개)`,
    ctx,
    run: () => electronAPI.downloadPlaylist(params),
    onDone: (result, jctx) => {
      addToHistory({
        title: `${jctx.playlistTitle} (${result.completed.length}개)`,
        filePath: result.folder || downloadPath,
        quality: jctx.qualityLabel,
        timestamp: Date.now(),
        isPlaylist: true,
      });
      showToast(
        result.failed.length > 0
          ? `${result.total}개 중 ${result.completed.length}개 완료 (${result.failed.length}개 실패)`
          : `${result.completed.length}개 모두 다운로드했습니다!`,
        result.failed.length > 0 ? 'warning' : 'success'
      );
    },
    display: (result, jctx) => displayBatchComplete(result, jctx),
  });
}

// ─── Download Selected Search Results ───

function startSearchDownload() {
  const videos = getSelectedSearchVideos();
  if (videos.length === 0) {
    showToast('다운로드할 영상을 선택해주세요.', 'warning');
    return;
  }

  const ctx = {
    kind: 'videos',
    itemCount: videos.length,
    selection: videos,
    qualityLabel: srQualitySelect.options[srQualitySelect.selectedIndex]?.text || '',
  };

  const quality = srQualitySelect.value;
  const params = {
    videos: videos.map((v) => ({ url: v.url, title: v.title })),
    quality: quality === 'best' ? 'best' : parseInt(quality),
    outputDir: downloadPath,
    subtitles: getSubtitleOptions(srSubEnable),
    codecMode: srCodecMode.value,
    skipExisting: srSkipExisting.checked,
  };

  enqueueDownload({
    label: videos.length === 1 ? videos[0].title : `검색 결과 ${videos.length}개`,
    ctx,
    run: () => electronAPI.downloadVideos(params),
    onDone: (result, jctx) => {
      addToHistory({
        title:
          result.completed.length === 1
            ? jctx.selection[0]?.title || '검색 결과'
            : `검색 결과 ${result.completed.length}개`,
        filePath: result.completed.length === 1 ? result.completed[0].filePath : (result.folder || downloadPath),
        quality: jctx.qualityLabel,
        timestamp: Date.now(),
      });
      showToast(
        result.failed.length > 0
          ? `${result.total}개 중 ${result.completed.length}개 완료 (${result.failed.length}개 실패)`
          : `${result.completed.length}개 모두 다운로드했습니다!`,
        result.failed.length > 0 ? 'warning' : 'success'
      );
    },
    display: (result, jctx) => displayBatchComplete(result, jctx),
  });
}

// 재생목록/검색 일괄 다운로드의 완료 화면. 실패 목록 표기만 종류별로 다르다.
function displayBatchComplete(result, ctx) {
  completeSection.style.display = 'block';
  updatePolyglotButton(null); // 일괄 다운로드는 넘길 단일 대상이 없다.

  const folder = result.folder || downloadPath;
  lastCompletedPath = result.completed.length === 1 ? result.completed[0].filePath : folder;
  // 여러 개를 받았으면 폴더라 변환 대상이 없다. 한 개일 때만 만들기 소스로 잡는다.
  downloadedVideoPath = result.completed.length === 1 ? result.completed[0].filePath : '';

  completeFilename.textContent =
    result.completed.length === 1
      ? result.completed[0].filePath.split(/[\\/]/).pop()
      : ctx.kind === 'playlist'
        ? folder.split(/[\\/]/).pop()
        : `${folder.split(/[\\/]/).pop()} 폴더에 ${result.completed.length}개`;

  completeSummary.style.display = 'block';
  const subLabel = describeSubtitles(result.subtitleFiles);
  summaryOk.textContent = subLabel
    ? `${result.completed.length}개 성공 · ${subLabel}`
    : `${result.completed.length}개 성공`;

  if (result.failed.length > 0) {
    summaryFail.style.display = 'inline-block';
    summaryFail.textContent = `${result.failed.length}개 실패`;
    summaryFailedList.style.display = 'block';
    summaryFailedList.innerHTML = '';
    for (const f of result.failed) {
      const line = document.createElement('div');
      if (ctx.kind === 'playlist') {
        const entry = ctx.entries.find((e) => e.playlistIndex === f);
        line.textContent = `${f}. ${entry ? entry.title : '알 수 없는 영상'}`;
      } else {
        line.textContent = f.title || `${f.position}번째 영상`;
      }
      summaryFailedList.appendChild(line);
    }
  } else {
    summaryFail.style.display = 'none';
    summaryFailedList.style.display = 'none';
  }
}

// ─── Handle Progress ───

function handleProgress(data) {
  // 취소 직후 등, 돌고 있는 작업이 없을 때 도착한 늦은 이벤트는 버린다.
  if (!runningJob) return;

  const percent = Math.min(data.percent, 100);
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent.toFixed(1)}%`;

  // itemTotal이 있으면 여러 개짜리 다운로드다. 전체 진행바를 함께 갱신한다.
  if (data.itemTotal) {
    const done = data.itemIndex - 1;
    const overall = ((done + percent / 100) / data.itemTotal) * 100;
    overallFill.style.width = `${Math.min(overall, 100)}%`;
    overallCount.textContent = `${done} / ${data.itemTotal}`;

    // 실행 중인 작업의 스냅샷에서 제목을 되짚는다. 전역 상태는 그 사이 바뀌었을 수 있다.
    const ctx = runningJob.ctx;
    let entry = null;
    if (ctx.kind === 'playlist') {
      entry = ctx.entries.find((e) => e.playlistIndex === ctx.selection[data.itemIndex - 1]);
    } else if (ctx.kind === 'videos') {
      entry = ctx.selection[data.itemIndex - 1];
    }
    overallCurrent.textContent = entry
      ? `${data.itemIndex}번째: ${entry.title}`
      : `${data.itemIndex}번째 영상 처리 중`;
  }

  if (percent >= 99 || data.eta === '병합 중...') {
    setPipelineStep(3);
    progressTitle.textContent = 'MP4 고화질 스트림 병합 중...';
    statEta.textContent = '병합 중';
  } else if (percent > 0) {
    setPipelineStep(2);
    progressTitle.textContent = '고화질 미디어 스트림 다운로드 중...';
  }

  if (data.speed) statSpeed.textContent = data.speed;
  if (data.totalSize) statSize.textContent = data.totalSize;
  if (data.eta && data.eta !== '병합 중...') statEta.textContent = data.eta;
}

function updateStat(el, value) {
  const svg = el.querySelector('svg');
  const svgHtml = svg ? svg.outerHTML : '';
  el.innerHTML = `${svgHtml} ${value}`;
}

// ─── Cancel Download ───

// 진행 중인 항목 하나만 취소한다. 대기 중인 항목은 계속 진행되고,
// 그것까지 멈추려면 대기열 패널의 "대기 목록 비우기"를 쓴다.
function cancelDownload() {
  // 변환 중이면 변환을 멈춘다(다운로드와 별개 프로세스).
  if (!runningJob) {
    electronAPI.cancelConvert();
    hideConvertProgress();
    showToast('만들기를 취소했습니다.', 'warning');
    return;
  }
  runningJob.cancelRequested = true;
  electronAPI.cancelDownload();

  const remaining = downloadQueue.filter((j) => j.status === 'waiting').length;
  showToast(
    remaining > 0
      ? `현재 항목을 취소했습니다. 대기 중인 ${remaining}개는 이어서 받습니다.`
      : '다운로드가 취소되었습니다.',
    'warning'
  );
}

// ─── Clipboard Watch ───

function handleClipboardUrl(url) {
  if (!settings.clipboardWatch) return;
  if (btnFetch.disabled) return;               // 이미 조회 중이면 방해하지 않는다
  if (urlInput.value.trim() === url) return;   // 직접 붙여넣은 경우와 중복 방지
  urlInput.value = url;
  showToast('복사한 유튜브 주소를 불러왔습니다.', 'info');
  fetchVideoInfo();
}

// ─── Make (변환) ───
//
// 완료 화면의 결과 파일(lastCompletedPath)을 입력으로 삼는다. 재생목록/검색으로 여러 개를
// 받은 경우 lastCompletedPath가 폴더일 수 있으므로, 단일 파일일 때만 열어준다.

// 만들기의 소스는 항상 "다운로드된 원본 영상"이다. 변환 결과물(GIF/세로 등)로
// 소스가 바뀌면 [거울][세로][...]처럼 파일명이 누적되고 의도와 다르게 연쇄된다.
// 그래서 다운로드 완료 시점의 영상 경로를 따로 잡아두고 그것만 소스로 쓴다.
let downloadedVideoPath = '';
let makeSourcePath = '';
let selectedMakeType = '';

function openMakePanel() {
  const src = downloadedVideoPath;
  // .mp4 하나가 아니면(폴더 등) 변환 대상이 아니다.
  if (!/\.(mp4|mkv|webm|mov)$/i.test(src) || !src) {
    showToast('변환은 영상 파일 하나를 받았을 때 쓸 수 있습니다.', 'warning');
    return;
  }
  makeSourcePath = src;
  makeSourceTitle.textContent = src.split(/[\\/]/).pop();
  selectedMakeType = '';
  makeOptions.style.display = 'none';
  for (const c of document.querySelectorAll('.make-card')) c.classList.remove('is-selected');
  makeSection.style.display = 'block';
  makeSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectMakeType(type) {
  selectedMakeType = type;
  for (const c of document.querySelectorAll('.make-card')) {
    c.classList.toggle('is-selected', c.dataset.make === type);
  }
  makeOptions.style.display = 'block';
  makeOptGif.style.display = type === 'gif' ? 'block' : 'none';
  makeOptMirror.style.display = type === 'mirror' ? 'block' : 'none';

  const notes = {
    vertical: '가로 영상을 9:16 세로로 바꿉니다. 배경은 흐린 원본으로 채웁니다. 옵션은 없습니다.',
    slides: '화면이 크게 바뀌는 장면들을 찾아 PDF로 묶습니다. 강의·회의 녹화에 좋습니다.',
    storyboard: '영상 전체를 한 장의 격자 이미지로 요약합니다. 내용을 한눈에 볼 수 있습니다.',
  };
  const hasNote = type in notes;
  makeOptNote.style.display = hasNote ? 'block' : 'none';
  if (hasNote) makeOptNoteText.textContent = notes[type];

  const labels = {
    gif: 'GIF 만들기', mirror: '거울 영상 만들기', vertical: '세로 영상 만들기',
    slides: '슬라이드 PDF 만들기', storyboard: '장면 미리보기 만들기',
  };
  btnMakeRunLabel.textContent = labels[type] || '만들기';
}

async function runMake() {
  if (!selectedMakeType || !makeSourcePath) return;

  // 진행 표시는 다운로드용 진행 화면을 재활용한다. 단, 러너가 안 돌 때만.
  if (runningJob) {
    showToast('다운로드가 끝난 뒤에 변환해주세요.', 'warning');
    return;
  }

  let call;
  if (selectedMakeType === 'gif') {
    const start = parseTimeInput(makeGifStart.value);
    if (start === null) {
      makeGifStart.classList.add('is-invalid');
      showToast('시작 시간을 "0:10" 형식으로 입력해주세요.', 'warning');
      return;
    }
    makeGifStart.classList.remove('is-invalid');
    const end = makeGifEnd.value.trim() ? parseTimeInput(makeGifEnd.value) : null;
    if (makeGifEnd.value.trim() && (end === null || end <= start)) {
      makeGifEnd.classList.add('is-invalid');
      showToast('끝 시간이 시작보다 뒤여야 합니다. 비우면 시작부터 몇 초만 받습니다.', 'warning');
      return;
    }
    makeGifEnd.classList.remove('is-invalid');
    call = () => electronAPI.makeGif({ inputPath: makeSourcePath, start, end });
  } else if (selectedMakeType === 'mirror') {
    const mode = document.querySelector('input[name="mirror-mode"]:checked')?.value || 'flip';
    call = () => electronAPI.makeMirror({ inputPath: makeSourcePath, mode });
  } else if (selectedMakeType === 'vertical') {
    call = () => electronAPI.makeVertical({ inputPath: makeSourcePath });
  } else if (selectedMakeType === 'slides') {
    call = () => electronAPI.makeSlides({ inputPath: makeSourcePath });
  } else if (selectedMakeType === 'storyboard') {
    call = () => electronAPI.makeStoryboard({ inputPath: makeSourcePath });
  }

  makeSection.style.display = 'none';
  showConvertProgress();

  try {
    const result = await call();
    hideConvertProgress();
    showMakeComplete(result.outputPath, selectedMakeType, result);
  } catch (error) {
    hideConvertProgress();
    showToast(`만들기 실패: ${String(error.message).slice(0, 100)}`, 'error');
    makeSection.style.display = 'block';
  }
}

function showConvertProgress() {
  progressSection.style.display = 'block';
  completeSection.style.display = 'none';
  overallProgress.style.display = 'none';
  setPipelineStep(2);
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressTitle.textContent = '만드는 중...';
  statSpeed.textContent = '--';
  statSize.textContent = '--';
  statEta.textContent = '--';
}

function hideConvertProgress() {
  progressSection.style.display = 'none';
}

function handleConvertProgress(data) {
  const percent = Math.min(data.percent || 0, 99);
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent.toFixed(0)}%`;
  if (data.label) progressTitle.textContent = data.label + '...';
}

function showMakeComplete(outputPath, type, result) {
  completeSection.style.display = 'block';
  completeSummary.style.display = 'none';
  setPipelineStep(4);
  lastCompletedPath = outputPath;
  updatePolyglotButton(outputPath); // 거울·세로 등 영상 결과만 보이고, GIF·PDF·이미지는 숨는다.

  completeFilename.textContent = outputPath.split(/[\\/]/).pop();

  let msg = '만들기가 완료되었습니다!';
  if (type === 'slides' && result.slideCount) msg = `슬라이드 ${result.slideCount}장으로 PDF를 만들었습니다.`;
  else if (type === 'gif') msg = 'GIF를 만들었습니다.';
  else if (type === 'mirror') msg = '거울 영상을 만들었습니다.';
  else if (type === 'vertical') msg = '세로 영상을 만들었습니다.';
  else if (type === 'storyboard') msg = '장면 미리보기를 만들었습니다.';
  showToast(msg, 'success');

  addToHistory({
    title: outputPath.split(/[\\/]/).pop(),
    filePath: outputPath,
    quality: '만들기',
    timestamp: Date.now(),
  });
}

// ─── Reset ───

function resetToInput() {
  completeSection.style.display = 'none';
  makeSection.style.display = 'none';
  // 다운로드가 돌고 있으면 진행 화면은 러너의 것이다. 건드리지 않는다.
  if (!runningJob) {
    progressSection.style.display = 'none';
    overallProgress.style.display = 'none';
  }
  videoInfoSection.style.display = 'none';
  playlistSection.style.display = 'none';
  searchSection.style.display = 'none';
  urlInput.value = '';
  urlInput.focus();
  currentVideoInfo = null;
  currentPlaylist = null;
  currentSearch = null;
}

// ─── History Management ───

function addToHistory(item) {
  downloadHistory.unshift(item);
  if (downloadHistory.length > 50) downloadHistory = downloadHistory.slice(0, 50);
  localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
  renderHistory();
}

function clearHistory() {
  downloadHistory = [];
  localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
  renderHistory();
  showToast('다운로드 이력이 지워졌습니다.', 'success');
}

function renderHistory() {
  // Remove existing items (keep empty placeholder)
  const existingItems = historyList.querySelectorAll('.history-item');
  existingItems.forEach((item) => item.remove());

  if (downloadHistory.length === 0) {
    historyEmpty.style.display = 'flex';
    return;
  }

  historyEmpty.style.display = 'none';

  for (const item of downloadHistory) {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div class="history-item-icon">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" stroke="currentColor" stroke-width="2"/>
          <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2"/>
        </svg>
      </div>
      <div class="history-item-info">
        <div class="history-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="history-item-meta">
          <span>${item.quality || 'MP4'}</span>
          <span>${formatDate(item.timestamp)}</span>
        </div>
      </div>
      <button class="history-item-action" title="폴더에서 열기">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `;

    // Click to show in folder
    const actionBtn = el.querySelector('.history-item-action');
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.filePath) {
        reportOpenResult(electronAPI.showItemInFolder(item.filePath));
      }
    });

    // Click item to open file
    el.addEventListener('click', () => {
      if (item.filePath) {
        reportOpenResult(electronAPI.openFile(item.filePath));
      }
    });

    historyList.appendChild(el);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Start ───
init();
