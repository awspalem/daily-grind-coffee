import { Hono } from 'hono';
import type { Env } from '../types/env';
import { McpServer, type McpRpcRequest } from '../services/mcpServer';

const mcpApp = new Hono<{ Bindings: Env }>();

// POST /api/mcp (JSON-RPC 2.0 endpoint for agent tool protocol)
mcpApp.post('/', async (c) => {
  const body = await c.req.json<McpRpcRequest>();
  const server = new McpServer(c.env.DB);
  const response = await server.handleRequest(body);
  return c.json(response);
});

export { mcpApp };
