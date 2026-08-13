# YouTube Downloader

교사용 유튜브 영상 다운로더. 수업 자료를 손쉽게 내려받기 위한 Windows 데스크톱 프로그램입니다.
`yt-dlp`와 `ffmpeg`를 내장하여 **별도 설치 없이** 실행 파일 하나로 동작합니다.

> 사용법은 [`YouTube Downloader 사용법.pdf`](YouTube%20Downloader%20사용법.pdf)를 참고하세요.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 주소로 받기 | 유튜브 주소를 붙여넣어 MP4로 저장 |
| 검색해서 받기 | 낱말을 입력해 유튜브 검색 → 골라서 받기 |
| 재생목록 · 채널 | 재생목록/채널 주소로 목록 전체를 불러와 선택 다운로드 |
| 영상 형식 | 호환성 우선(H.264+AAC, 최대 1080p) / 화질 우선(4K, AV1) 선택 |
| 음원만 | MP3로 소리만 저장 |
| 구간만 잘라 받기 | 시작~끝 시간을 지정해 부분만 저장 |
| **✨ 만들기** | 받은 영상을 GIF · 거울(좌우반전) · 세로영상(9:16) · 슬라이드 PDF · 장면 미리보기로 변환 (번들 ffmpeg + Electron printToPDF) |
| 영어 자막 | 제작자가 직접 올린 **정확한 수동 자막만** `.srt`로 저장 (자동 생성 제외, 반복 제거·문장 단위 정리) |
| Polyglot 연동 | 받은 영상을 **Polyglot Player**로 바로 보내 받아쓰기·구간반복 학습 (영상+자막 자동 로드) |
| 대기열 | 여러 영상을 이어서 걸어두고 순차 다운로드 |
| 클립보드 감지 | 유튜브 주소를 복사하면 자동으로 불러오기 |
| 이미 받은 것 건너뛰기 | 재생목록 재방문 시 새 영상만 |
| 엔진 자동 갱신 | 실행 시 yt-dlp를 최신으로 유지, 긴급 시 nightly 전환 |
| 화면 테마 | Polyglot(기본, 학습 앱 Polyglot Player와 동일 색) / 잉크·골드 / 슬레이트 / 틸·코퍼 / 와인 / 네온 6종, 설정 유지 |

## 설계상 핵심 결정

- **Node 비의존 실행** — 시스템에 Node가 없어도(학교 PC 등) 동작하도록, yt-dlp의 JS 런타임을 Electron 내장 Node(`ELECTRON_RUN_AS_NODE`)로 지정.
- **쓰기 가능한 엔진 사본** — 관리자 권한이 없어도 갱신되도록 첫 실행 시 `%APPDATA%`로 yt-dlp를 복사해 사용.
- **출력 인코딩 고정** — 윈도우 CP949 출력을 UTF-8로 강제(`--encoding utf-8`)하고, 스트림을 `StringDecoder`로 읽어 한글 파일명 깨짐 방지.
- **호환성 우선 코덱** — 파워포인트·윈도우 기본 플레이어에서 바로 열리도록 기본값을 H.264+AAC로.

## 개발

```bash
npm install          # 의존성 설치
npm start            # 개발 실행
npm run build        # Windows 설치 파일 생성 (dist/)
```

빌드 산출물은 `dist/YouTube Downloader Setup <버전>.exe` 입니다.

### 파일 구성

```
main.js        메인 프로세스 — yt-dlp/ffmpeg 실행, IPC, 엔진 갱신, 클립보드 감시
renderer.js    UI 로직 — 다운로드 대기열, 상태 관리, 진행 표시
preload.js     contextBridge로 안전한 IPC만 노출
index.html     화면 구조
styles.css     스타일
bin/           번들 실행 파일 (yt-dlp.exe, ffmpeg.exe)
licenses/      제3자 라이선스 고지
installer.nsh  NSIS 설치 스크립트
```

### 앱이 만드는 데이터 (`%APPDATA%\YouTube Downloader\`)

```
bin\yt-dlp.exe   갱신 가능한 엔진 사본
engine.json      엔진 채널(stable/nightly) 설정
downloaded.txt   "이미 받은 것 건너뛰기"용 기록
```

문제 재현이 안 될 때 이 폴더를 지우고 다시 실행하면 초기 상태가 됩니다.

## 라이선스

이 프로그램은 다음 오픈소스를 포함합니다. 자세한 고지는 [`licenses/THIRD-PARTY-NOTICES.txt`](licenses/THIRD-PARTY-NOTICES.txt)를 참고하세요.

- **FFmpeg** — GPL v3 ([`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt))
- **yt-dlp** — The Unlicense
- **Electron** — MIT

> FFmpeg가 GPL v3이므로, 이 프로그램을 재배포할 때는 반드시 `licenses/` 폴더를 함께 전달해야 합니다.

## 주의

내려받은 영상은 **저작권법이 허용하는 범위(수업 목적 등)** 안에서만 사용하세요.
저작권자가 허락하지 않은 영상의 재배포는 저작권 침해가 될 수 있습니다.

---

제작: **Hermit's Diner**
