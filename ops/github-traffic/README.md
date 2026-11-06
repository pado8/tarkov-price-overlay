# GitHub 레포 방문 기록 보관 (2026-11-06~)

GitHub 은 레포 트래픽(조회·클론·리퍼러·인기 경로)을 **최근 14일만** 보여 주고 그 전은 지운다.
그래서 이 PC 의 예약 작업이 하루 한 번 받아 `data/` 에 합쳐 둔다.

- 대상: `pado8/tarkov-price-overlay-releases`(배포 레포) · `pado8/tarkov-price-overlay`(소스 레포) — `archive.py` 의 `REPOS`
- 예약 작업: **`GitHubTrafficArchive`** — 매일 12:40, 놓치면 PC 켤 때 실행(StartWhenAvailable), `pythonw` 라 창이 안 뜬다
- 인증: 이 PC 에 로그인된 `gh`(keyring). GitHub Actions 기본 토큰으로는 트래픽 API 를 못 읽어서(관리자 권한 필요) Actions 대신 로컬로 했다
- PC 가 며칠 꺼져 있어도 **14일 안에 한 번만** 돌면 빠짐없이 채워진다

## 저장 형식 (`data/`, git 제외 — 공개 저장소라서)
| 파일 | 내용 |
|---|---|
| `<owner>__<repo>/daily.json` | 날짜별 `views` · `view_uniques` · `clones` · `clone_uniques`. 같은 날을 다시 받으면 최신 값으로 덮어씀(GitHub 이 하루 이틀 늦게 채움) |
| `<owner>__<repo>/snapshots/YYYY-MM-DD.json` | 그날 받은 14일 합계·리퍼러·인기 경로(일별 값이 없는 항목이라 스냅샷으로) |
| `archive.log` | 실행 기록 한 줄씩 |

## 수동 실행·점검
```
python C:\project\ops\github-traffic\archive.py
Get-ScheduledTaskInfo -TaskName GitHubTrafficArchive
Get-Content C:\project\ops\github-traffic\data\archive.log -Tail 5 -Encoding UTF8
```
⚠ 데이터는 이 PC 에만 있다(백업 없음). 오래 쌓이면 다른 곳에 한 번씩 복사해 둘 것.
