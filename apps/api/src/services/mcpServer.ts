import { CoffeeDatabase } from '@daily-grind/db';
import { InventoryLedgerService } from './inventoryLedger';

export interface McpRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface McpRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export class McpServer {
  constructor(private db: any) {}

  async handleRequest(req: McpRpcRequest): Promise<McpRpcResponse> {
    if (req.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: [
            {
              name: 'search_products',
              description: 'Search specialty coffee beans by tasting notes, origin, roast level, or category.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Flavor notes, origin or coffee name' },
                  roast_level: { type: 'string', enum: ['LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'] },
                },
              },
            },
            {
              name: 'get_inventory',
              description: 'Get real-time available and reserved stock for a specific SKU or variant ID.',
              inputSchema: {
                type: 'object',
                properties: {
                  variant_id: { type: 'string' },
                },
                required: ['variant_id'],
              },
            },
            {
              name: 'get_order',
              description: 'Lookup order details, tracking number, and items by order number.',
              inputSchema: {
                type: 'object',
                properties: {
                  order_number: { type: 'string', description: 'Order number e.g. TDG-123456' },
                },
                required: ['order_number'],
              },
            },
            {
              name: 'get_brewing_guide',
              description: 'Get precise extraction ratios, water temp, grind size, and steps for a brew method.',
              inputSchema: {
                type: 'object',
                properties: {
                  slug: { type: 'string', description: 'e.g. hario-v60-pour-over, inverted-aeropress' },
                },
                required: ['slug'],
              },
            },
          ],
        },
      };
    }

    if (req.method === 'tools/call') {
      const toolName = req.params?.name;
      const args = req.params?.arguments || {};
      const coffeeDb = new CoffeeDatabase(this.db);
      const ledger = new InventoryLedgerService(this.db);

      try {
        if (toolName === 'search_products') {
          const products = await coffeeDb.getAllProducts(undefined, args.roast_level);
          let res = products;
          if (args.query) {
            const q = args.query.toLowerCase();
            res = products.filter(
              (p: any) =>
                p.name.toLowerCase().includes(q) ||
                p.tasting_notes.some((n: string) => n.toLowerCase().includes(q)) ||
                p.origin_country.toLowerCase().includes(q)
            );
          }
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    res.map((p: any) => ({
                      id: p.id,
                      name: p.name,
                      roast: p.roast_level,
                      notes: p.tasting_notes,
                      origin: `${p.origin_country} (${p.region})`,
                      starting_price: `$${(p.variants[0]?.price_cents / 100).toFixed(2)}`,
                    })),
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        if (toolName === 'get_inventory') {
          const snap = await ledger.getInventorySnapshot(args.variant_id);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(snap, null, 2) }],
            },
          };
        }

        if (toolName === 'get_order') {
          const order = await this.db.prepare(
            'SELECT order_number, status, total_cents, tracking_number, carrier, created_at FROM orders WHERE order_number = ?'
          ).bind(args.order_number).first();

          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(order || { error: 'Order not found' }, null, 2) }],
            },
          };
        }

        if (toolName === 'get_brewing_guide') {
          const guides = await coffeeDb.getBrewingGuides();
          const guide = guides.find((g: any) => g.slug.includes(args.slug) || g.name.toLowerCase().includes(args.slug));
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(guide || guides[0], null, 2) }],
            },
          };
        }

        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Tool '${toolName}' not found` },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: err.message || 'Internal Tool Execution Error' },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: `Method '${req.method}' not implemented` },
    };
  }
}
