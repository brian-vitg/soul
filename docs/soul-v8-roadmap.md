# 🧠 Soul v8.0 Roadmap — The Heart Upgrade

> 기획일: 2026-03-26 | 상태: Planning

## 배경

Soul은 N2 생태계의 **심장**이다. 다른 패키지(Clotho, Ark, Arachne, QLN, Mimir)는 옵션이지만 Soul 없이는 아무것도 돌아가지 않는다.

현재 Soul v7.0.6은 초창기 CJS로 작성되었고, 아키텍처는 탄탄하지만 품질 인프라(타입, 테스트, 로깅)와 성능 최적화(동기I/O, O(n) 검색)에 약점이 있다.

**목표**: 구조를 망가뜨리지 않으면서 2중 3중으로 안전하고 빠르게 업그레이드한다. 메모리 관련이므로 무겁지 않게.

---

## Phase 1: 기반 다지기 ✅ 완료 (v7.1)

| 항목 | 상태 | 설명 |
|------|:----:|------|
| description 업데이트 | ✅ | Ark/Arachne 구식 참조 제거 |
| 4레벨 로그 시스템 | ✅ | debug/info/warn/error + `N2_LOG_LEVEL` 환경변수 제어 |
| info 레벨 로그 정확화 | ✅ | logError 남용 → logInfo 수정 (3곳) |
| Board 인메모리 캐시 | ✅ | mtime 기반 무효화로 멀티에이전트 안전성 유지 |

---

## Phase 2: 성능 혁신

| 항목 | 난이도 | 설명 |
|------|:------:|------|
| sqlite-vec 벡터 인덱스 | 🟡 | 시맨틱 검색 O(n) → O(1). sqlite-vec 이미 의존성에 있음 |
| 핫 패스 async I/O | 🟠 | save/load/search의 동기 I/O → 비동기 전환 |
| registerTool shim 제거 | 🟡 | MCP SDK 네이티브 사용으로 기술부채 해소 |

---

## Phase 3: Forgetting Curve — 인간형 기억 시스템

> Soul 단독으로 구현 가능. 가장 즉각적인 효과.

현재: 스냅샷 50개 제한, 30일 만료 → 기계적 삭제

### 3단계 기억 계층

```
┌──────────────────────────────────────────────┐
│  🔴 Hot Memory (최근 7일 + 자주 접근)         │
│  → 전체 스냅샷 보관                           │
│  → 즉시 로드 가능                             │
├──────────────────────────────────────────────┤
│  🟡 Warm Memory (7~30일)                     │
│  → 요약 + 핵심 결정사항만 보관                 │
│  → 토큰 절약 80%+                            │
├──────────────────────────────────────────────┤
│  🔵 Cold Memory (30일+)                      │
│  → 키워드 + 메타데이터만 보관                  │
│  → 필요 시 백업에서 전체 복원                  │
│  → 메모리 사용량 95% 감소                     │
└──────────────────────────────────────────────┘
```

### 접근 빈도 기반 승격/강등

```
기억 A: 매일 검색됨         → Hot 유지
기억 B: 2주 전 마지막 접근   → Warm으로 강등
기억 C: 2달 전, 한 번도 검색 안 됨 → Cold로 강등
기억 D: Cold인데 갑자기 검색됨 → Warm으로 승격
```

---

## Phase 4: Soul × Arachne 연동

> Arachne의 코드 이해 능력을 Soul의 기억에 결합

### Smart Memory Compression
- 현재: 텍스트 길이 기반 단순 압축
- 연동 후: Arachne의 BM25로 현재 프로젝트와 관련 있는 기억은 유지, 무관한 건 축소
- 같은 토큰 예산으로 **2-3배 더 정확한 컨텍스트**

### Memory-Aware Code Search
- Soul이 "이 에이전트가 지난 세션에 수정한 파일" 정보를 Arachne에 전달
- Arachne가 검색 우선순위를 자동 조정
- 에이전트가 최근 작업한 파일이 검색 상위에 노출

### Cross-Session Impact Analysis
- Soul: "지난 세션에 auth.ts를 수정했다"
- Arachne: "auth.ts를 import하는 파일 15개가 영향받을 수 있다"
- 부팅 시 자동으로 영향 범위 알림

---

## Phase 5: Soul × Mimir 연동

> Mimir의 경험 학습을 Soul의 세션 데이터에 적용

### Auto-Learning Ledger
```
작업 끝 → Ledger에 기록 → Mimir가 자동 분석
→ "TypeScript strict 프로젝트에서 interface 대신 type 썼을 때 3번 수정함"
→ 다음에 같은 상황이면 자동으로 interface 추천
```
- 모든 작업 세션이 자동으로 학습 데이터가 된다
- 명시적 `study_start/add/end` 없이도 학습

### Experience-Guided Decisions
- 비슷한 상황에서 과거 어떤 결정을 했는지 자동 서제스트
- Ledger의 `decisions` 필드를 Mimir가 분석
- "이전에 비슷한 리팩토링에서 X 접근법을 선택했고 성공했다"

---

## Phase 6: 3자 연동 — Predictive Context Loading

> 가장 복잡하지만 가장 강력한 기능

```
부팅:
  1. Soul   → 이전 세션 KV-Cache 로드
  2. Mimir  → 패턴 분석: "이 에이전트는 보통 이 시간에 이 프로젝트의 이런 작업을 한다"
  3. Arachne → 예측된 작업에 필요한 코드 컨텍스트를 미리 로드

결과: 에이전트가 질문하기도 전에 필요한 정보가 준비되어 있다
```

---

## Phase 7: 품질 보증

| 항목 | 설명 |
|------|------|
| 유닛 테스트 20개+ | SoulEngine, KV-Cache save/load/search, Board 캐시 |
| 통합 테스트 | 부팅 → 작업 → 종료 전체 시퀀스 |
| CI/CD | GitHub Actions 자동 테스트 |
| TypeScript 검토 | JSDoc `@ts-check` 또는 전면 마이그레이션 결정 |

---

## 우선순위 요약

```
즉시    Phase 1 ✅ → 로그, 캐시, description
단기    Phase 2    → sqlite-vec, async I/O
중기    Phase 3    → Forgetting Curve (Soul 단독)
중장기  Phase 4-5  → Arachne/Mimir 연동
장기    Phase 6    → 3자 연동 (Predictive Loading)
지속    Phase 7    → 테스트, 타입
```

---

> *"Soul은 기억이다. 기억이 효율적이면 AI는 더 빠르고, 더 정확하고, 더 성장한다."*
