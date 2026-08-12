const { app, BrowserWindow, ipcMain, dialog, shell, screen, clipboard } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const { StringDecoder } = require('string_decoder');

let mainWindow;

// 어느 PC에서 열어도 같은 모습이 되도록 목표 크기를 정해두되, 화면 밖으로 나가지 않게
// 실제 작업 영역에 맞춰 줄인다. 학교 노트북(1366x768)은 작업 영역 높이가 약 728px이라
// 720 높이 창이 작업 표시줄에 걸린다. 최소 크기도 함께 낮추지 않으면 Electron이
// 최소 크기를 우선해 창이 화면 밖으로 밀려난다.
const TARGET_WIDTH = 900;
const TARGET_HEIGHT = 720;
const SCREEN_MARGIN = 48;

function getInitialWindowSize() {
  try {
    const { workAreaSize } = screen.getPrimaryDisplay();
    return {
      width: Math.max(640, Math.min(TARGET_WIDTH, workAreaSize.width - SCREEN_MARGIN)),
      height: Math.max(520, Math.min(TARGET_HEIGHT, workAreaSize.height - SCREEN_MARGIN)),
    };
  } catch (e) {
    return { width: TARGET_WIDTH, height: TARGET_HEIGHT };
  }
}

function createWindow() {
  const { width, height } = getInitialWindowSize();
  console.log(`[window] size ${width}x${height}`);

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(800, width),
    minHeight: Math.min(600, height),
    center: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(fs.existsSync(path.join(__dirname, 'icon.ico')) && { icon: path.join(__dirname, 'icon.ico') }),
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Clipboard Watch ───
// 다른 프로그램에서 유튜브 주소를 복사하면 렌더러에 알려준다. 켜고 끄는 판단은
// 렌더러(설정)가 하고, 여기서는 "바뀐 텍스트가 유튜브 주소인가"만 본다.
const CLIPBOARD_YT_RE = /^https?:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/\S+$/i;
let lastClipboardText = null;

function startClipboardWatch() {
  // 시작 시점에 이미 들어있던 텍스트로는 반응하지 않는다(언제 복사한 것인지 모른다).
  try { lastClipboardText = clipboard.readText(); } catch (e) { lastClipboardText = ''; }

  setInterval(() => {
    if (!mainWindow) return;
    let text;
    try { text = clipboard.readText(); } catch (e) { return; }
    if (text === lastClipboardText) return;
    lastClipboardText = text;

    const trimmed = (text || '').trim();
    if (CLIPBOARD_YT_RE.test(trimmed)) {
      mainWindow.webContents.send('clipboard-url', trimmed);
    }
  }, 1200);
}

app.whenReady().then(() => {
  // 창을 띄우기 전에 엔진 사본을 준비해야 이후 getBinPaths()가 갱신 가능한 쪽을 가리킨다.
  ensureWritableEngine();
  createWindow();
  startClipboardWatch();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ─── Window Controls ───

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (currentDownloadProc) {
    try {
      currentDownloadProc.kill('SIGKILL');
    } catch (e) {}
    currentDownloadProc = null;
  }
  if (mainWindow) {
    mainWindow.destroy();
  }
  app.quit();
});

// ─── Dependency & Binary Resolver ───

const YTDLP_EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const FFMPEG_EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

// 번들된 엔진은 설치 폴더에 있어 쓰기 권한이 없을 수 있다(사용자가 Program Files를
// 설치 위치로 고른 경우). 유튜브 차단에 대응하려면 엔진을 계속 갱신할 수 있어야 하므로,
// 항상 쓰기 가능한 userData 아래 사본을 만들어 그쪽을 사용한다.
function getBundledBinDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, 'bin');
}

function getUserBinDir() {
  return path.join(app.getPath('userData'), 'bin');
}

// 첫 실행 시 번들 엔진을 쓰기 가능한 위치로 복사한다. 이미 있으면 건드리지 않는다
// (그쪽이 업데이트로 더 최신일 수 있으므로 덮어쓰면 안 된다).
function ensureWritableEngine() {
  const bundled = path.join(getBundledBinDir(), YTDLP_EXE);
  const userDir = getUserBinDir();
  const target = path.join(userDir, YTDLP_EXE);

  try {
    if (fs.existsSync(target)) return target;
    if (!fs.existsSync(bundled)) return null;

    fs.mkdirSync(userDir, { recursive: true });
    fs.copyFileSync(bundled, target);
    console.log('[engine] Copied bundled yt-dlp to writable location:', target);
    return target;
  } catch (e) {
    // 복사에 실패해도 번들 엔진으로 계속 동작해야 한다. 업데이트만 불가능해질 뿐이다.
    console.warn('[engine] Could not prepare writable engine:', e.message);
    return null;
  }
}

function getBinPaths() {
  const bundledDir = getBundledBinDir();
  const bundledYtDlp = path.join(bundledDir, YTDLP_EXE);
  const userYtDlp = path.join(getUserBinDir(), YTDLP_EXE);

  // 갱신 가능한 사본이 있으면 그것을 우선한다.
  const ytDlp = fs.existsSync(userYtDlp)
    ? userYtDlp
    : (fs.existsSync(bundledYtDlp) ? bundledYtDlp : null);

  const localFfmpeg = path.join(bundledDir, FFMPEG_EXE);
  const hasLocalFfmpeg = fs.existsSync(localFfmpeg);

  return {
    ytDlpPath: ytDlp || 'yt-dlp',
    ffmpegPath: hasLocalFfmpeg ? localFfmpeg : 'ffmpeg',
    hasLocalYtDlp: !!ytDlp,
    hasLocalFfmpeg,
    isUpdatable: ytDlp === userYtDlp,
  };
}

// yt-dlp는 유튜브 서명 해독에 JS 런타임을 요구하고, 기본값인 deno는 대개 설치돼 있지 않다.
// 시스템 node에 의존하면 Node가 없는 PC(학교 컴퓨터 등)에서 포맷 추출이 실패한다.
// Electron 실행 파일 자체가 ELECTRON_RUN_AS_NODE=1로 Node가 되므로 그것을 쓴다.
function getJsRuntimeArgs() {
  return ['--js-runtimes', `node:${process.execPath}`];
}

// 위 런타임 지정이 동작하려면 자식 프로세스 환경에 이 변수가 있어야 한다.
function getSpawnEnv() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
}

// 자식 프로세스의 출력은 임의의 바이트 위치에서 잘려 도착한다. 조각마다 Buffer.toString()을
// 부르면 여러 바이트로 이뤄진 글자(한글, → 등)가 경계에서 깨진다. 실측으로 파일명 하나에서
// 자를 수 있는 위치의 58%가 깨졌다. StringDecoder는 잘린 바이트를 다음 조각까지 물고 있는다.
//
// 줄 단위로도 같은 문제가 있다. 한 줄이 두 조각에 걸치면 양쪽 다 정규식에 안 걸려 진행률이나
// 파일 경로를 놓친다. 마지막 조각을 버퍼에 남겨 다음 청크와 이어붙인다.
function readLines(stream, onLine) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  stream.on('data', (chunk) => {
    pending += decoder.write(chunk);
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) onLine(line);
  });
  stream.on('end', () => {
    pending += decoder.end();
    if (pending) onLine(pending);
  });
}

function readText(stream, onText) {
  const decoder = new StringDecoder('utf8');
  stream.on('data', (chunk) => onText(decoder.write(chunk)));
  stream.on('end', () => {
    const rest = decoder.end();
    if (rest) onText(rest);
  });
}

function spawnYtDlp(args, options = {}) {
  const { ytDlpPath } = getBinPaths();
  // 윈도우에서 yt-dlp는 기본적으로 시스템 코드페이지(한국어면 CP949)로 표준출력을 쓴다.
  // Node는 UTF-8로 해석하므로, 파일명에 한글이나 → 같은 문자가 있으면 경로가 깨져
  // "파일 열기"가 없는 경로를 가리키게 된다. 출력 인코딩을 UTF-8로 고정한다.
  // (PYTHONIOENCODING은 PyInstaller로 묶인 실행 파일에서 효과가 없어 쓸 수 없다.)
  return spawn(ytDlpPath, ['--encoding', 'utf-8', ...args], {
    windowsHide: true,
    env: getSpawnEnv(),
    ...options,
  });
}

function findExecutable(name) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, [name], (error, stdout) => {
      if (error) {
        resolve(null);
      } else {
        resolve(stdout.trim().split('\n')[0].trim());
      }
    });
  });
}

ipcMain.handle('check-dependencies', async () => {
  const { ytDlpPath, ffmpegPath, hasLocalYtDlp, hasLocalFfmpeg } = getBinPaths();
  const ytdlp = hasLocalYtDlp ? ytDlpPath : await findExecutable('yt-dlp');
  const ffmpeg = hasLocalFfmpeg ? ffmpegPath : await findExecutable('ffmpeg');
  return {
    ytdlp: !!ytdlp,
    ffmpeg: !!ffmpeg,
    ytdlpPath: ytdlp,
    ffmpegPath: ffmpeg,
  };
});

// ─── Engine Version & Update ───

// 사용자가 고른 채널을 기억해야 한다. yt-dlp의 -U는 "현재 채널 안에서" 갱신하므로,
// 채널을 명시하지 않으면 nightly로 옮긴 사용자가 시작 시 자동 갱신에 휩쓸려
// 의도치 않게 채널이 고정되거나 되돌아간다.
function getEngineConfigPath() {
  return path.join(app.getPath('userData'), 'engine.json');
}

function readEngineChannel() {
  try {
    const cfg = JSON.parse(fs.readFileSync(getEngineConfigPath(), 'utf8'));
    return cfg.channel === 'nightly' ? 'nightly' : 'stable';
  } catch (e) {
    return 'stable';
  }
}

function writeEngineChannel(channel) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getEngineConfigPath(), JSON.stringify({ channel }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[engine] Could not persist channel:', e.message);
  }
}

// yt-dlp 출력의 "stable@2026.07.04 from yt-dlp/yt-dlp" 형태에서 실제 적용된 채널을 읽는다.
// 우리가 요청한 값이 아니라 실제 결과를 신뢰한다.
function parseChannelFromOutput(output) {
  const matches = [...output.matchAll(/\b(stable|nightly|master)@/gi)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1].toLowerCase();
}

function runYtDlp(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnYtDlp(args);
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      resolve({ code: -1, stdout, stderr: stderr || '시간 초과' });
    }, timeoutMs);

    readText(proc.stdout, (t) => { stdout += t; });
    readText(proc.stderr, (t) => { stderr += t; });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}

ipcMain.handle('get-engine-info', async () => {
  const { ytDlpPath, isUpdatable } = getBinPaths();
  const { code, stdout } = await runYtDlp(['--version'], 30000);
  return {
    version: code === 0 ? stdout : null,
    path: ytDlpPath,
    updatable: isUpdatable,
    channel: readEngineChannel(),
  };
});

// channel을 생략하면 사용자가 마지막으로 고른 채널을 유지한다(시작 시 자동 갱신이 이 경로).
// -U 대신 항상 --update-to CHANNEL@latest 를 쓴다. -U는 현재 채널 안에서만 움직여서
// nightly에서 안정판으로 되돌아올 수 없기 때문이다.
ipcMain.handle('update-engine', async (event, { channel } = {}) => {
  const { isUpdatable } = getBinPaths();
  if (!isUpdatable) {
    return {
      ok: false,
      message: '엔진을 쓰기 가능한 위치에 준비하지 못해 업데이트할 수 없습니다.',
      channel: readEngineChannel(),
    };
  }

  const target = channel === 'nightly' ? 'nightly' : (channel === 'stable' ? 'stable' : readEngineChannel());

  const before = (await runYtDlp(['--version'], 30000)).stdout;
  const { code, stdout, stderr } = await runYtDlp(['--update-to', `${target}@latest`], 300000);
  const after = (await runYtDlp(['--version'], 30000)).stdout;

  const output = `${stdout}\n${stderr}`.trim();
  // 요청한 채널이 아니라 yt-dlp가 실제로 적용한 채널을 신뢰한다.
  const actualChannel = parseChannelFromOutput(output) || target;
  console.log(`[engine] update(${target}) code=${code} ${before} -> ${after} actual=${actualChannel}`);

  // yt-dlp는 "이미 최신"일 때도 0을 반환한다. 버전 변화로 실제 갱신 여부를 판단한다.
  if (code !== 0 && before === after) {
    return {
      ok: false,
      message: output || '업데이트에 실패했습니다.',
      version: after,
      channel: readEngineChannel(),
    };
  }

  writeEngineChannel(actualChannel);

  return {
    ok: true,
    changed: before !== after,
    previousVersion: before,
    version: after,
    channel: actualChannel,
    message: output,
  };
});

// ─── Select Directory ───

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '다운로드 폴더 선택',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ─── Get Default Download Path ───

ipcMain.handle('get-default-download-path', () => {
  return path.join(os.homedir(), 'Downloads');
});

// 저장해둔 폴더가 지워졌거나 USB가 빠졌을 수 있다. 되살리기 전에 확인한다.
ipcMain.handle('path-exists', (event, p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch (e) {
    return false;
  }
});

// ─── Get Video Info ───

ipcMain.handle('get-video-info', async (event, url) => {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      ...getJsRuntimeArgs(),
      url,
    ];

    const proc = spawnYtDlp(args);

    let stdout = '';
    let stderr = '';

    readText(proc.stdout, (t) => { stdout += t; });
    readText(proc.stderr, (t) => { stderr += t; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        
        // Extract available formats (video+audio mp4 or best merged)
        const formats = [];
        const seenQualities = new Set();

        if (info.formats) {
          for (const f of info.formats) {
            // Only include formats with video
            if (f.vcodec && f.vcodec !== 'none' && f.height) {
              const label = `${f.height}p`;
              if (!seenQualities.has(label)) {
                seenQualities.add(label);
                formats.push({
                  formatId: f.format_id,
                  quality: label,
                  height: f.height,
                  ext: f.ext,
                  filesize: f.filesize || f.filesize_approx || 0,
                });
              }
            }
          }
        }

        // Sort by resolution (descending)
        formats.sort((a, b) => b.height - a.height);

        // Remove duplicates and keep best ones
        const uniqueFormats = [];
        const heights = new Set();
        for (const f of formats) {
          if (!heights.has(f.height)) {
            heights.add(f.height);
            uniqueFormats.push(f);
          }
        }

        resolve({
          title: info.title || 'Unknown',
          thumbnail: info.thumbnail || '',
          duration: info.duration || 0,
          uploader: info.uploader || info.channel || 'Unknown',
          viewCount: info.view_count || 0,
          formats: uniqueFormats,
        });
      } catch (e) {
        reject(new Error('영상 정보를 파싱할 수 없습니다.'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp를 실행할 수 없습니다: ${err.message}`));
    });
  });
});

// ─── Get Playlist Info ───

// --flat-playlist는 영상별 개별 요청 없이 목록만 긁어오므로 1700개짜리도 1~2초면 끝난다.
// 대신 가용 화질 정보가 없어서, 화질은 renderer의 고정 드롭다운으로 고르고 yt-dlp가 영상별로 폴백한다.
ipcMain.handle('get-playlist-info', async (event, url) => {
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--dump-single-json',
      '--yes-playlist',
      '--no-warnings',
      ...getJsRuntimeArgs(),
      url,
    ];

    const proc = spawnYtDlp(args);

    let stdout = '';
    let stderr = '';

    readText(proc.stdout, (t) => { stdout += t; });
    readText(proc.stderr, (t) => { stderr += t; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        return;
      }

      let info;
      try {
        info = JSON.parse(stdout);
      } catch (e) {
        reject(new Error('재생목록 정보를 파싱할 수 없습니다.'));
        return;
      }

      if (!Array.isArray(info.entries)) {
        reject(new Error('재생목록이 아니거나 영상 목록이 비어 있습니다.'));
        return;
      }

      const entries = info.entries.map((e, i) => {
        // 비공개/삭제 영상도 자리를 차지한 채 내려온다. 순번이 밀리면 안 되므로 그대로 두고 표시만 구분한다.
        const unavailable = !e || !e.id;
        return {
          playlistIndex: i + 1,
          id: unavailable ? '' : e.id,
          title: unavailable ? '(사용할 수 없는 영상)' : (e.title || '제목 없음'),
          duration: (e && e.duration) || 0,
          thumbnail: (e && e.thumbnails && e.thumbnails.length)
            ? e.thumbnails[e.thumbnails.length - 1].url
            : '',
          unavailable,
        };
      });

      resolve({
        playlistTitle: info.title || '재생목록',
        playlistId: info.id || '',
        uploader: info.uploader || info.channel || '',
        entries,
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp를 실행할 수 없습니다: ${err.message}`));
    });
  });
});

// ─── Download Shared Helpers ───

let currentDownloadProc = null;

// 코덱을 지정하지 않으면 yt-dlp가 효율이 좋은 AV1 영상 + Opus 음성을 고른다.
// 그 조합을 mp4에 담으면 파워포인트·윈도우 기본 플레이어·편집 프로그램이 재생하지 못한다.
// codecMode:
//   'compat'  — H.264(avc1) + AAC(mp4a) 우선. 유튜브가 avc1을 1080p까지만 주므로 화질 상한이 생긴다.
//   'quality' — 코덱을 가리지 않되 음성만은 AAC를 우선한다(4K는 AV1/VP9뿐이라 선택지가 없다).
function buildFormatFilter(quality, codecMode = 'compat') {
  const hasLimit = quality && quality !== 'best' && !isNaN(quality);
  const h = hasLimit ? `[height<=${quality}]` : '';

  if (codecMode === 'quality') {
    return [
      `bestvideo${h}+bestaudio[acodec^=mp4a]`,
      `bestvideo${h}+bestaudio`,
      `best${h}`,
      'best',
    ].join('/');
  }

  return [
    // 1순위: H.264 + AAC
    `bestvideo[vcodec^=avc1]${h}+bestaudio[acodec^=mp4a]`,
    // 2순위: H.264 + 아무 음성
    `bestvideo[vcodec^=avc1]${h}+bestaudio`,
    // 3순위: H.264 단일 파일(구형 포맷 18 등)
    `best[vcodec^=avc1]${h}`,
    // H.264이 아예 없는 영상을 위한 최후 수단
    `bestvideo${h}+bestaudio[acodec^=mp4a]`,
    `bestvideo${h}+bestaudio`,
    `best${h}`,
    'best',
  ].join('/');
}

// 영상/음원 선택에 따라 달라지는 인자를 한곳에서 만든다.
// 'audio' 는 화질 개념이 없으므로 quality를 무시한다.
function buildMediaArgs(quality, codecMode) {
  if (codecMode === 'audio') {
    return [
      // AAC 계열을 우선 받아두면 mp3 변환 손실이 한 단계 줄어든다.
      '-f', 'bestaudio[acodec^=mp4a]/bestaudio/best',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
    ];
  }
  return [
    '-f', buildFormatFilter(quality, codecMode),
    '--merge-output-format', 'mp4',
  ];
}

// 구간만 잘라 받기. --force-keyframes-at-cuts 가 없으면 컷이 키프레임 위치로
// 끌려가 몇 초씩 어긋난다. 수업 발췌용이라 정확한 컷이 필요하다.
function buildSectionArgs(section) {
  if (!section || typeof section.start !== 'number') return [];
  const end = typeof section.end === 'number' ? section.end : 'inf';
  return [
    '--download-sections', `*${section.start}-${end}`,
    '--force-keyframes-at-cuts',
  ];
}

// 파일명에 붙일 구간 표기. 콜론은 윈도우 파일명에 못 쓴다.
function sectionLabel(section) {
  const fmt = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return (h ? `${h}h` : '') + `${m}m${String(sec).padStart(2, '0')}s`;
  };
  const endPart = typeof section.end === 'number' ? fmt(section.end) : 'end';
  return `${fmt(section.start)}-${endPart}`;
}

// 이미 받은 영상을 건너뛰려면 받은 목록을 파일로 남겨야 한다.
function getArchivePath() {
  return path.join(app.getPath('userData'), 'downloaded.txt');
}

function buildArchiveArgs(skipExisting) {
  return skipExisting ? ['--download-archive', getArchivePath()] : [];
}

// yt-dlp는 건너뛴 영상을 이 문구로 알린다. 아무것도 안 받았을 때
// "실패"인지 "이미 다 받은 것"인지 가르는 근거가 된다.
function isArchiveSkipLine(line) {
  return /has already been recorded in the archive/i.test(line);
}

// yt-dlp가 병합 전 임시로 만드는 조각 파일(예: video.f398.mp4)은 최종 결과물이 아니다.
function isFragmentFile(filePath) {
  return /\.f\d+\.[a-z0-9]+$/i.test(filePath);
}

// --write-subs와 --write-auto-subs를 함께 주면 yt-dlp가 알아서 제작자 자막을 우선하고
// 없을 때만 자동 생성 자막을 받는다. 둘 다 받아 중복 파일이 생기지는 않는다.
// 요청한 언어가 없는 영상은 조용히 건너뛰며 본 다운로드에는 영향을 주지 않는다.
function buildSubtitleArgs(subtitles) {
  if (!subtitles || !subtitles.enabled || !subtitles.langs) return [];
  return [
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', subtitles.langs,
    '--convert-subs', 'srt',
  ];
}

// 자막도 "[download] Destination:" 라인을 찍는다. 최종 결과 파일로 오인하면 안 된다.
function isSubtitleFile(filePath) {
  return /\.(srt|vtt|ttml|ass|lrc|srv\d|json3)$/i.test(filePath);
}

// ─── Subtitle Tidying ───
//
// 자동 생성 자막은 큐마다 앞 내용을 되풀이한다(굴러가는 자막). 그대로 두면 같은 문장이
// 계속 반복돼 읽을 수가 없다. 겹침을 걷어낸 뒤 "문장 하나 = 큐 하나 = 한 줄"로 다시 짠다.
// 구두점이 없어 문장 경계를 찾을 수 없는 자막은 손대지 않는다.

const SUB_MAX_CHARS = 140;        // 구두점이 끊기는 구간에서 큐가 무한정 길어지지 않게 하는 안전장치
const SUB_CAPPED_RATIO_LIMIT = 0.25;

function parseSrtCues(raw) {
  const cues = [];
  for (const block of raw.replace(/^﻿/, '').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '');
    const tIdx = lines.findIndex((l) => l.includes('-->'));
    if (tIdx === -1) continue;
    const m = lines[tIdx].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!m) continue;
    const ms = (h, mi, s, msec) => (+h * 3600 + +mi * 60 + +s) * 1000 + +msec;
    const text = lines.slice(tIdx + 1).join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    cues.push({ start: ms(m[1], m[2], m[3], m[4]), end: ms(m[5], m[6], m[7], m[8]), text });
  }
  return cues;
}

// 앞 큐의 꼬리와 겹치는 부분을 잘라내며 낱말을 잇는다. 낱말마다 출처 큐의 시각을 남긴다.
function stitchCueWords(cues) {
  const words = [];
  for (const c of cues) {
    const w = c.text.split(' ').filter(Boolean);
    if (!w.length) continue;
    let overlap = 0;
    for (let k = Math.min(w.length, words.length, 60); k > 0; k--) {
      let same = true;
      for (let i = 0; i < k; i++) {
        if (words[words.length - k + i].w !== w[i]) { same = false; break; }
      }
      if (same) { overlap = k; break; }
    }
    for (let i = overlap; i < w.length; i++) words.push({ w: w[i], start: c.start, end: c.end });
  }
  return words;
}

function isSentenceEndWord(word) {
  return /[.!?。！？](["'”’)\]】」』]*)$/.test(word) && !/\b\d+\.$/.test(word);
}

function groupIntoSentences(words) {
  const groups = [];
  let cur = [];
  let len = 0;
  let capped = 0;
  const flush = (byCap) => {
    if (!cur.length) return;
    if (byCap) capped += 1;
    groups.push(cur);
    cur = [];
    len = 0;
  };
  for (const item of words) {
    cur.push(item);
    len += item.w.length + 1;
    if (isSentenceEndWord(item.w)) flush(false);
    else if (len >= SUB_MAX_CHARS) flush(true);
  }
  flush(false);
  return { groups, cappedRatio: groups.length ? capped / groups.length : 0 };
}

// 문장 경계를 못 찾을 때: 원본 큐의 평균 길이를 유지하며 중복만 걷어낸다.
function regroupByOriginalLength(words, cues) {
  const avg = Math.max(12, Math.round(cues.reduce((a, c) => a + c.text.length, 0) / cues.length));
  const groups = [];
  let cur = [];
  let len = 0;
  for (const item of words) {
    cur.push(item);
    len += item.w.length + 1;
    if (len >= avg) { groups.push(cur); cur = []; len = 0; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function formatSrtTime(ms) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:` +
         `${p(Math.floor((ms % 60000) / 1000))},${p(Math.floor(ms % 1000), 3)}`;
}

function buildSrtFromGroups(groups) {
  const cues = groups.map((g) => ({
    start: g[0].start,
    end: Math.max(g[g.length - 1].end, g[0].start + 800),
    text: g.map((x) => x.w).join(' '),
  }));

  // 시간이 뒤로 가거나 겹치지 않도록 다듬는다.
  for (let i = 0; i < cues.length; i++) {
    if (i > 0 && cues[i].start < cues[i - 1].start) cues[i].start = cues[i - 1].start;
    if (i < cues.length - 1 && cues[i].end > cues[i + 1].start) {
      cues[i].end = Math.max(cues[i].start + 400, cues[i + 1].start - 1);
    }
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 800;
  }

  return cues
    .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`)
    .join('\n\n') + '\n';
}

// 손댈 이유가 없으면 null을 돌려준다(원본 유지).
function tidySrtContent(raw) {
  const cues = parseSrtCues(raw);
  if (cues.length === 0) return null;

  const words = stitchCueWords(cues);
  if (words.length === 0) return null;

  const originalWords = cues.reduce((a, c) => a + c.text.split(' ').length, 0);
  const rolling = words.length < originalWords * 0.75;

  const { groups, cappedRatio } = groupIntoSentences(words);
  const splittable = groups.length > 0 && cappedRatio <= SUB_CAPPED_RATIO_LIMIT;

  if (!splittable && !rolling) return null;

  const finalGroups = splittable ? groups : regroupByOriginalLength(words, cues);
  if (finalGroups.length === 0) return null;

  return buildSrtFromGroups(finalGroups);
}

// 실패하면 원본을 그대로 둔다. 자막 정리 때문에 다운로드가 망가져서는 안 된다.
function tidySubtitleFiles(files) {
  for (const file of files || []) {
    try {
      if (!file.toLowerCase().endsWith('.srt') || !fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const tidied = tidySrtContent(raw);
      if (!tidied) {
        console.log('[subtitle] left as-is:', path.basename(file));
        continue;
      }
      fs.writeFileSync(file, tidied, 'utf8');
      console.log('[subtitle] tidied:', path.basename(file));
    } catch (e) {
      console.warn('[subtitle] tidy failed, keeping original:', file, e.message);
    }
  }
}

// "[info] Writing video subtitles to: <path>" 라인에서 실제로 저장된 자막을 집계한다.
// 변환 후 확장자가 .srt로 바뀌므로 경로를 보정한다.
function matchSubtitleFile(line) {
  const m = line.match(/Writing video subtitles to:\s+(.+)$/);
  if (!m) return null;
  return m[1].trim().replace(/\.(vtt|ttml|srv\d|json3)$/i, '.srt');
}

function buildProgressPayload(line) {
  const detailed = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/);
  if (detailed) {
    return {
      percent: parseFloat(detailed[1]),
      totalSize: detailed[2],
      speed: detailed[3],
      eta: detailed[4],
    };
  }

  // 시작 직후에는 속도/ETA가 "Unknown"이라 위 정규식이 안 걸린다. 퍼센트만이라도 흘려보낸다.
  const simple = line.match(/\[download\]\s+([\d.]+)%/);
  if (simple) {
    return { percent: parseFloat(simple[1]), totalSize: '', speed: '', eta: '' };
  }

  return null;
}

// ─── Search Videos ───

// yt-dlp의 ytsearch 추출기를 쓰므로 YouTube Data API 키가 필요 없다.
// --flat-playlist 라서 영상별 개별 요청 없이 목록만 빠르게 받는다.
ipcMain.handle('search-videos', async (event, { query, limit = 20 }) => {
  return new Promise((resolve, reject) => {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      reject(new Error('검색어를 입력해주세요.'));
      return;
    }

    const args = [
      `ytsearch${limit}:${trimmed}`,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      ...getJsRuntimeArgs(),
    ];

    const proc = spawnYtDlp(args);

    let stdout = '';
    let stderr = '';
    readText(proc.stdout, (t) => { stdout += t; });
    readText(proc.stderr, (t) => { stderr += t; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `검색 실패 (코드: ${code})`));
        return;
      }

      let info;
      try {
        info = JSON.parse(stdout);
      } catch (e) {
        reject(new Error('검색 결과를 해석할 수 없습니다.'));
        return;
      }

      const entries = (info.entries || [])
        .filter((e) => e && e.id)
        .map((e) => ({
          id: e.id,
          url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
          title: e.title || '제목 없음',
          duration: e.duration || 0,
          channel: e.channel || e.uploader || '',
          viewCount: e.view_count || 0,
          // 마지막 항목이 가장 큰 썸네일이다.
          thumbnail: (e.thumbnails && e.thumbnails.length)
            ? e.thumbnails[e.thumbnails.length - 1].url
            : '',
          isLive: e.live_status === 'is_live',
        }));

      resolve({ query: trimmed, entries });
    });

    proc.on('error', (err) => {
      reject(new Error(`검색을 실행할 수 없습니다: ${err.message}`));
    });
  });
});

// ─── Download Video ───

ipcMain.handle('download-video', async (event, { url, quality, outputDir, subtitles, codecMode, skipExisting, section }) => {
  return new Promise((resolve, reject) => {
    if (currentDownloadProc) {
      // 렌더러 대기열이 직렬화하지만, 혹시라도 겹치면 진행 중인 프로세스 추적이 망가진다.
      reject(new Error('이미 다른 다운로드가 진행 중입니다.'));
      return;
    }

    const { ytDlpPath, ffmpegPath, hasLocalFfmpeg } = getBinPaths();

    const useSection = section && typeof section.start === 'number';
    // 구간 파일은 전체 파일과 이름이 겹치면 안 되고, 무엇을 잘랐는지 이름에 남아야 한다.
    const outputTemplate = path.join(
      outputDir,
      useSection ? `%(title)s [${sectionLabel(section)}].%(ext)s` : '%(title)s.%(ext)s'
    );

    const args = [
      ...buildMediaArgs(quality, codecMode),
      // 구간 모드에서는 아카이브를 쓰지 않는다. 전체 영상을 받은 기록 때문에 구간이
      // 건너뛰어지고, 반대로 구간 기록 때문에 나중에 전체 다운로드가 막히기 때문이다.
      ...(useSection ? [] : buildArchiveArgs(skipExisting)),
      ...buildSectionArgs(useSection ? section : null),
      '--newline',
      '--progress',
      '-o', outputTemplate,
      '--no-playlist',
      // 자막을 못 받았다고 영상까지 버려서는 안 된다. 이 옵션이 없으면 자막 요청이
      // 429 등으로 실패할 때 yt-dlp가 영상 다운로드 전에 중단해 파일이 하나도 남지 않는다.
      '--ignore-errors',
      // 구간 자막은 시간이 전체 영상 기준이라 잘라낸 영상과 어긋난다. 구간 모드에서는 뺀다.
      ...(useSection ? [] : buildSubtitleArgs(subtitles)),
    ];

    if (hasLocalFfmpeg || fs.existsSync(ffmpegPath)) {
      const ffmpegDir = path.dirname(ffmpegPath);
      args.push('--ffmpeg-location', ffmpegDir);
    }

    args.push(...getJsRuntimeArgs());
    args.push(url);

    console.log('[download-video] Spawning:', ytDlpPath, args.join(' '));

    const proc = spawnYtDlp(args);

    currentDownloadProc = proc;

    let stderr = '';
    let lastFilePath = '';
    let archiveSkipped = 0;
    const subtitleFiles = [];

    readLines(proc.stdout, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      console.log('[yt-dlp stdout]', trimmed);

      if (isArchiveSkipLine(trimmed)) {
        archiveSkipped += 1;
        return;
      }

      const subFile = matchSubtitleFile(trimmed);
      if (subFile) {
        subtitleFiles.push(subFile);
        return;
      }

      // Parse progress from yt-dlp output
      const progress = buildProgressPayload(trimmed);
      if (progress) {
        mainWindow?.webContents.send('download-progress', progress);
      }

      // Detect merge output line: [Merger] Merging formats into "path/file.mp4"
      const mergeMatch = trimmed.match(/\[Merger\]\s+Merging formats into "([^"]+)"/);
      if (mergeMatch) {
        lastFilePath = mergeMatch[1].trim();
        mainWindow?.webContents.send('download-progress', {
          percent: 99,
          totalSize: '',
          speed: '',
          eta: '병합 중...',
        });
      }

      // 음원만 받을 때는 병합이 없다. 변환 결과가 최종 파일이고, 변환 전 파일은 지워진다.
      const audioMatch = trimmed.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/);
      if (audioMatch) {
        lastFilePath = audioMatch[1].trim();
      }

      // Detect destination file
      const destMatch = trimmed.match(/\[download\]\s+Destination:\s+(.+)/);
      if (destMatch) {
        const rawDest = destMatch[1].trim();
        if (!isFragmentFile(rawDest) && !isSubtitleFile(rawDest)) {
          lastFilePath = rawDest;
        }
      }

      // Already downloaded
      const alreadyMatch = trimmed.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (alreadyMatch && !isSubtitleFile(alreadyMatch[1].trim())) {
        lastFilePath = alreadyMatch[1].trim();
      }
    });

    readText(proc.stderr, (errStr) => {
      stderr += errStr;
      console.warn('[yt-dlp stderr]', errStr.trim());
    });

    proc.on('close', (code) => {
      currentDownloadProc = null;

      if (lastFilePath && !path.isAbsolute(lastFilePath)) {
        lastFilePath = path.resolve(outputDir, lastFilePath);
      }

      // --ignore-errors 때문에 자막만 실패해도 종료 코드가 1이 된다. 반대로 영상이
      // 통째로 실패했는데 0이 나올 수도 있다. 종료 코드가 아니라 영상 파일이 실제로
      // 생겼는지로 성공을 판정한다.
      const gotVideo = !!lastFilePath && fs.existsSync(lastFilePath);

      // 건너뛰기가 켜져 있고 이미 받은 영상이면 파일이 안 생긴다. 실패가 아니다.
      if (!gotVideo && archiveSkipped > 0) {
        console.log('[download-video] Already downloaded, skipped by archive.');
        resolve({ success: true, alreadyDownloaded: true, subtitleFiles: [], filePath: '' });
        return;
      }

      if (!gotVideo) {
        console.error('[download-video] Failed code:', code, stderr);
        reject(new Error(stderr || `다운로드 실패 (코드: ${code})`));
        return;
      }

      const subs = subtitleFiles
        .map((f) => (path.isAbsolute(f) ? f : path.resolve(outputDir, f)))
        .filter((f) => fs.existsSync(f));
      tidySubtitleFiles(subs);

      // 자막을 요청했는데 오류로 못 받은 경우와, 그 언어가 아예 없는 경우를 구분한다.
      const subtitleFailed =
        subs.length === 0 && /subtitle/i.test(stderr) && /error/i.test(stderr);

      console.log('[download-video] Completed. Final path:', lastFilePath,
        `| subs=${subs.length}${subtitleFailed ? ' (자막 오류)' : ''}`);

      resolve({
        success: true,
        subtitleFiles: subs,
        subtitleFailed,
        filePath: lastFilePath,
      });
    });

    proc.on('error', (err) => {
      currentDownloadProc = null;
      console.error('[download-video] Process error:', err);
      reject(new Error(`yt-dlp 실행 오류: ${err.message}`));
    });
  });
});

// ─── Download Playlist ───

// 영상별로 yt-dlp를 N번 띄우지 않고, 재생목록 URL 한 번 + --playlist-items 로 처리한다.
// 그래야 순번(%(playlist_index)s)과 폴더 생성, 파일명 정리를 yt-dlp가 알아서 해주고
// 취소도 기존 단일 프로세스 kill 로직을 그대로 쓸 수 있다.
ipcMain.handle('download-playlist', async (event, { url, quality, outputDir, items, subtitles, codecMode, skipExisting }) => {
  return new Promise((resolve, reject) => {
    if (currentDownloadProc) {
      reject(new Error('이미 다른 다운로드가 진행 중입니다.'));
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      reject(new Error('선택된 영상이 없습니다.'));
      return;
    }

    const { ytDlpPath, ffmpegPath, hasLocalFfmpeg } = getBinPaths();
    const outputTemplate = path.join(
      outputDir,
      '%(playlist_title)s',
      '%(playlist_index)02d - %(title)s.%(ext)s'
    );

    const args = [
      ...buildMediaArgs(quality, codecMode),
      ...buildArchiveArgs(skipExisting),
      '--newline',
      '--progress',
      '-o', outputTemplate,
      // watch?v=...&list=... 형태는 --yes-playlist 없이는 단일 영상만 받는다.
      '--yes-playlist',
      '--playlist-items', items.join(','),
      // 비공개/삭제/지역차단 영상 하나 때문에 나머지가 통째로 중단되면 안 된다.
      '--ignore-errors',
      ...buildSubtitleArgs(subtitles),
    ];

    if (hasLocalFfmpeg || fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', path.dirname(ffmpegPath));
    }

    args.push(...getJsRuntimeArgs());
    args.push(url);

    console.log('[download-playlist] Spawning:', ytDlpPath, args.join(' '));

    const proc = spawnYtDlp(args);
    currentDownloadProc = proc;

    let stderr = '';
    let itemTotal = items.length;
    let current = null;
    let archiveSkipped = 0;
    const results = [];
    const subtitleFiles = [];

    const finishCurrent = () => {
      if (current) results.push(current);
      current = null;
    };

    readLines(proc.stdout, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (isArchiveSkipLine(trimmed)) {
        archiveSkipped += 1;
        return;
      }

      const subFile = matchSubtitleFile(trimmed);
      if (subFile) {
        subtitleFiles.push(subFile);
        return;
      }

      // "[download] Downloading item 3 of 12" — 선택분 기준 위치
      const itemMatch = trimmed.match(/\[download\]\s+Downloading item (\d+) of (\d+)/);
      if (itemMatch) {
        finishCurrent();
        itemTotal = parseInt(itemMatch[2], 10);
        current = {
          position: parseInt(itemMatch[1], 10),
          playlistIndex: items[parseInt(itemMatch[1], 10) - 1],
          filePath: '',
        };
        mainWindow?.webContents.send('download-progress', {
          percent: 0,
          totalSize: '',
          speed: '',
          eta: '',
          itemIndex: current.position,
          itemTotal,
        });
        return;
      }

      const progress = buildProgressPayload(trimmed);
      if (progress) {
        mainWindow?.webContents.send('download-progress', {
          ...progress,
          itemIndex: current?.position || 1,
          itemTotal,
        });
      }

      const mergeMatch = trimmed.match(/\[Merger\]\s+Merging formats into "([^"]+)"/);
      if (mergeMatch && current) {
        current.filePath = mergeMatch[1].trim();
        mainWindow?.webContents.send('download-progress', {
          percent: 99,
          totalSize: '',
          speed: '',
          eta: '병합 중...',
          itemIndex: current.position,
          itemTotal,
        });
      }

      const audioMatch = trimmed.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/);
      if (audioMatch && current) {
        current.filePath = audioMatch[1].trim();
      }

      const destMatch = trimmed.match(/\[download\]\s+Destination:\s+(.+)/);
      if (destMatch && current) {
        const rawDest = destMatch[1].trim();
        if (!isFragmentFile(rawDest) && !isSubtitleFile(rawDest)) current.filePath = rawDest;
      }

      const alreadyMatch = trimmed.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (alreadyMatch && current && !isSubtitleFile(alreadyMatch[1].trim())) {
        current.filePath = alreadyMatch[1].trim();
      }
    });

    readText(proc.stderr, (errStr) => {
      stderr += errStr;
      console.warn('[yt-dlp stderr]', errStr.trim());
    });

    proc.on('close', (code) => {
      currentDownloadProc = null;
      finishCurrent();

      const completed = results
        .filter((r) => r.filePath)
        .map((r) => ({
          ...r,
          filePath: path.isAbsolute(r.filePath)
            ? r.filePath
            : path.resolve(outputDir, r.filePath),
        }));

      // "item N of M" 자체가 안 찍힌 항목까지 포함해서 실패분을 센다.
      const attempted = new Set(results.map((r) => r.playlistIndex));
      const succeeded = new Set(completed.map((r) => r.playlistIndex));
      const failed = items.filter((idx) => !succeeded.has(idx));

      console.log(
        `[download-playlist] code=${code} completed=${completed.length}/${items.length} attempted=${attempted.size}`
      );

      // --ignore-errors를 쓰면 일부만 실패해도 exit code가 0이 아니다. 하나라도 받았으면 성공 처리한다.
      if (completed.length === 0) {
        // yt-dlp가 오류 없이 아무것도 받지 않는 경우도 있다(예: 선택 항목이 목록에 없음).
        reject(new Error(stderr || '다운로드된 영상이 없습니다. 선택한 항목을 확인해주세요.'));
        return;
      }

      const subs = subtitleFiles.map((f) =>
        path.isAbsolute(f) ? f : path.resolve(outputDir, f)
      );
      tidySubtitleFiles(subs);

      resolve({
        success: true,
        total: items.length,
        completed,
        failed,
        subtitleFiles: subs,
        folder: path.dirname(completed[0].filePath),
        errorLog: failed.length ? stderr : '',
      });
    });

    proc.on('error', (err) => {
      currentDownloadProc = null;
      reject(new Error(`yt-dlp 실행 오류: ${err.message}`));
    });
  });
});

// ─── Download Multiple Videos (search results) ───

// 재생목록과 달리 서로 무관한 URL 묶음이다. yt-dlp는 이 경우
// "[download] Downloading item N of M"을 찍지 않으므로 재생목록의 진행률 파서를 쓸 수 없다.
// 대신 "[youtube] Extracting URL: ..." 이 영상마다 한 번 나오는 것을 세어 위치를 추적한다.
ipcMain.handle('download-videos', async (event, { videos, quality, outputDir, subtitles, codecMode, skipExisting }) => {
  return new Promise((resolve, reject) => {
    if (currentDownloadProc) {
      reject(new Error('이미 다른 다운로드가 진행 중입니다.'));
      return;
    }
    if (!Array.isArray(videos) || videos.length === 0) {
      reject(new Error('선택된 영상이 없습니다.'));
      return;
    }

    const { ffmpegPath, hasLocalFfmpeg } = getBinPaths();
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    const args = [
      ...buildMediaArgs(quality, codecMode),
      ...buildArchiveArgs(skipExisting),
      '--newline',
      '--progress',
      '-o', outputTemplate,
      // 검색 결과의 URL에 &list= 가 붙어 있어도 재생목록 전체를 받으면 안 된다.
      '--no-playlist',
      '--ignore-errors',
      ...buildSubtitleArgs(subtitles),
    ];

    if (hasLocalFfmpeg || fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', path.dirname(ffmpegPath));
    }

    args.push(...getJsRuntimeArgs());
    for (const v of videos) args.push(v.url);

    console.log('[download-videos] Spawning for', videos.length, 'videos');

    const proc = spawnYtDlp(args);
    currentDownloadProc = proc;

    const itemTotal = videos.length;
    let stderr = '';
    let index = 0;         // 1-based, 현재 처리 중인 영상 번호
    let current = null;
    let archiveSkipped = 0;
    const subtitleFiles = [];
    const results = [];

    const finishCurrent = () => {
      if (current) results.push(current);
      current = null;
    };

    readLines(proc.stdout, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (isArchiveSkipLine(trimmed)) {
        archiveSkipped += 1;
        return;
      }

      const subFile = matchSubtitleFile(trimmed);
      if (subFile) {
        subtitleFiles.push(subFile);
        return;
      }

      // 영상 하나가 시작될 때마다 한 번 나온다.
      if (/^\[youtube\]\s+Extracting URL:/.test(trimmed)) {
        finishCurrent();
        index += 1;
        current = { position: index, video: videos[index - 1] || null, filePath: '' };
        mainWindow?.webContents.send('download-progress', {
          percent: 0, totalSize: '', speed: '', eta: '',
          itemIndex: index, itemTotal,
        });
        return;
      }

      const progress = buildProgressPayload(trimmed);
      if (progress) {
        mainWindow?.webContents.send('download-progress', {
          ...progress,
          itemIndex: index || 1,
          itemTotal,
        });
      }

      const mergeMatch = trimmed.match(/\[Merger\]\s+Merging formats into "([^"]+)"/);
      if (mergeMatch && current) {
        current.filePath = mergeMatch[1].trim();
        mainWindow?.webContents.send('download-progress', {
          percent: 99, totalSize: '', speed: '', eta: '병합 중...',
          itemIndex: index, itemTotal,
        });
      }

      const audioMatch = trimmed.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/);
      if (audioMatch && current) {
        current.filePath = audioMatch[1].trim();
      }

      const destMatch = trimmed.match(/\[download\]\s+Destination:\s+(.+)/);
      if (destMatch && current) {
        const rawDest = destMatch[1].trim();
        if (!isFragmentFile(rawDest) && !isSubtitleFile(rawDest)) current.filePath = rawDest;
      }

      const alreadyMatch = trimmed.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (alreadyMatch && current && !isSubtitleFile(alreadyMatch[1].trim())) {
        current.filePath = alreadyMatch[1].trim();
      }
    });

    readText(proc.stderr, (errStr) => {
      stderr += errStr;
      console.warn('[yt-dlp stderr]', errStr.trim());
    });

    proc.on('close', (code) => {
      currentDownloadProc = null;
      finishCurrent();

      const abs = (f) => (path.isAbsolute(f) ? f : path.resolve(outputDir, f));
      const completed = results
        .filter((r) => r.filePath)
        .map((r) => ({ ...r, filePath: abs(r.filePath) }));

      const succeeded = new Set(completed.map((r) => r.position));
      const failed = videos
        .map((v, i) => ({ position: i + 1, title: v.title }))
        .filter((v) => !succeeded.has(v.position));

      console.log(`[download-videos] code=${code} completed=${completed.length}/${videos.length}`);

      if (completed.length === 0) {
        reject(new Error(stderr || '다운로드된 영상이 없습니다.'));
        return;
      }

      const subs = subtitleFiles.map(abs);
      tidySubtitleFiles(subs);

      resolve({
        success: true,
        total: videos.length,
        completed,
        failed,
        subtitleFiles: subs,
        folder: path.dirname(completed[0].filePath),
        errorLog: failed.length ? stderr : '',
      });
    });

    proc.on('error', (err) => {
      currentDownloadProc = null;
      reject(new Error(`yt-dlp 실행 오류: ${err.message}`));
    });
  });
});

// ─── Cancel Download ───

ipcMain.on('cancel-download', () => {
  if (currentDownloadProc) {
    currentDownloadProc.kill('SIGTERM');
    currentDownloadProc = null;
  }
});

// ─── Make (변환) ───
//
// 이미 받은 로컬 mp4를 다른 형태로 바꾼다. 다운로드가 아니라 변환이라 네트워크가 없고,
// 다운로드와 별개 프로세스(currentConvertProc)로 추적해 대기열 다운로드가 도는 중에도 쓸 수 있다.

let currentConvertProc = null;

function ffmpegExe() {
  const { ffmpegPath } = getBinPaths();
  return fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';
}


// 결과 파일이 원본과 겹치지 않게 접미어를 붙이고, 확장자를 바꾼다.
function makeOutputPath(inputPath, suffix, ext) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  let out = path.join(dir, `${base} [${suffix}].${ext}`);
  let n = 2;
  while (fs.existsSync(out)) {
    out = path.join(dir, `${base} [${suffix}] (${n}).${ext}`);
    n += 1;
  }
  return out;
}

// ffmpeg를 돌리며 진행률을 renderer로 흘려보낸다. totalSec을 알면 퍼센트를 계산한다.
function runFfmpeg(args, { totalSec = 0, label = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (currentConvertProc) {
      reject(new Error('이미 다른 변환이 진행 중입니다.'));
      return;
    }
    const proc = spawn(ffmpegExe(), ['-hide_banner', '-y', ...args, '-progress', 'pipe:1', '-nostats'], {
      windowsHide: true,
    });
    currentConvertProc = proc;

    let stderr = '';
    // -progress 는 stdout에 out_time_ms=... 를 준다.
    readLines(proc.stdout, (line) => {
      const m = line.match(/out_time_ms=(\d+)/);
      if (m && totalSec > 0) {
        const sec = parseInt(m[1], 10) / 1_000_000;
        const percent = Math.min(99, (sec / totalSec) * 100);
        mainWindow?.webContents.send('convert-progress', { percent, label });
      }
    });
    readText(proc.stderr, (t) => { stderr += t; });

    proc.on('close', (code) => {
      currentConvertProc = null;
      if (code === 0) resolve();
      else reject(new Error(stderr.split('\n').filter(Boolean).pop() || `ffmpeg 실패 (코드: ${code})`));
    });
    proc.on('error', (err) => {
      currentConvertProc = null;
      reject(new Error(`ffmpeg 실행 오류: ${err.message}`));
    });
  });
}

// 입력 영상 길이(초). 진행률 계산용. ffprobe를 따로 번들하지 않고 ffmpeg -i 의 stderr에서 읽는다.
// ffmpeg -i 는 출력이 없어 비정상 종료하지만 그 전에 "Duration: HH:MM:SS.ss" 를 찍는다.
function probeDuration(inputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegExe(), ['-hide_banner', '-i', inputPath], (err, stdout, stderr) => {
      const m = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : 0);
    });
  });
}

function assertLocalFile(inputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('원본 파일을 찾을 수 없습니다. 다시 받아주세요.');
  }
}

// ── GIF ──
ipcMain.handle('make-gif', async (event, { inputPath, start = 0, end = null, width = 480, fps = 12 }) => {
  assertLocalFile(inputPath);
  const dur = end && end > start ? end - start : null;
  const trim = ['-ss', String(start), ...(dur ? ['-t', String(dur)] : ['-t', '10'])];
  const out = makeOutputPath(inputPath, 'GIF', 'gif');
  // 팔레트를 먼저 만들어야 색이 깨지지 않는다.
  const palette = path.join(os.tmpdir(), `ytdl_palette_${Date.now()}.png`);
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  try {
    await runFfmpeg([...trim, '-i', inputPath, '-vf', `${vf},palettegen`, palette], { label: 'GIF 색 분석' });
    await runFfmpeg([...trim, '-i', inputPath, '-i', palette, '-lavfi', `${vf}[x];[x][1:v]paletteuse`, out],
      { totalSec: dur || 10, label: 'GIF 만드는 중' });
  } finally {
    try { fs.unlinkSync(palette); } catch (e) {}
  }
  return { ok: true, outputPath: out };
});

// ── 세로 영상 (9:16 블러 배경) ──
ipcMain.handle('make-vertical', async (event, { inputPath }) => {
  assertLocalFile(inputPath);
  const totalSec = await probeDuration(inputPath);
  const out = makeOutputPath(inputPath, '세로', 'mp4');
  const fc =
    '[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,gblur=sigma=20[bg];' +
    '[0:v]scale=720:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2';
  await runFfmpeg(['-i', inputPath, '-filter_complex', fc, '-c:a', 'copy', out],
    { totalSec, label: '세로 영상 만드는 중' });
  return { ok: true, outputPath: out };
});

// ── 거울 모드 ──
// mode: 'flip'(좌우반전) | 'sidebyside'(원본|거울)
ipcMain.handle('make-mirror', async (event, { inputPath, mode = 'flip' }) => {
  assertLocalFile(inputPath);
  const totalSec = await probeDuration(inputPath);
  if (mode === 'sidebyside') {
    const out = makeOutputPath(inputPath, '원본＋거울', 'mp4');
    await runFfmpeg(['-i', inputPath, '-filter_complex',
      '[0:v]split[a][b];[b]hflip[bf];[a][bf]hstack', '-c:a', 'copy', out],
      { totalSec, label: '거울 영상 만드는 중' });
    return { ok: true, outputPath: out };
  }
  const out = makeOutputPath(inputPath, '거울', 'mp4');
  await runFfmpeg(['-i', inputPath, '-vf', 'hflip', '-c:a', 'copy', out],
    { totalSec, label: '거울 영상 만드는 중' });
  return { ok: true, outputPath: out };
});

// ── 장면 격자 미리보기 (스토리보드) ──
// 일정 개수의 대표 프레임을 뽑아 격자 이미지 하나로. 시간표도 함께 돌려준다.
ipcMain.handle('make-storyboard', async (event, { inputPath, cols = 4, rows = 5 }) => {
  assertLocalFile(inputPath);
  const totalSec = await probeDuration(inputPath);
  const count = cols * rows;
  const out = makeOutputPath(inputPath, '장면미리보기', 'jpg');
  // 균등 간격으로 count장을 뽑아 타일로 붙인다. thumbnail=n은 n프레임 묶음마다 대표 1장을
  // 고르므로, 전체 프레임수를 원하는 칸 수로 나눠 간격을 정한다(대략 30fps 가정).
  const step = totalSec > 0 ? totalSec / count : 1;
  const nEvery = Math.max(1, Math.round((totalSec * 30) / count));
  const fc = `thumbnail=n=${nEvery},scale=320:-1,tile=${cols}x${rows}`;
  await runFfmpeg(['-i', inputPath, '-vf', fc, '-frames:v', '1', out],
    { label: '장면 미리보기 만드는 중' });
  // 각 칸이 대략 어느 시각인지(등간격 근사) 함께 준다.
  const times = Array.from({ length: count }, (_, i) => Math.round(step * i));
  return { ok: true, outputPath: out, cols, rows, times, totalSec };
});

// ── 슬라이드 PDF (장면 전환 감지 → 프레임 추출 → PDF) ──
ipcMain.handle('make-slides', async (event, { inputPath, threshold = 0.3 }) => {
  assertLocalFile(inputPath);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl_slides_'));
  try {
    // 1) 장면이 크게 바뀌는 프레임만 추출.
    //    매칭되는 장면이 하나도 없으면 ffmpeg가 "출력 스트림 없음"으로 실패한다.
    //    그건 오류가 아니라 "슬라이드 없음"이므로, 실패를 삼키고 파일 개수로 판단한다.
    try {
      await runFfmpeg(['-i', inputPath, '-vf', `select='gt(scene,${threshold})',scale=1280:-1`,
        '-fps_mode', 'vfr', '-q:v', '3', path.join(workDir, 'slide_%03d.jpg')],
        { label: '슬라이드 장면 찾는 중' });
    } catch (e) {
      // 프레임이 하나라도 나왔으면 진행, 아니면 아래에서 안내한다.
    }

    const files = fs.readdirSync(workDir).filter((f) => f.endsWith('.jpg')).sort();
    if (files.length === 0) {
      throw new Error('화면이 크게 바뀌는 장면을 찾지 못했습니다. 강의·발표처럼 화면 전환이 뚜렷한 영상에서 잘 됩니다.');
    }

    // 2) 이미지들을 HTML로 묶어 오프스크린 창에서 PDF로 인쇄
    const pages = files.map((f) => {
      const b64 = fs.readFileSync(path.join(workDir, f)).toString('base64');
      return `<div style="page-break-after:always;text-align:center">` +
             `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;max-height:99vh"></div>`;
    }).join('');
    const html = `<!doctype html><html><body style="margin:0">${pages}</body></html>`;
    const htmlPath = path.join(workDir, 'slides.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    const out = makeOutputPath(inputPath, '슬라이드', 'pdf');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await win.loadFile(htmlPath);
      await new Promise((r) => setTimeout(r, 400));
      const pdf = await win.webContents.printToPDF({ printBackground: true });
      fs.writeFileSync(out, pdf);
    } finally {
      win.destroy();
    }
    return { ok: true, outputPath: out, slideCount: files.length };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  }
});

ipcMain.on('cancel-convert', () => {
  if (currentConvertProc) {
    try { currentConvertProc.kill('SIGTERM'); } catch (e) {}
    currentConvertProc = null;
  }
});

// ─── Open File / Folder ───

// shell.openPath()는 실패 사유를 문자열로 돌려주고, showItemInFolder()는 잘못된 경로에서
// 조용히 아무 일도 하지 않는다. 그대로 두면 사용자에게는 "버튼이 안 눌린다"로 보인다.
// 결과를 renderer로 돌려주어 이유를 표시한다.
ipcMain.handle('open-file', async (event, filePath) => {
  if (!filePath) return { ok: false, message: '열 파일 경로가 없습니다.' };
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: `파일을 찾을 수 없습니다: ${path.basename(filePath)}` };
  }
  const err = await shell.openPath(filePath);
  return err ? { ok: false, message: err } : { ok: true };
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath) return { ok: false, message: '열 폴더 경로가 없습니다.' };
  if (!fs.existsSync(folderPath)) {
    return { ok: false, message: '폴더를 찾을 수 없습니다.' };
  }
  const err = await shell.openPath(folderPath);
  return err ? { ok: false, message: err } : { ok: true };
});

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  if (!filePath) return { ok: false, message: '경로가 없습니다.' };
  if (!fs.existsSync(filePath)) {
    // 파일이 없어도 상위 폴더는 열어주는 편이 사용자에게 낫다.
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return { ok: false, message: `파일을 찾을 수 없어 폴더만 열었습니다: ${path.basename(filePath)}` };
    }
    return { ok: false, message: `파일을 찾을 수 없습니다: ${path.basename(filePath)}` };
  }
  shell.showItemInFolder(filePath);
  return { ok: true };
});
