# Feature: headless host

- Reach: `npm run test:host`, `npm run test:socket`, `npm run package:host`
- Where: Linux for the socket contract, which only the Linux job runs. Any OS for the others.
- Evidence: command output + the packaged archive's SHA256 line.
