// Stands in for a provider client's own sign-in on a host (ADR-0037), printing what the real one prints into a pipe:
// Codex's and Grok Build's device-code sign-ins, which finish by themselves once the code is entered on the page, and
// Claude Code's subscription sign-in, which waits for the code the page shows to be pasted back.
//
//   node fakeSignInCli.mjs <provider> <the client's own arguments…>
//
// FAKE_SIGN_IN_DIR is a folder of plain files the test drives it with: `<provider>.approved` stands for the user entering
// the code on the page, `<provider>.denied` for refusing it there. On success it writes `<provider>.signed-in`, which the
// test's scripted provider reads to connect. It records its arguments in `<provider>.args.json`, never a code.
// FAKE_SIGN_IN_PAGE, when set, is printed in place of the provider's own page.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const [provider, ...args] = process.argv.slice(2)
const directory = process.env.FAKE_SIGN_IN_DIR
if (!directory || !provider) { process.stderr.write('The fake sign-in needs FAKE_SIGN_IN_DIR and a provider.\n'); process.exit(2) }
const file = name => join(directory, `${provider}.${name}`)
writeFileSync(file('args.json'), JSON.stringify(args))
const grey = text => `\u001b[90m${text}\u001b[0m`, blue = text => `\u001b[94m${text}\u001b[0m`
const signedIn = () => { writeFileSync(file('signed-in'), ''); }
const page = process.env.FAKE_SIGN_IN_PAGE

if (provider === 'claude') {
  process.stdout.write('Opening browser to sign in…\n')
  process.stdout.write(`If the browser didn't open, visit: ${page ?? 'https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&state=fixture-state'}\n`)
  process.stdout.write('Paste code here if prompted > ')
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    const [code, state] = line.trim().split('#')
    if (!code || !state) { process.stderr.write('Invalid code. Please make sure the full code was copied.\n'); return }
    if (code === 'good-code' && state === 'fixture-state') { signedIn(); process.stdout.write('Login successful.\n'); process.exit(0) }
    process.stderr.write('Login failed: Invalid authorization code\n'); process.exit(1)
  })
} else {
  const code = provider === 'codex' ? 'WDJB-MJHTQ' : 'K7PX-2QRM'
  if (provider === 'codex') {
    process.stdout.write(`\nWelcome to Codex [v${grey('0.158.0')}]\n${grey("OpenAI's command-line coding agent")}\n\n`)
    process.stdout.write('Follow these steps to sign in with ChatGPT using device code authorization:\n\n')
    process.stdout.write(`1. Open this link in your browser and sign in to your account\n   ${blue(page ?? 'https://auth.openai.com/codex/device')}\n\n`)
    process.stdout.write(`2. Enter this one-time code ${grey('(expires in 15 minutes)')}\n   ${blue(code)}\n\n`)
  } else {
    process.stdout.write(`\nTo sign in, open this URL in your browser:\n\n  ${page ?? `https://accounts.x.ai/oauth2/device?user_code=${code}`}\n\n`)
    process.stdout.write(`Confirm this code in your browser:\n\n  ${code}\n\nWaiting for authorization...\n`)
  }
  setInterval(() => {
    if (existsSync(file('approved'))) { signedIn(); process.stdout.write('Successfully logged in\n'); process.exit(0) }
    if (existsSync(file('denied'))) { process.stderr.write('Error: device authorization was denied\n'); process.exit(1) }
  }, 50)
}
