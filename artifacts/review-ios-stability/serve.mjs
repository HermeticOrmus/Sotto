import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
const root = resolve('.')
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname))
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
  try {
    const data = await readFile(file)
    res.setHeader('Content-Type', extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404); res.end() }
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/artifacts/review-ios-stability/thread-list-prototype.html`))
