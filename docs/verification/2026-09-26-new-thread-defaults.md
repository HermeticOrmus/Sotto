# A new thread opens straight away, on defaults from Settings (#347)

Checked on September 26, 2026, on Windows, in the built app (`npm run build`, then `npx playwright test tests/e2e/thread-creation.spec.ts tests/e2e/settled-folder-new-thread.spec.ts tests/e2e/thread-agent-inheritance.spec.ts tests/e2e/workspace-projects.spec.ts tests/e2e/thread-worktrees.spec.ts --workers=1`). The captures are in `artifacts/new-thread-defaults/`. The design is variant b of the prototype on `prototype/new-thread-defaults`, with the composer's own model selector.

## Starting a thread

- `fresh-thread-dark-1280.png` and `fresh-thread-light-820.png`: the pen on a project row opens an empty "New thread" in that project at once, selected, with its composer focused and the default model, effort and permissions on its chips. No dialog opens. The thread names itself from its first exchange.
- `chooser-dark-1280.png` and `chooser-light-820.png`: the sidebar's top **New thread** button asks only which project; choosing one opens the thread the same way.
- **Ctrl+Shift+N** opens a new thread in the focused thread's project, or the chooser when no thread is focused. It stands down when the dictation hotkey claims the chord (`tests/unit/renderer/newThreadShortcut.test.ts`).
- A new thread in a settled project still returns the folder to Projects with only that thread, and the working-copy default (project folder or new worktree) still applies (`settled-folder-new-thread.spec.ts`, `thread-worktrees.spec.ts`).
- A creation the app refuses shows its reason in the sidebar and changes nothing (`thread-agent-inheritance.spec.ts`).

## The defaults

- `settings-agents-dark-1280.png` and `settings-agents-light-820.png`: Settings → Agents has a **New threads** group with one row, **New threads start with**, holding the composer's model, effort and permissions chips. The reasoning rows sit under **Personal chats and reasoning**, and the project rows under **Projects**. At 1280 the chips sit on one line; at 820 they wrap.
- `settings-agents-model-menu-dark-1280.png` and `-light-820.png`: the model chip opens the composer's own model selector, grouped by provider.
- Main applies the defaults to any new thread that leaves an option unset, including the coordinator's and voice's; a thread's own choices win (`tests/unit/main/newThreadDefaults.test.ts`). A default effort the chosen model lacks falls to the nearest level it has. A permissions default the provider lacks falls to its nearest safer mode (Grok: Allow edits → Ask for approval), which the row says, and Devin starts on its first profile (`tests/unit/shared/newThreadDefaults.test.ts`).
- An existing install keeps today's behaviour until the user picks: the model comes from the reasoning model, and effort and permissions stay at the provider's default.

## Unchecked

- 1600x1000, reduced motion, and macOS.
- Paired remote clients cannot change the new-thread defaults; they stay a desktop setting.
