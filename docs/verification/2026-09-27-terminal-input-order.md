# Terminal input order (#408)

The Windows daily workspace journey exposed a real ordering error: typing `Set-Content` produced `Ste-tent`. The completed-output marker ran, but the retained file-content assertion correctly rejected the unchanged file. A deterministic test then held the first workspace validation while a second write completed; the unchanged service wrote `eS` instead of `Se`.

The fix reserves a per-session input lane before asynchronous validation. Both renderer terminal stores keep later input events behind every chunk of an earlier paste. Refused input reports the existing notice and drops the remaining queued input; a fresh attempt remains possible. Close, Stop and restart invalidate waiting input so it cannot enter the replacement shell. Other sessions remain independent.

At production/test commit `4fdeee7f`, typecheck, lint, notices, build and 36 focused tests passed. The tests hold real asynchronous boundaries and assert exact write order, independent progress, rejection recovery, and lifecycle ownership. They have no performance threshold or shortened timeout. The full two-worker suite and independent reviews are still pending.

The frozen daily workspace test correction at `c05d7f68` was run against this branch's built main entry with `SOTTO_E2E_MAIN_ENTRY`, using one Playwright worker and three repeats. All six tests passed in 3.3 minutes: three daily keyboard-to-file, diff, commit and owned test-PR journeys, plus three restart journeys preserving pane drafts, queued work, settlement and preferences. Provider and GitHub actions were scripted; the PowerShell process, typed keys and file changes were real and confined to temporary test repositories. No paid provider turn or production profile was used. `SOTTO_PERF_DATA` pointed at a verified-absent owned path.

The selected dark daily-workspace and minimum light restart screenshots were inspected. The owned publish flow remains readable, and the minimum view retains the newer unsent draft and queue controls. This change adds no layout or styling. All pre-existing journey captures and generated runtime files were restored.

- [Completed daily workspace and owned test PR](../../artifacts/review-408/daily-owned-publish.png)
- [Minimum light restart with preserved draft](../../artifacts/review-408/restart-minimum-light.png)

macOS was not exercised locally.
