# A Claude thread stops when its permission mode is not the one it asked for

Accepted October 1, 2026, for issue #657.

Sotto launches Claude Code with `--permission-mode` taken from the thread's mode, and until now it trusted that the process ran in that mode. The CLI says which mode it is actually in: the `system/init` frame carries `permissionMode`. A wrapper on PATH, a shell alias baked into a launcher, or managed settings can change the mode after Sotto has chosen the flag. ADR-0036's lookup finds a user wrapper in `~/.local/bin` ahead of the installed binary, so a thread showing Auto can be running with every check bypassed while the composer still says Auto.

This follows ADR-0004. The mode the user picked is the policy. The mode the CLI reports is evidence, and the two have to agree. It does not change who answers a request.

## Decision

**Compare the init frame's `permissionMode` with the mode Sotto asked for.** That is the mode the process was launched with. A `set_permission_mode` control request Sotto sends moves the expected mode when the request goes out, and the previous mode is put back if the CLI refuses, so a change the user made in Sotto does not read as a mismatch. The first init frame is the process as it was launched, including when it arrives after that request has already moved the expected mode; later frames are compared with the mode Sotto asked for. Entering or leaving full access still starts the CLI again, and the new process is checked against the mode it was launched with. An init frame that does not name a mode says nothing, and is not a mismatch.

**A mismatch stops the turn before any tool runs.** The adapter interrupts the turn. A tool ask that still arrives is denied and not shown. The thread carries a plain notice naming the mode it asked for and the mode Claude Code started in, and saying that a wrapper script or managed settings may have changed it. Nothing ran. A prompt is not written into a session whose init frame already disagreed. A later init frame that reports the expected mode takes the notice down.

Sotto does not adopt the CLI's mode. Moving the chip to a mode the user did not choose would grant the wider mode on the CLI's evidence, which ADR-0004 does not allow.

## Consequences

- A thread whose CLI was started in another mode cannot run a tool until the thing that changed the mode is gone, or until the user picks that mode and the next init frame agrees. The notice says which two modes disagreed.
- The check is Claude Code's. Codex, Grok and Devin are unchanged.
