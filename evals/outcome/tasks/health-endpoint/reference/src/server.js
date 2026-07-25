import * as http from "node:http"

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

export function createServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost")
    if (pathname !== "/health") return send(res, 404, { error: "not found" })
    if (req.method !== "GET") return send(res, 405, { error: "method not allowed" })
    send(res, 200, { status: "ok" })
  })
}
