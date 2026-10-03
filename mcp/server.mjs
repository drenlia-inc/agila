/**
 * Agila API MCP server (stdio, Content-Length framed JSON-RPC).
 * Env: AGILA_BASE_URL, AGILA_API_TOKEN
 */
const base = (process.env.AGILA_BASE_URL || '').replace(/\/$/, '');
const token = process.env.AGILA_API_TOKEN || '';

const tools = [
  { name: 'list_boards', description: 'List boards visible to this token', method: 'GET', path: '/api/v1/boards' },
  { name: 'create_board', description: 'Create a board with columns', method: 'POST', path: '/api/v1/boards' },
  { name: 'create_sprint', description: 'Create a sprint (admin token)', method: 'POST', path: '/api/v1/sprints' },
  { name: 'upsert_task', description: 'Create or update a task by external key', method: 'POST', path: '/api/v1/tasks' },
  { name: 'move_task', description: 'Move a claimed task', method: 'POST', path: '/api/v1/tasks/{id}/move' },
  { name: 'claim_task', description: 'Claim the next card on a board', method: 'POST', path: '/api/v1/boards/{id}/claim' },
  { name: 'check_criterion', description: 'Mark an acceptance criterion done or not', method: 'PATCH', path: '/api/v1/tasks/{taskId}/acceptance-criteria/{criterionId}' },
  { name: 'apply_plan', description: 'Create a sprint, board, and cards', method: 'POST', path: '/api/v1/plans' }
];

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

async function callTool(name, args) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error('Unknown tool');
  if (!base || !token) throw new Error('AGILA_BASE_URL and AGILA_API_TOKEN are required');
  let route = tool.path;
  const rest = { ...(args || {}) };
  for (const key of ['id', 'taskId', 'criterionId']) {
    if (rest[key] != null) {
      route = route.replace(`{${key}}`, encodeURIComponent(String(rest[key])));
      delete rest[key];
    }
  }
  const url = `${base}${route}`;
  const init = {
    method: tool.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  };
  if (tool.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(rest);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, body: text };
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.id == null && message.method) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agila-api', version: '1.0.0' }
      }
    });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: { type: 'object', additionalProperties: true }
        }))
      }
    });
    return;
  }
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: result.body }],
          isError: result.status >= 400
        }
      });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: error.message }], isError: true }
      });
    }
    return;
  }
  if (message.id != null) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not found' }
    });
  }
}

let buffer = Buffer.alloc(0);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.slice(start, start + length).toString('utf8');
    buffer = buffer.slice(start + length);
    try {
      void handle(JSON.parse(body));
    } catch {
      // Ignore malformed frames.
    }
  }
});
