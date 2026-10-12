# 춤은 불법이 아니다 — 슬로건 공동구매

현재 배포 화면을 그대로 이어서 개발할 수 있는 전체 소스입니다. HTML / CSS / JavaScript ES modules로 만든 정적 사이트이며, 별도 빌드나 패키지 설치가 필요하지 않습니다. 슬로건 이미지와 5개 MP3도 포함되어 있습니다.

## 실행

압축을 풀고 이 폴더에서 실행하세요.

```sh
python3 -m http.server 5173 --directory dist
```

브라우저에서 http://localhost:5173 을 엽니다. `/dist`를 웹 루트로 제공해야 합니다. `index.html`을 파일로 직접 열면 ES module과 `/assets/...` 경로가 정상 작동하지 않습니다.

## 파일

- `dist/index.html`: 페이지와 모달 기본 구조
- `dist/styles.css`: 다크/라임 디자인, 모바일 배치, 모달 정렬, 애니메이션
- `dist/app.js`: 주문·계정·문의 화면 동작
- `dist/account-state.mjs`: 미리보기 계정/주문 저장 및 검증
- `dist/group-buy.mjs`: 가격·마감·계좌·카운트다운
- `dist/messages.mjs`: 브라우저에 저장하는 미리보기 대화
- `dist/music.js`: 음악 재생·반복·자동재생 시도·BPM 주기
- `dist/skeletons.js`: 원본 이미지의 해골/글자 영역을 분리해 움직이는 레이어
- `dist/assets/slogan.png`: 슬로건 원본
- `dist/assets/music/`: 5개 음원

## 현재 구현 상태

디자인과 브라우저 내 체험 흐름까지 구현되어 있습니다. **카카오 인증, 실제 주문 접수, 서버 DB, 운영자 인증, 실제 문의 전달, 입금 확인은 연결되어 있지 않습니다.** localStorage / sessionStorage 데이터는 사용자 브라우저에만 남습니다. 문의의 운영자 답변 버튼은 권한이 있는 실제 관리자 기능이 아니라 시안 체험용입니다.

서버와 인증을 연결하기 전에는 실제 주문을 받거나 입금을 유도하지 마세요. 현재 미리보기 고지는 실제 기능 연결 및 검증 후 정리해야 합니다.

## 이어서 작업

Codex 또는 Claude Code에서 이 폴더를 열고 `AGENTS.md`, `REQUIREMENTS.md`, `HANDOFF.md`를 먼저 읽게 하세요. 현재 단계, 확정 요구사항, 남은 작업이 적혀 있습니다.

정적 화면만 배포할 때는 `dist/`를 배포 루트로 사용하세요. ChatGPT Sites의 관리 설정과 인증 정보는 이 압축에 포함하지 않았습니다. 다른 호스팅으로 옮길 때의 환경과 배포 설정은 별도로 구성해야 합니다.
