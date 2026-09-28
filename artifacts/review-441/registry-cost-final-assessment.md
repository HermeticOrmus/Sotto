# Independent worktree cost assessment

Original implementation: `671d4807`. Final source: `cf208104`, composed with main at `d766f97744569dcdcf70aa6a54de542f9934a910`. The harness bundles each revision's `threadWorktrees.ts` against the same installed dependencies. Fixtures are separate owned synthetic Git repositories; no provider or personal profile is involved. Timed regions exclude fixture setup and bundling. Seven alternating pairs retain raw Git arguments, individual command times and operation wall time; parallel command times must not be added as elapsed time.

The initial coordination wrapper added 3/1/2 Git subprocesses to fresh creation, inspection and existing-worktree ensure. The revised operation-local identity flow removed those additions without a persistent path cache. In the first revised nine-workflow comparison (`62c5291c`), established discovery retained an extra sequential Git phase despite equal call counts and was slower in all seven pairs. The final discovery correction removes that phase, reusing reads from the same operation while independently checking the expected repository. Git status remains after ownership and working-directory validation.

| Workflow | Original Git calls | Final Git calls | Timing evidence |
| --- | ---: | ---: | --- |
| Fresh ensure | 7 | 7 | Final paired median +2.8 ms, range -42.3 to +31.3 ms |
| Inspect | 5 | 5 | First revised paired delta crosses zero |
| Ready ensure | 6 | 6 | First revised paired delta crosses zero |
| Ready action validation | 5 | 5 | First revised paired delta crosses zero |
| Shared inspect | 3 | 3 | Unchanged behavior; observed timing noise |
| Established discover | 8 | 6 | Final paired median -13.9 ms, range -47.0 to +26.3 ms |
| Shared discover | 6 | 4 | First revised paired median -82.3 ms |
| Missing worktree restore | 5 | 5 | First revised paired delta crosses zero |
| Shared branch switch | 8 | 8 | First revised paired delta crosses zero |

The first revised fresh-ensure comparison was slower in all seven pairs (+25.7 ms paired median); unchanged Git add/status commands accounted for much of the difference. An original-versus-original control showed -44.5 to +23.6 ms paired variation while memory rose from 78.7% to 90.0%, with absolute times also much higher. The final repeat, under stable 77.12% to 76.23% memory commitment, did not reproduce the consistent fresh slowdown: original/candidate medians were 273.0/270.6 ms. Established-discovery medians were 269.8/261.0 ms. The final two-workflow probe completed in 12.97 seconds, exit 0. Separate attempts above the 92% guard did not launch a Node probe.

Independent judgment: no remaining demonstrated added latency in these measured workflows, and no extra Git subprocesses or sequential phases in their final source paths. This is bounded synthetic evidence, not a universal zero-latency guarantee or a whole-app performance claim. Correctness, integrated CI and real desktop acceptance are separate gates.

Retained evidence:

- `registry-cost-62c5291c-receipt.json`: first revised nine-workflow comparison, including the slower results.
- `registry-cost-671d4807-identical-control-receipt.json` and `registry-cost-identical-control-memory.json`: identical-source control.
- `registry-cost-d766f977-final-pair-receipt.json` and `registry-cost-final-pair-memory.json`: final fresh/discovery repeat with stable memory.
- `registry-cost-probe.mjs`: ignored reproducible harness. No `.test` or `.spec` artifact is introduced.
