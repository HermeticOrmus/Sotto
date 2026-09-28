# Queue admission before renderer observation (#453)

A successful follow-up admission could put its text back into the composer if its command reply also carried an unrelated working-copy error before the renderer observed the queue. The returned queue row already owned the original revision. Treating the global error as a refusal restored the same text under a new draft ID, so a later queue publication could not clear it and another press could duplicate it.

`sendThreadRevision` now checks the reply's exact thread ID and draft ID in its queue rows or durable follow-up receipts before interpreting that error. It leaves the error in the state. Admission still means only queue ownership, not provider delivery or permission. A real refusal without exact ownership still restores the prompt; an unanswered admission stays uncertain; newer typing is preserved.

## Cause and controlled proof

PR #427's Windows gate at `79f5dcdc` failed the original real-controller queue journey at `threadNavigationConnection.test.tsx:380`, with 5,931 tests passing and 140 skipped. The queue contained the second prompt, but the connected composer still displayed it. That run did not capture the receipt ordering.

A synthetic witness retained the real controller, disk, renderer and original assertions. It issued the real unsupported working-copy refresh while the second queue write completed, and held only the draft store's queue observation. The reply carried both exact admission and `Working-copy status is unavailable.`. Settlement restored the admitted text as a fresh revision; the same DOM node was still connected, and releasing observation did not remove the new revision. The unchanged empty-composer assertion failed in 8.72 seconds. Committing the same ownership before the same reply passed in 3.91 seconds. This establishes the ordering defect without claiming forensic certainty about the historical run.

The regression repeats the original journey with and without held observation and waits for the actual reply settlement before checking the composer. All existing queue, disk, skills, provider-send and no-replay assertions remain. Separate cases cover both ownership forms, wrong thread and draft IDs, refusal, an unanswered reply and newer typing. No deadline or polling budget changed.

## Verification

- On unchanged production source at `aa8aaac2`, the new cases produced five desired failures and five passes (38 unrelated cases skipped; 11.70 seconds).
- After the fix, all 110 tests in the four composer, queue, draft-store and real-connection files passed (12.43 seconds, two workers).
- Static gates, independent Standards/Spec review, the actual queued-steering desktop journey and the exact hosted full remain pending at this checkpoint. No new local full pass is claimed.
- All data is synthetic and stored in owned temporary directories. Performance-data paths are verified absent; live providers and timing assertions are disabled.

Raw proof and diagnostic source are retained in the ignored `artifacts/review-453/` folder. Diagnostic sources end in `.probe.txt`, outside test discovery. Earlier diagnostic setup mistakes remain in the original #408 evidence and are not causal proof.
