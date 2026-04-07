import http from 'http';
import { config } from '../config';
import { RuntimeApi } from './api';

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createRuntimeServiceServer(api: RuntimeApi) {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (req.method === 'GET' && url === '/api/status') {
      const body = await api.getStatusSnapshot();
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'GET' && url === '/api/sessions') {
      const body = api.listSessions(20);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'GET' && url === '/api/approvals') {
      const body = api.listPendingApprovals();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'POST' && url === '/api/prompt') {
      const body = await readJsonBody(req);
      const responseText = await api.submitPrompt({
        source: body.source,
        sourceId: body.sourceId,
        prompt: body.prompt,
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, response: responseText }));
      return;
    }

    if (req.method === 'POST' && url === '/api/approvals/settle') {
      const body = await readJsonBody(req);
      const settled = api.settleApproval(body.id, Boolean(body.approved));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: settled }));
      return;
    }

    if (req.method === 'POST' && url === '/api/control/remote-safe') {
      const body = await readJsonBody(req);
      api.setRemoteSafeMode(Boolean(body.enabled));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, enabled: Boolean(body.enabled) }));
      return;
    }

    if (req.method === 'POST' && url === '/api/control/session-model') {
      const body = await readJsonBody(req);
      api.setSessionModelByKey(body.source, body.sourceId, body.model);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && url === '/api/control/session-sandbox') {
      const body = await readJsonBody(req);
      api.setSessionSandboxModeByKey(body.source, body.sourceId, body.mode);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return {
    async start(): Promise<void> {
      if (!config.runtimeService.enabled) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.runtimeService.port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      if (!server.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    getPort(): number {
      return config.runtimeService.port;
    },
  };
}
