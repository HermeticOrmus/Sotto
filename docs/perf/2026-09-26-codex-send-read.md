# The read before a Codex send - September 26, 2026

Issue #324. Before `turn/start`, a Codex send called `refreshThread`, which read the whole transcript with
`thread/read` and `includeTurns: true`, applied every turn, saved the thread record, and tried again up to three times
if the thread moved while it read. The read is there so that a reply written against an old last message is refused
when someone has since typed into the same session from another Codex process. It grew with the thread, so it was
measured first, and the decision followed from what the installed Codex offered.

The decision: the send now asks for the newest turn alone, with `thread/turns/list`, and reads the whole transcript
only when that turn is not the finished one Sotto already holds (the newest-turn check, ADR-0005). What it rests on is
under "Against Codex CLI 0.157.1" below. The references in the issue still pointed at the right code: `codex.ts:384` is
the personal-chat send's read and `codex.ts:446` is `refreshThread` itself; the project send's read was further down,
in `executeNative`. Both sends use the check now.

## Against the fake app-server

`tests/perf/codexSendRead.perf.test.ts` seeds a thread in `tests/fixtures/fakeCodexAppServer.mjs` with 50, 500 and
2,000 finished turns, opens it the way the Threads page does, and sends five prompts, each after the last one's turn
has finished and with `expectedLastUserMessageId` set to the thread's last user message. A seeded turn is a 200-
character prompt, a reasoning summary, a command with 2 KB of output and a 1,200-character reply, all filler, which
makes a whole read about 4.4 KB a turn. It times the send to `accepted`, `refreshThread` inside it, and within that
the round trips and the applying and saving done inside them; it counts the requests each send made and weighs the
replies the fake sent. "Before" is `codex.ts` as of `origin/main` (`e093bd6c`) under the same benchmark; "after" is
this change. Each was run three times; the figures are medians of the five sends in a run and the ranges are across
the three runs.

| Turns | Send, before | Send, after | Read inside it, before | Read inside it, after |
| ---: | ---: | ---: | ---: | ---: |
| 50 | 51-81 ms | 25-32 ms | 32-51 ms | 8-9 ms |
| 500 | 478-728 ms | 65-108 ms | 429-669 ms | 18-31 ms |
| 2,000 | 2,920-5,481 ms | 235-280 ms | 2,723-5,286 ms | 60-99 ms |

| Turns | Whole reads per send, before / after | Reply size, before | Reply size, after |
| ---: | ---: | ---: | ---: |
| 50 | 1 / 0 | 220,566 bytes | at most 4,440 bytes |
| 500 | 1 / 0 | 2,187,966 bytes | at most 4,440 bytes |
| 2,000 | 1 / 0 | 8,745,966 bytes | at most 4,440 bytes |

Where the old read's time went: applying the reply was 15-20 ms of it at 50 turns, 392-601 ms at 500 and
2,540-4,989 ms at 2,000. From 500 turns up, 90-95% of the read was Sotto's own work rather than Codex sending the
transcript, and it grew faster than the thread did. Saving the thread record inside the read was 3-38 ms at every size. After the change
every send in every run was answered by the check alone: one `thread/turns/list` of one turn, no `thread/read`. The
largest such reply is the first send's, whose newest turn is a seeded one; after that the newest turn is the
benchmark's own short one, 442 bytes, whose user message is 170 bytes. That user message is all the
`expectedLastUserMessageId` check compares, and the old read carried the whole thread to get it.

What remains of the read at 2,000 turns, 60-99 ms, is mostly the fake: it copies the whole thread to answer any
history request, and its save of the thread on `turn/start` is inside the send figure too. Saving the thread record,
which holds an identity for every turn, is 19-38 ms of it.

## Against Codex CLI 0.157.1

The fake cannot say what the real app-server does, so the check was built only after the installed client showed
four things. `tests/integration/codexNewestTurnNative.test.ts` (`SOTTO_CODEX_TURNS_LIVE=1`) repeats them. It starts the
installed app-server in a throwaway `CODEX_HOME`, so it reads none of the user's Codex threads and needs no sign-in,
starts a legacy thread, makes its session file exist with one injected message pair, and writes filler turns into that
file the way Codex writes a turn. No model turn is run.

1. `thread/turns/list` is in the generated schema without `--experimental`, newest first by default, with `limit` and
   `itemsView`.
2. It works on a legacy thread, which is what Sotto creates. (`thread/items/list` does not: "not supported yet".)
3. Its one newest turn has the same turn ID, item IDs and status as the last turn of `thread/read`, and both are the
   same on every read.
4. On a thread this app-server has resumed, both see a turn written to the session file from outside, which is how a
   second Codex process adds one. The thread's `updatedAt` did not move when that turn was written, so a timestamp
   could not have stood in for either request.

Each request's round trip at the check's own client, median of five, ranges across four runs:

| Turns | Session file | `thread/read`, includeTurns | Reply | `thread/turns/list`, limit 1 | Reply |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 0.3 MB | 5.5-7.5 ms | 108,703 bytes | 5.1-6.8 ms | 2,377 bytes |
| 500 | 2.8 MB | 30-69 ms | 1,080,304 bytes | 25-54 ms | 2,380 bytes |
| 2,000 | 11.1 MB | 122-150 ms | 4,321,804 bytes | 98-119 ms | 2,380 bytes |

The two take nearly the same time, so Codex appears to read the whole legacy session file for either request and the
check saves it little; what it saves is
the transcript on the pipe, 4.3 MB at 2,000 turns of this shape, and Sotto parsing and applying all of it, which the
fake shows is where the seconds were.

## What the check keeps

The check decides whether a whole read is needed, never whether the send may go. It answers "nothing changed" only
when the newest turn is the one Sotto already holds, has ended, and reconciles onto exactly the messages Sotto has;
then the send makes the same `expectedLastUserMessageId`, running and request checks as before. Anything else reads the
whole transcript as before: another process's new turn, a turn still running, a turn taken back, a message Sotto cannot
match, a thread not read on this connection, pending settings, rewind, compaction or uncertain delivery, session-log
input not yet shown, and a Codex that refuses the request; one that does not have the request at all is not asked
again on that connection. The
session log is polled before the check and again before `turn/start`, as it was.

The adapter contract's takeover and stale-input cases pass unchanged. `tests/integration/codexNewestTurn.test.ts` adds
the check's own cases on the fake: a send after a finished turn uses the check alone, including when Codex names
history items differently from its stream; a turn another process added, or is still running, is read in full and
the stale reply refused before `turn/start`; a turn another process took back is read in full; and a Codex without
`thread/turns/list` is read in full and asked once per connection.

## What these numbers are not

- The fake's times are Sotto's adapter and a small Node script, not a real client; the real client's times are its
  round trips alone, without Sotto applying the reply. The turn shapes in both are filler chosen to look like a coding
  turn, not measured from real threads.
- Opening a thread still reads it whole and was not changed: 9.2-11.8 s at 2,000 turns before and 12.6-17.1 s after
  on the fake, the same code on a busier machine. That applying cost grows faster than the thread does. `applyTurn`
  sorts the whole message window once for every turn it applies, which is a likely cause; it was not measured
  separately and is left for its own issue.
- Taken on the Windows development machine (Intel Core Ultra 9 275HX, Node v24.14.1) while other agents' test suites
  were running on it, which is why the before ranges are wide. Read them as sizes, not budgets. Nothing asserts a time.

## Re-run

```sh
SOTTO_PERF_BENCH=1 npx vitest run tests/perf/codexSendRead.perf.test.ts --maxWorkers=1 --disable-console-intercept
SOTTO_CODEX_TURNS_LIVE=1 npx vitest run tests/integration/codexNewestTurnNative.test.ts --maxWorkers=1 --disable-console-intercept
```
