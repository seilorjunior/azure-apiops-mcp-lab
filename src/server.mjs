import { randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

export function writeLog(level, event, fields = {}) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createApp(backendKey, { log = writeLog } = {}) {
  if (typeof backendKey !== 'string' || backendKey.length < 32) {
    throw new Error('POC_BACKEND_KEY must contain at least 32 characters.');
  }
  const expected = Buffer.from(backendKey);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.set('x-request-id', requestId);
    const started = performance.now();
    res.on('finish', () => log('info', 'http_request', {
      requestId,
      method: req.method,
      route: ['/health', '/mcp'].includes(req.path) ? req.path : 'other',
      status: res.statusCode,
      elapsedMs: Math.round(performance.now() - started),
    }));
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/mcp', (req, res, next) => {
    const actual = Buffer.from(req.get('x-poc-backend-key') ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb', inflate: false }));
  app.post('/mcp', async (req, res, next) => {
    const server = new McpServer({ name: 'apiops-poc-backend', version: '1.0.0' });
    server.registerTool('echo', {
      description: 'Echo a message to verify an MCP request reached the backend.',
      inputSchema: { message: z.string().min(1).max(200) },
    }, async ({ message }) => ({
      content: [{ type: 'text', text: JSON.stringify({ message, source: 'external-mcp' }) }],
    }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      server.close().catch(() => log('error', 'mcp_cleanup_failed', { requestId: res.locals.requestId }));
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST').status(405).json({ error: 'Stateless MCP accepts POST only.' });
  });
  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status : 500;
    log('error', 'mcp_request_failed', { requestId: res.locals.requestId, status });
    if (!res.headersSent) {
      res.status(status).json({ error: 'MCP request failed.' });
    }
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const server = createApp(process.env.POC_BACKEND_KEY).listen(port, '0.0.0.0', () => {
    writeLog('info', 'server_started', { port });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      writeLog('info', 'server_stopping', { signal });
      const timer = setTimeout(() => {
        writeLog('error', 'server_shutdown_timeout');
        process.exit(1);
      }, 10_000);
      timer.unref();
      server.close((error) => {
        clearTimeout(timer);
        if (error) writeLog('error', 'server_shutdown_failed');
        process.exitCode = error ? 1 : 0;
      });
    });
  }
}
