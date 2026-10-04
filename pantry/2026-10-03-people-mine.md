# People mine: Sotto

**Dated run:** 2026-10-03 (America/Chicago CT). This is the first people mine for Sotto. It is a read-only pass over `millZach/Sotto` issues, pull requests and comments through the GitHub connector. Nothing was commented on, labelled or changed there.

**Result in one line:** few outside voices exist yet. Apart from Zach (owner) and Diego (`HermeticOrmus`, this fork's own seat), the only person writing in `millZach/Sotto` is **@sudoTomas**, a collaborator who opened 3 issues and 1 PR, all about the Apple-silicon Mac pass and remote sessions. There are no issues from users without repo access, and no `feedback` label in the read set.

What people who use the product said in its own public places: issues, issue comments, discussions, pull requests, and forks that changed something. Optional third pantry source; a product with no outside voices yet leaves the Hits table empty and says so.

## How this fills

1. List the product's own repos (the kitchen law names them).
2. Read what people outside the maintainers wrote since the last run: issues (the `feedback` label first), issue comments, discussions and their comments, pull requests, and forks with commits ahead of the default branch.
3. One row per voice. Quote a short snippet and link the exact issue, comment, discussion, PR or commit. Say whether they gave credit consent when the source has a consent box.
4. Tag each row with the capability it is about, in the same words as the competitor map's matrix, so the queue can cite it next to competitor and X rows.
5. Never count stars as feedback, never infer sentiment the person did not state, never paraphrase a number. Maintainers' own issues are not voices.
6. Save as `YYYY-MM-DD-people-mine.md` beside the other dated files (keep this TEMPLATE).

## Hits

| Repo | Kind (bug/feature/question/praise/contribution) | Snippet | Link | Theme (matrix capability) | Credit consent |
|------|--------------------------------------------------|---------|------|---------------------------|----------------|
| millZach/Sotto | feature | "I run Claude Code and Grok Build on a remote machine, often inside a terminal and sometimes inside a zellij session. I want Sotto to connect to that machine, list those sessions, preview one, and attach to it" (@sudoTomas, 2026-10-01, `enhancement`, `ready-for-human`) | https://github.com/millZach/Sotto/issues/669 | Remote hosts you own · Multi-vendor agents | n/a (no consent box) |
| millZach/Sotto | feature (scoping) | "Importing or attaching to a session Sotto did not create contradicts the rule above. That needs an ADR before a patch." (@sudoTomas, same issue) | https://github.com/millZach/Sotto/issues/669 | Remote hosts you own | n/a |
| millZach/Sotto | bug | "When the main window is full screen, on its own desktop, Sotto often switches back to that desktop while I am in another app." (@sudoTomas, 2026-10-01, `bug`, `P2`) | https://github.com/millZach/Sotto/issues/670 | macOS desktop (Apple-silicon platform; no matrix column) | n/a |
| millZach/Sotto | contribution | "Finish the Apple silicon macOS pass of the Electron app" (issue title; @sudoTomas, 2026-09-20, assigned to themself, `ready-for-human`) | https://github.com/millZach/Sotto/issues/169 | macOS desktop · Built-in dictation | n/a |
| millZach/Sotto | bug | "**LSMinimumSystemVersion is 12.0** (README said 11)." (@sudoTomas comment) | https://github.com/millZach/Sotto/issues/169#issuecomment-5754606471 | macOS desktop | n/a |
| millZach/Sotto | bug | "The Playwright packaged smoke (`firstWindow`) hung after the app had already written `threads.sqlite`." (@sudoTomas comment) | https://github.com/millZach/Sotto/issues/169#issuecomment-5754606471 | macOS desktop | n/a |
| millZach/Sotto | bug | "Onboarding microphone test: the level bars stayed still after the mic was granted." (@sudoTomas comment) | https://github.com/millZach/Sotto/issues/169#issuecomment-5754701242 | Built-in dictation | n/a |
| millZach/Sotto | bug | "Chromium's permission *check* returned true for any trusted renderer, so macOS never showed a TCC dialog and getUserMedia succeeded with silence." (@sudoTomas comment) | https://github.com/millZach/Sotto/issues/169#issuecomment-5754754388 | Built-in dictation | n/a |
| millZach/Sotto | contribution | "Make Sotto behave like a Mac app on Apple silicon" (open PR, @sudoTomas, 2026-09-29; closes #670, part of #169) | https://github.com/millZach/Sotto/pull/479 | macOS desktop · Built-in dictation · Integrated terminal | n/a |
| millZach/Sotto | bug | "Packaged `package:dir:mac` still hangs in `application.firstWindow`." (PR #479, Out of scope) | https://github.com/millZach/Sotto/pull/479 | macOS desktop | n/a |
| millZach/Sotto | bug | "Each unsigned rebuild asks again for the microphone, Accessibility, Automation and the Keychain item, because macOS keys those grants to the code signature." (PR #479, Known limitation) | https://github.com/millZach/Sotto/pull/479 | macOS desktop · Built-in dictation | n/a |
| millZach/Sotto | bug | "Option is no longer Meta in the terminal, which had blocked" some keys "on Spanish, German and French layouts" (PR #479, After review) | https://github.com/millZach/Sotto/pull/479 | Integrated terminal | n/a |

### What recurs

- **macOS parity is the main outside thread.** 3 of @sudoTomas's 4 items (#169, #670, PR #479) are the Apple-silicon pass: packaged smoke hang, microphone permission and TCC, Spaces and full-screen, and re-granting permissions after every unsigned rebuild. That work belongs to @sudoTomas upstream, so the queue does not restock it.
- **Attach to sessions started outside Sotto** (#669) is the one product request from outside. X shows the same need (@TheRealAfroRick, @xenognostic in the X mine). It is labelled `ready-for-human` and needs an ADR first.
- **Dictation capture correctness** shows up inside the Mac pass: a silent meter and permission check vs request. These are bugs on the dictation surface, not requests for new features.

## Read log (what we read)

- **Repos:** `millZach/Sotto` (the product). We also read `HermeticOrmus/Sotto` PRs for in-flight context only. That is this fork, so it is not a voice.
- `list_issues` state=all, newest first, 1 page of 100. Those are issues and PRs #621–#720, created 2026-09-30 to 2026-10-01: 92 by millZach, 6 by HermeticOrmus, 2 by sudoTomas. Older pages were not listed one by one. The searches below cover them by author.
- `search_issues` `repo:millZach/Sotto -author:millZach -author:HermeticOrmus` found 3 issues: #670, #669 and #169, all by sudoTomas.
- `search_pull_requests` `repo:millZach/Sotto -author:millZach` found 3 PRs: #661 and #660 (HermeticOrmus) and #479 (sudoTomas).
- `search_issues` `repo:millZach/Sotto comments:>0` found 104 issues. Of the first 100 returned, 99 were opened by millZach and 1 by sudoTomas (#169). The comment threads on millZach's own issues were **not** read one by one, so a non-maintainer comment on one of them could have been missed. `commenter:sudoTomas` matched only #169.
- **Comments read:** #169 (5, all sudoTomas). PR #479 (1, the Greptile bot, so not a voice). PR #661 (3: the Greptile bot; millZach through the ChatGPT Codex connector, who is the owner and so not a voice; and HermeticOrmus). PR #660 (1, the Greptile bot).
- **Owner review context (not a voice, carried to the queue):** on PR #661 the owner's review asked to "Keep jump-host destinations selectable" ([comment](https://github.com/millZach/Sotto/pull/661#issuecomment-5923809840)). The fix landed on the fork as `b1f8aee3`. The edge left open in [Diego's reply](https://github.com/millZach/Sotto/pull/661#issuecomment-5957073939) ("a ProxyCommand through a non-ssh tunnel (for example `cloudflared access ssh`) is treated as direct") is what HermeticOrmus/Sotto#1 now covers.
- **Diego's own items** (#655–#658, #660, #661) are this fork's seat, not outside voices. They are listed here only so the queue can cite them: #655/#660 dictation disclosure ("audio goes to OpenRouter"), #656/#661 Add host, #657 Claude permission mode, #658 mise update loop.
- **Discussions:** not checked on `millZach/Sotto` this run. `HermeticOrmus/Sotto` has discussions and issues turned off (`has_discussions: false`, `has_issues: false`).
- **Forks with commits ahead:** fork list not enumerated. The only known fork is this one (`HermeticOrmus/Sotto`, ours).
- **Labels:** no `feedback` label appeared on any issue read.
- **Connector errors:** one GitHub secondary rate limit on search. It was retried a few minutes later and worked.
