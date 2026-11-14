// A stand-in OpenClaw gateway: the OpenAI chat API only, behind a bearer token. It refuses a
// wrong token or a missing session key, answers whole or as SSE, and records every request
// (any /api/sessions call among them: the real gateway has none).
const http = require('node:http');

function openclawStandin({ token, reply = (body) => `answer from openclaw to ${body.messages.at(-1).content}`, stall = false } = {}) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const hit = { method: req.method, path: req.url, auth: req.headers.authorization || '', session: req.headers['x-openclaw-session-key'] || '', hermes: req.headers['x-hermes-session-id'] || '', body };
      seen.push(hit);
      const send = (status, b) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (hit.auth !== `Bearer ${token}`) return send(401, { error: { message: 'unauthorized' } });
      if (req.method === 'GET' && req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: 'openclaw/default', object: 'model' }] });
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } });
      if (!body || !/^openclaw\/[A-Za-z0-9_-]+$/.test(body.model || '') || !Array.isArray(body.messages)) return send(400, { error: { message: 'bad request' } });
      if (!/^nexy-[A-Za-z0-9_-]+$/.test(hit.session) || body.user !== hit.session) return send(400, { error: { message: 'no session key' } });
      if (stall) return; // never answers
      const text = reply(body);
      if (!body.stream) return send(200, { id: 'c1', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const words = text.split(/(?<= )/);
      let i = 0;
      const next = () => {
        if (i < words.length) {
          res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: words[i++] }, finish_reason: null }] })}\n\n`);
          return setTimeout(next, 30);
        }
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      };
      next();
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections?.(); srv.close(); } })));
}

module.exports = { openclawStandin };
