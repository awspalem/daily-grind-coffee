import { Hono } from 'hono';
import { McpServer } from '../services/mcpServer';
const mcpApp = new Hono();
// POST /api/mcp (JSON-RPC 2.0 endpoint for agent tool protocol)
mcpApp.post('/', async (c) => {
    const body = await c.req.json();
    const server = new McpServer(c.env.DB);
    const response = await server.handleRequest(body);
    return c.json(response);
});
export { mcpApp };
