import http from 'http';
import { TaskQueue } from '../runtime/taskQueue';
import { config } from '../config';
import { RuntimeServices } from '../runtime/services';

export interface DashboardStatusProvider {
  getPendingApprovalCount(): number;
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMac Dashboard</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#0b0d10; color:#e8eef5; margin:0; padding:24px; }
    h1,h2 { margin:0 0 12px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; }
    .card { background:#141920; border:1px solid #2a3442; border-radius:12px; padding:16px; }
    pre { white-space:pre-wrap; word-break:break-word; margin:0; }
    .muted { color:#9fb0c3; }
  </style>
</head>
<body>
  <h1>OpenMac Dashboard</h1>
  <p class="muted">Local runtime status and audit view</p>
  <div id="app" class="grid"></div>
  <script>
    async function load() {
      const response = await fetch('/api/status');
      const status = await response.json();
      const app = document.getElementById('app');
      app.innerHTML = [
        ['Health', JSON.stringify(status.health, null, 2)],
        ['Queue', JSON.stringify(status.queue, null, 2)],
        ['Sessions', JSON.stringify(status.sessions, null, 2)],
        ['Memory', JSON.stringify(status.memory, null, 2)],
        ['Audit', JSON.stringify(status.audit, null, 2)],
      ].map(([title, body]) => '<div class="card"><h2>' + title + '</h2><pre>' + body + '</pre></div>').join('');
    }
    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}

export function createDashboardServer(taskQueue: TaskQueue, approvals: DashboardStatusProvider, services: RuntimeServices) {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderHtml());
      return;
    }

    if (url === '/api/status') {
      const body = {
        health: {
          version: config.app.version,
          ollamaHost: config.ollama.host,
          remoteSafeMode: services.isRemoteSafeModeEnabled(),
          pendingApprovals: approvals.getPendingApprovalCount(),
        },
        queue: taskQueue.getSnapshot(),
        sessions: {
          count: services.getSessionCount(),
          recent: services.listSessions(10),
        },
        memory: {
          facts: services.countFacts(),
          vectors: await services.countVectors(),
        },
        audit: services.readRecentAudit(20),
      };

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return {
    async start(): Promise<void> {
      if (!config.dashboard.enabled) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.dashboard.port, '127.0.0.1', () => {
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
      return config.dashboard.port;
    },
  };
}
