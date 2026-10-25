// A stand-in dev server for the web preview e2e (#74): prints its address like Vite does.
import http from 'node:http'
import process from 'node:process'

const page = (title) =>
  `<!doctype html><title>${title}</title><h1>${title}</h1><a id="two" href="/two">two</a>`
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(page(req.url === '/two' ? 'PAGE TWO' : 'PREVIEW OK'))
})
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('\x1b[32m  VITE v0.0.0\x1b[39m  ready\n')
  process.stdout.write(`  ➜  Local:   http://127.0.0.1:${server.address().port}/\n`)
})
