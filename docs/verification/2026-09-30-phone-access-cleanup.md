# Phone access cleanup recovery

The host protocol stops before cleanup begins. Its existing listener becomes a placeholder that immediately closes connections without releasing the port. A restart reserves the saved port directly before checking Serve. Cleanup releases the placeholder only after removal and the saved record update succeed.

Recovered records retain a durable pending-cleanup marker. Read errors preserve the unreadable file. Sotto checks Serve, but an occupied setting cannot be removed without a readable record identifying it as Sotto’s; restoring that record lets Try again finish cleanup. A free Serve port clears pending cleanup normally.

The focused main, renderer and integration suites passed 44 tests. Six new main and integration cases failed against the preceding implementation. Coverage includes a real paired phone disconnect, refused new connections, the same port remaining bound until cleanup succeeds, restart with the setting on and off, setup failure while the setting stays on, unreadable and corrupt records, recovery across another restart, and restoration of the record. Tailscale is a fake; loopback binding and phone sockets are real in the connection checks.

Forge has no display. The Phones Electron e2e spec and visual checks were not run locally. Renderer tests cover the cleanup explanation and retry control. No visual restyle or baseline regeneration was requested.
