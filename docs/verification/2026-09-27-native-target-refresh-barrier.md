# Native target refresh barrier (#407)

The native-adapter regression now holds an actual unrelated `refreshThread` call at its history boundary. It requires the target prompt to finish and its exact native receipt to appear while that background operation remains pending. The existing configured five-second polling deadline bounds a broken dependency; the unconditional 250 ms stopwatch assertion is gone. No production code changes.

The focused native and coordinator neighbors passed 41 tests with six skips. An intentional diagnostic that blocked target progress failed at `Target prompt must finish while unrelated history remains held`; the held gate was released during cleanup. The diagnostic change was removed before verification.

Typecheck, lint and notices passed. The protected full gate on `41d7e258`, `npm test -- --maxWorkers=2`, passed 435 files and 5,735 tests, with 38 files and 131 tests skipped (1,177.08 seconds). `SOTTO_PERF_DATA` pointed to a verified-absent owned path. An earlier completed run omitted that guard and may have read the legacy local-profile benchmarks; it is excluded from acceptance evidence. No personal data was inspected to investigate that run. Issue #410 removes that implicit benchmark fallback.

After merging main at `d6db0dac`, static gates and the three target-refresh suites passed (14 tests). The final additive integration at `53bb7910` includes #403's timestamp fixture; native target refresh and that fixture's timestamp regression passed 11 tests. The reviewed target-test delta did not change during either integration. Final-head CI remains the integrated full gate.

Independent native Astra Standards and Spec reviews and the coordinating review reported zero findings. This is test tooling only; no Electron surface or design baseline changed, so no desktop journey was needed. No live provider or paid model turn was used.
