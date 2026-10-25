// A stand-in dev server for the web preview e2e (#74): prints its address like Vite does.
import http from 'node:http'
import process from 'node:process'

const page = (title) =>
  `<!doctype html><title>${title}</title><h1>${title}</h1><a id="two" href="/two">two</a>`
// The first page logs an error and asks for an image that isn't there (Attach to chat's report).
const broken = '<script>console.error("BOOM in app")</script><img src="/missing.png">'
const server = http.createServer((req, res) => {
  if (req.url === '/missing.png') {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(req.url === '/two' ? page('PAGE TWO') : page('PREVIEW OK') + broken)
})
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('\x1b[32m  VITE v0.0.0\x1b[39m  ready\n')
  process.stdout.write(`  ➜  Local:   http://127.0.0.1:${server.address().port}/\n`)
})
