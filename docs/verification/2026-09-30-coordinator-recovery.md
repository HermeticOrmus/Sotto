# Coordinator recovery

Verified on Windows, September 30, 2026, with scripted providers. No live provider account was used.

## Behaviour

- Stop is dispatched when saving the follow-up queue pause fails. The assignment stays paused, and the error tells the user to review the thread before resuming queued messages. A separate failure to save the Stop intent still prevents dispatch and reports that failure.
- An uncertain Stop can be retried without replaying a prompt. The existing independent interrupt lanes and prompt admission checks stay in place.
- Loading earlier messages preserves management, context age, attention and speech. Coverage includes 2,001 earlier messages, two unchanged refreshes, and actual manual input both during and after paging.
- Shutdown cancellation preserves the managed assignment without a false blocked item, including a failed final write and restart.
- An uncertain answer records attribution once; a definitive refusal does not.
- Coordinator actions retain their client context and use the existing command admission policy.

## Electron journeys

`npm run build` and Playwright over `agentControl.spec.ts`, `agentAnswers.spec.ts`, `command-receipt.spec.ts` and `queued-steering.spec.ts`: 15 passed. The journeys cover saved answers and restart, management and takeover, uncertain delivery, draft saving, reconnect, and keyboard steering without consuming a newer draft.

The queued-message journey captures light and dark appearances at 1600x1000, 1280x800 and 820x560, checks that the queue does not overflow, and exercises reduced motion. The dark minimum-size and light full-size captures were visually inspected. The existing [dark minimum-size capture](../../artifacts/queued-steering/dark-820.png) and [light full-size capture](../../artifacts/queued-steering/light-1600.png) show the retained layout. Incidental screenshot changes were restored; no look changed and no baseline was regenerated.

Queue-pause storage failure, paging and shutdown timing were verified through coordinator and workspace regression tests rather than injected into the Electron renderer. macOS and live-provider behaviour were not tested.

## Review

Separate standards and spec reviews found missing prototype-spy cleanup and a history window exceeding the 2,000-ID retention limit. Both were fixed and reviewed again with no remaining findings.
