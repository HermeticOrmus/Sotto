# Personal answer selection readiness (#416)

The refusal fixture now observes Coast checked and Send answer enabled before clicking Send. It then requires exactly one bridge command with chat `trip`, request `pick` and answer `a`, followed by the existing exact refusal message. The uncertain-decision, disabled answer and refresh checks remain intact. No production behavior or deadline changes.

## Cause and controlled witness

PR #412's Windows run [36362090684](https://github.com/millZach/Sotto/actions/runs/36362090684/job/108741128650) failed the unchanged personal-chat refusal test while 5,828 tests passed and 140 skipped. Diagnostic copies preserved the real chat view, store and bridge. With two workers, six full-file copies reproduced one failure (131 passed), and twelve full-file copies reproduced one failure (263 passed). Twelve isolated refusal cases passed.

The captured failing boundary had a connected, enabled Coast radio. Its handler called the request store exactly once, advancing revision 0 to revision 1 and recording option `a`. A fresh DOM query still saw Coast unchecked. The original fixture immediately clicked the still-disabled Send button, so no command was sent and no refusal alert could appear. All trace values are synthetic fixture data.

A controlled witness wraps the real request store subscription before mounting the same view:

```ts
const subscribe = requestAnswerStore.subscribe
vi.spyOn(requestAnswerStore, 'subscribe').mockImplementation(listener =>
  subscribe(() => queueMicrotask(listener)))
```

This delivers the notification at the next microtask, exposing the same store-before-render boundary without a sleep or timeout change. The original test failed at its exact missing-alert assertion (one failed, 21 skipped; 10.21 seconds). The corrected test passed at the same boundary (one passed, 21 skipped; 4.15 seconds). The temporary wrapper was restored after cleanup and lives only in an ignored diagnostic copy renamed `.probe.txt`, outside Vitest discovery. The ordinary test uses the real unwrapped subscription.

## Verification

- Original personal-chat file plus request-card neighbors: 47 passed, two files (7.06 seconds), `--maxWorkers=2`.
- Typecheck, lint and notices passed. The protected full gate is queued.
- Independent Standards and Spec review: pending.
- This changes only a test fixture. No Electron surface, design baseline, live provider, paid turn or personal profile was used. `SOTTO_PERF_DATA` pointed to a verified-absent owned path.