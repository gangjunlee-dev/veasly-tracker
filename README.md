# Veasly Tracker

국내 이커머스(무신사, 29CM, 올리브영, 네이버페이) 주문을 한 곳에서 수집·관리하는 개인용 데스크톱 트래커입니다.

- **Stack**: Electron Forge + Vite + Next.js (renderer) + better-sqlite3 + Playwright
- **Platforms**: Windows · macOS · Linux

## 빠른 시작

```bash
# 의존성 설치
npm install

# 네이티브 모듈 리빌드 (better-sqlite3, keytar)
npm run rebuild:native

# 개발 모드 (Next 서버 + Electron 동시 실행)
npm start
```

## 자주 쓰는 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm start` | 개발 서버와 Electron을 함께 실행 |
| `npm run build:next` | Next.js 렌더러 정적 빌드 |
| `npm run package` | Electron Forge로 앱 패키징 (배포 산출물 X) |
| `npm run make` | OS별 인스톨러까지 생성 |
| `npm run typecheck` | TypeScript 타입 검사 (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest 단위 테스트 |
| `npm run test:watch` | Vitest watch 모드 |
| `npm run format` | Prettier 포맷팅 |

## 디렉터리 구조

```
src/
├── main/                       Electron 메인 프로세스
│   ├── index.ts                BrowserWindow 생성, CSP, 네비게이션 가드
│   ├── preload.ts              window.api 노출 (contextBridge)
│   ├── crypto/vault.ts         AES-256-GCM 자격증명 암호화 (keytar 마스터키)
│   ├── db/
│   │   ├── client.ts           SQLite 연결 + 마이그레이션 + 레거시 스키마 업그레이드
│   │   ├── schema.sql          신규 설치용 전체 스키마 (Vite ?raw로 인라인)
│   │   └── migrations/         업그레이드 마이그레이션 (Vite import.meta.glob로 인라인)
│   ├── ipc/                    렌더러 → 메인 RPC 핸들러 (Zod 검증 + 서비스 호출)
│   ├── services/               순수 함수 형태의 DB 리포지토리
│   ├── extractors/             사이트별 추출기 (BaseExtractor 상속)
│   │   └── _base/              공통 기반 (Playwright 컨텍스트, 세션, 등록 레지스트리)
│   └── utils/                  공유 유틸 (logger, tracking 번호 정규화)
├── renderer/                   Next.js App Router 기반 UI
│   └── app/                    라우트 & 페이지
└── shared/api.d.ts             window.api 타입 정의 (양 프로세스 공유)
```

## 데이터베이스

- 위치: `app.getPath("userData")/veasly.db`
- WAL 모드, 외래키 ON
- 신규 설치는 [`schema.sql`](src/main/db/schema.sql)이 권위(authoritative). Vite `?raw` import로 번들에 인라인되어 패키지 빌드에서도 path lookup 없이 동작합니다.
- 기존 사용자 DB 업그레이드:
  1. `migrations/*.sql`이 `_migrations` 테이블 기반으로 한 번씩 실행
  2. 추가로 `migrateLegacySchema()`가 `PRAGMA table_info`로 누락된 컬럼(warehouse 관련 + tracking 번호)을 idempotent하게 ALTER ADD
  3. tracking_number 컬럼이 새로 추가되면 raw_data JSON에서 백필, normalized 값은 JS로 일괄 채움

## 보안

- 비밀번호와 세션 상태는 OS 키체인(keytar)에 저장된 마스터 키로 AES-256-GCM 암호화 (`src/main/crypto/vault.ts`).
- `decrypt()`는 키 부재 시 조용히 새 키를 만들지 않고 `VaultKeyMissingError`를 던집니다 (기존 암호화 데이터 손실 방지).
- BrowserWindow는 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- 모든 응답에 CSP 헤더 주입 (`installContentSecurityPolicy`).
- `will-navigate` / `will-attach-webview` 가드로 외부 URL은 OS 브라우저로 강제 위임.

## 새 추출기 추가

1. `src/main/extractors/<코드>/` 폴더 생성
2. 다음 파일 작성:
   - `config.json` — `{ code, name, loginUrl, ordersUrl, version }`
   - `index.ts` — `BaseExtractor`를 상속한 클래스 default export
   - 필요 시 `parser.ts`, `selectors.ts`, `login.ts` 등으로 책임 분리 (musinsa 폴더 참고)
3. 레지스트리(`extractors/_base/registry.ts`)가 `import.meta.glob`로 자동 등록합니다. 폴더명이 `_`로 시작하면 무시됩니다.

각 추출기는 다음 메서드를 구현해야 합니다:

```ts
abstract login(page, credentials, progress?): Promise<void>;
abstract isLoggedIn(page): Promise<boolean>;
abstract extractOrders(page, options, progress?): Promise<StandardOrder[]>;
```

`StandardOrder` 형태로 반환된 데이터는 IPC 레이어의 `upsertOrders`에서 정규화·중복 제거되어 DB에 저장됩니다.

## 테스트

순수 함수(파서, 정규화 유틸)에 대한 Vitest 단위 테스트가 있습니다. 추출기처럼 브라우저 자동화가 필요한 부분은 정상 동작 확인을 위해 dev 모드 실행 후 UI에서 검증합니다.

```bash
npm test               # 1회 실행
npm run test:watch     # 변경 감지하며 자동 재실행
```

## CI

`.github/workflows/ci.yml`에서 push / PR 시 typecheck → lint → test 순서로 검증합니다. Linux runner에서 `libsecret-1-dev`를 설치해 keytar 빌드를 통과시킵니다.

## 라이선스

UNLICENSED (개인 프로젝트, 외부 배포 비허용)
