/**
 * Admin Maya — operations co-pilot for The Daily Roast.
 *
 * Mirrors the SSE shape of routes/agent.ts (delta / status / done / error events
 * on /chat/stream) so the admin SPA can reuse any SSE parser, but with an
 * admin-specific SYSTEM_PROMPT, an admin-specific tool set (orders, inventory,
 * subscriptions, reviews, funnel, propose_admin_action), and admin-only
 * authentication (zeroTrustAdminGuard).
 *
 * Memory is keyed by the admin actor id, not a customer session token, so two
 * admins chatting don't see each other's turns and an admin can't accidentally
 * replay a customer's old conversation.
 *
 * All write actions go through the human-in-the-loop flow: Maya proposes
 * (via propose_admin_action tool), the SPA renders a card with [Approve]
 * [Reject], and the confirm endpoint runs the action only after a real click.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Env } from '../types/env';
import { DEFAULT_MODEL, GroqService, type GroqChatMessage, type GroqToolDefinition } from '../services/groq';
import { CoffeeDatabase } from '@daily-grind/db';
import { WorkersAIService } from '../services/workersAI';
import { zeroTrustAdminGuard, type AdminActor } from '../middleware/zeroTrust';
import { saveAgentTurn, loadAgentHistory } from '../services/agentMemory';

const adminAgentApp = new Hono<{ Bindings: Env; Variables: { adminActor: AdminActor } }>();

const ADMIN_SYSTEM_PROMPT = `
You are Maya, the operations co-pilot for "The Daily Roast", a specialty coffee roastery in Bengaluru. You are speaking to a member of the operations team — a roaster, dispatcher, or support agent.

You have read-only access to the live data: orders, inventory, subscription tiers, recent reviews, and the analytics funnel. You CANNOT execute a write action without first calling the propose_admin_action tool, which generates a confirmation token the operator must approve in the UI.

VOICE: Direct, warm, operationally specific. Cite order numbers, variant SKUs, and concrete numbers — never vague reassurances. If you don't know, say so.

DAILY RHYTHM (India time, IST = UTC+5:30):
- 4:00 AM IST: roastery opens
- 5:00-9:00 AM IST: morning dispatch wave
- 11:00 AM IST: second dispatch wave
- 4:00 PM IST: subscription renewal cron
- 9:00 PM IST: roastery closes

KEY TABLES (use exact column names when surfacing data):
- orders: order_number, status, total_cents, customer_email, shipping_address_json, created_at
- order_items: order_id, variant_id, grind_type, quantity
- product_variants: id, product_id, weight_grams, price_cents
- inventory: variant_id, quantity_on_hand
- subscriptions: id, plan_id, customer_id, status, next_renewal_date

WHEN TO PROPOSE: An admin action is anything that writes to the database or hits an external system (Stripe refund, Shiprocket cancel, mark-roasted, mark-shipped, restock, adjust price). READ-ONLY responses (summarise, lookup, count) never need a proposal.
`;

interface AdminTool {
  name: string;
  description: string;
  parameters: any;
}

const ADMIN_TOOLS: GroqToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_orders',
      description: 'Search the orders table by email, order number, or status. Returns the last 25 matching orders with key fields.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Filter by customer email (exact match, case-insensitive).' },
          order_number: { type: 'string', description: 'Filter by order number (e.g. DR-123456).' },
          status: { type: 'string', description: 'One of PENDING_PAYMENT, PAID, ROASTING, PACKED, SHIPPED, DELIVERED, CANCELLED, REFUNDED.' },
          since_iso: { type: 'string', description: 'Only orders created at or after this ISO timestamp.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory',
      description: 'Get current stock for a variant (by id) or a top-50 low-stock summary across all variants.',
      parameters: {
        type: 'object',
        properties: {
          variant_id: { type: 'string', description: 'Optional: specific variant id. Omit for low-stock summary.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_today',
      description: 'Single-shot "what needs attention" report: orders paid and awaiting roast, low-stock variants, subscription renewals due today, recent refunds. Use this when the operator asks "what should I work on?" or opens the chat cold.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_admin_action',
      description: 'Propose a write action for human approval. Returns a proposal_token; the operator must click Approve in the UI to execute. NEVER use this for read operations.',
      parameters: {
        type: 'object',
        required: ['action_type', 'payload', 'summary'],
        properties: {
          action_type: {
            type: 'string',
            enum: ['refund_order', 'mark_shipped', 'mark_roasting', 'mark_packed', 'cancel_order', 'restock_variant', 'adjust_price'],
            description: 'The kind of write being proposed.',
          },
          payload: {
            type: 'object',
            description: 'Action-specific parameters (e.g. { order_id, amount_cents } for refund_order).',
          },
          summary: {
            type: 'string',
            description: 'One-sentence human-readable description shown on the approval card (e.g. "Refund order DR-12345 for ₹1,299 — customer reported stale beans").',
          },
        },
      },
    },
  },
];

const ADMIN_TOOL_STATUS: Record<string, string> = {
  search_orders: 'Looking up orders…',
  get_inventory: 'Checking stock…',
  summarize_today: 'Building the today-at-a-glance report…',
  propose_admin_action: 'Drafting an action for your approval…',
};

interface AdminToolContext {
  env: Env;
  db: CoffeeDatabase;
  ai: WorkersAIService;
  actor: AdminActor;
}

async function runAdminToolCall(
  call: { id: string; function: { name: string; arguments: string } },
  ctx: AdminToolContext
): Promise<{ toolResult: any; proposedAction?: any } | null> {
  const toolName = call.function.name;
  let toolArgs: any = {};
  try {
    toolArgs = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
  } catch {
    toolArgs = {};
  }

  if (toolName === 'search_orders') {
    const conditions: string[] = [];
    const binds: any[] = [];
    if (toolArgs.email) {
      conditions.push('LOWER(customer_email) = LOWER(?)');
      binds.push(String(toolArgs.email));
    }
    if (toolArgs.order_number) {
      conditions.push('order_number = ?');
      binds.push(String(toolArgs.order_number));
    }
    if (toolArgs.status) {
      conditions.push('status = ?');
      binds.push(String(toolArgs.status));
    }
    if (toolArgs.since_iso) {
      conditions.push('created_at >= ?');
      binds.push(String(toolArgs.since_iso));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { results } = await ctx.env.DB.prepare(`
      SELECT order_number, status, total_cents, customer_email, created_at
      FROM orders
      ${where}
      ORDER BY created_at DESC
      LIMIT 25
    `).bind(...binds).all<any>();
    return { toolResult: { tool_call_id: call.id, name: toolName, result: results || [] } };
  }

  if (toolName === 'get_inventory') {
    if (toolArgs.variant_id) {
      const row = await ctx.env.DB.prepare(`
        SELECT v.id, p.name as product_name, v.weight_grams, i.quantity_on_hand
        FROM product_variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.id = ?
      `).bind(String(toolArgs.variant_id)).first<any>();
      return { toolResult: { tool_call_id: call.id, name: toolName, result: row || null } };
    }
    const { results } = await ctx.env.DB.prepare(`
      SELECT v.id, p.name as product_name, v.weight_grams, COALESCE(i.quantity_on_hand, 0) as quantity_on_hand
      FROM product_variants v
      JOIN products p ON v.product_id = p.id
      LEFT JOIN inventory i ON i.variant_id = v.id
      WHERE v.is_active = 1
      ORDER BY quantity_on_hand ASC
      LIMIT 50
    `).all<any>();
    return { toolResult: { tool_call_id: call.id, name: toolName, result: results || [] } };
  }

  if (toolName === 'summarize_today') {
    // One shot that hits the highest-signal queries. Each is its own prepared
    // statement so the order of operations is obvious in the worker log.
    const startOfDayUtc = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      // India is UTC+5:30, so "today IST" starts at 18:30 UTC the day before.
      d.setUTCHours(d.getUTCHours() - 18 - 1);
      d.setUTCMinutes(d.getUTCMinutes() - 30);
      return d.toISOString();
    })();

    const [pendingRoast, lowStock, dueToday, recentRefunds] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) as n, COALESCE(SUM(total_cents), 0) as revenue_cents FROM orders WHERE status = 'PAID' AND created_at >= ?`)
        .bind(startOfDayUtc).first<any>(),
      ctx.env.DB.prepare(`SELECT COUNT(*) as n FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.is_active = 1 AND COALESCE(i.quantity_on_hand, 0) < 20`)
        .first<any>(),
      ctx.env.DB.prepare(`SELECT COUNT(*) as n FROM subscriptions WHERE status = 'ACTIVE' AND date(next_renewal_date) = date('now')`)
        .first<any>(),
      ctx.env.DB.prepare(`SELECT order_number, total_cents, created_at FROM orders WHERE status IN ('REFUNDED', 'CANCELLED') AND created_at >= ? ORDER BY created_at DESC LIMIT 10`)
        .bind(startOfDayUtc).all<any>(),
    ]);

    return {
      toolResult: {
        tool_call_id: call.id,
        name: toolName,
        result: {
          window_start_ist: startOfDayUtc,
          paid_awaiting_roast: pendingRoast?.n ?? 0,
          revenue_today_cents: pendingRoast?.revenue_cents ?? 0,
          low_stock_variants: lowStock?.n ?? 0,
          subscription_renewals_due_today: dueToday?.n ?? 0,
          recent_refunds_or_cancellations: recentRefunds?.results || [],
        },
      },
    };
  }

  if (toolName === 'propose_admin_action') {
    if (!toolArgs.action_type || !toolArgs.summary) {
      return {
        toolResult: {
          tool_call_id: call.id,
          name: toolName,
          result: { error: 'propose_admin_action requires action_type and summary' },
        },
      };
    }
    const proposalToken = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const id = 'aap_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await ctx.env.DB.prepare(`
      INSERT INTO admin_action_proposals (id, proposal_token, actor_id, actor_email, action_type, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      proposalToken,
      ctx.actor.id,
      ctx.actor.email,
      String(toolArgs.action_type),
      JSON.stringify(toolArgs.payload || {})
    ).run();
    const proposedAction = {
      proposal_token: proposalToken,
      action_type: toolArgs.action_type,
      payload: toolArgs.payload || {},
      summary: toolArgs.summary,
    };
    return {
      toolResult: {
        tool_call_id: call.id,
        name: toolName,
        result: { proposed: true, action_type: toolArgs.action_type, summary: toolArgs.summary },
      },
      proposedAction,
    };
  }

  return null;
}

// Chat history is keyed by a per-admin session token (a UUID the admin SPA
// stores in localStorage; never expires for the lifetime of the install).
// Using a stable per-admin id rather than per-tab keeps the conversation
// continuous across reloads and avoids a "who am I again?" cold start.
function adminSessionTokenFor(actor: AdminActor): string {
  return 'admin_sess_' + actor.id;
}

adminAgentApp.use('*', zeroTrustAdminGuard);

adminAgentApp.get('/history', async (c) => {
  const actor = c.get('adminActor' as any) as AdminActor;
  const sessionToken = c.req.header('X-Admin-Session') || adminSessionTokenFor(actor);
  const history = await loadAgentHistory(c.env.DB, {
    sessionToken,
    actorType: 'admin',
    actorId: actor.id,
  });
  return c.json({ success: true, history });
});

adminAgentApp.post('/chat/stream', async (c) => {
  const actor = c.get('adminActor' as any) as AdminActor;
  const sessionToken = c.req.header('X-Admin-Session') || adminSessionTokenFor(actor);

  const body = await c.req.json<{ messages?: { role: string; content: string }[]; message?: string }>().catch(() => ({} as any));

  const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL);
  const db = new CoffeeDatabase(c.env.DB);
  const ai = new WorkersAIService(c.env.AI);

  let rawMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    rawMessages = body.messages.filter((m: any) => m && typeof m.content === 'string' && m.content.trim() !== '');
  } else if (typeof body.message === 'string' && body.message.trim() !== '') {
    rawMessages = [{ role: 'user', content: body.message.trim() }];
  }

  const abortController = new AbortController();
  const ctx: AdminToolContext = { env: c.env, db, ai, actor };

  return streamSSE(c, async (stream) => {
    stream.onAbort(() => abortController.abort());

    const history = await loadAgentHistory(c.env.DB, {
      sessionToken,
      actorType: 'admin',
      actorId: actor.id,
    });
    const fullMessages: GroqChatMessage[] = [
      { role: 'system', content: ADMIN_SYSTEM_PROMPT },
      ...history.map((h) => ({ role: h.role, content: h.content } as GroqChatMessage)),
      ...rawMessages.map((m) => ({ role: m.role, content: m.content } as GroqChatMessage)),
    ];

    const newestUserMessage = rawMessages[rawMessages.length - 1];

    let firstPassContent = '';
    let toolCalls: any[] = [];
    for await (const event of groq.streamChatCompletion(fullMessages, ADMIN_TOOLS, 0.4, abortController.signal)) {
      if (event.type === 'delta') {
        firstPassContent += event.content;
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.content }) });
      } else if (event.type === 'tool_calls') {
        toolCalls = event.tool_calls;
      }
    }

    if (toolCalls.length === 0) {
      if (newestUserMessage?.role === 'user' && firstPassContent) {
        await saveAgentTurn(c.env.DB, {
          sessionToken,
          actorType: 'admin',
          actorId: actor.id,
          userContent: newestUserMessage.content,
          assistantContent: firstPassContent,
        });
      }
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ reply: firstPassContent, proposed_actions: [] }) });
      return;
    }

    const toolResults: any[] = [];
    const proposedActions: any[] = [];
    for (const call of toolCalls) {
      const label = ADMIN_TOOL_STATUS[call.function?.name] || 'Working on it…';
      await stream.writeSSE({ event: 'status', data: JSON.stringify({ label }) });
      const outcome = await runAdminToolCall(call, ctx);
      if (outcome) {
        toolResults.push(outcome.toolResult);
        if (outcome.proposedAction) proposedActions.push(outcome.proposedAction);
      }
    }

    const secondPassMessages: GroqChatMessage[] = [
      ...fullMessages,
      ...toolResults.map((r) => ({ role: 'tool' as const, tool_call_id: r.tool_call_id, name: r.name, content: JSON.stringify(r.result) })),
    ];

    let secondPassContent = '';
    for await (const event of groq.streamChatCompletion(secondPassMessages, undefined, 0.4, abortController.signal)) {
      if (event.type === 'delta') {
        secondPassContent += event.content;
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.content }) });
      }
    }

    if (newestUserMessage?.role === 'user' && secondPassContent) {
      await saveAgentTurn(c.env.DB, {
        sessionToken,
        actorType: 'admin',
        actorId: actor.id,
        userContent: newestUserMessage.content,
        assistantContent: secondPassContent,
      });
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({ reply: secondPassContent, proposed_actions: proposedActions }),
    });
  });
});

adminAgentApp.post('/confirm-action', async (c) => {
  const actor = c.get('adminActor' as any) as AdminActor;
  const body = await c.req.json<{ proposal_token: string; action: 'approve' | 'reject'; note?: string }>().catch(() => ({} as any));
  if (!body.proposal_token || !body.action) {
    return c.json({ success: false, error: 'proposal_token and action are required' }, 400);
  }
  const proposal = await c.env.DB.prepare(
    `SELECT * FROM admin_action_proposals WHERE proposal_token = ?`
  ).bind(String(body.proposal_token)).first<any>();
  if (!proposal) {
    return c.json({ success: false, error: 'Proposal not found' }, 404);
  }
  if (proposal.status !== 'PENDING') {
    return c.json({ success: false, error: `Proposal already ${proposal.status.toLowerCase()}` }, 409);
  }
  // 15-minute expiry matches the customer-side propose_add_to_cart window.
  const ageMs = Date.now() - new Date(proposal.created_at + 'Z').getTime();
  if (Number.isFinite(ageMs) && ageMs > 15 * 60 * 1000) {
    await c.env.DB.prepare(`UPDATE admin_action_proposals SET status = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP WHERE proposal_token = ?`)
      .bind(body.proposal_token).run();
    return c.json({ success: false, error: 'Proposal expired' }, 410);
  }

  if (body.action === 'reject') {
    await c.env.DB.prepare(`
      UPDATE admin_action_proposals
      SET status = 'REJECTED', resolved_at = CURRENT_TIMESTAMP, resolution_note = ?
      WHERE proposal_token = ?
    `).bind(String(body.note || ''), body.proposal_token).run();
    return c.json({ success: true, status: 'REJECTED' });
  }

  // action === 'approve' — execute the action. The implementation here is
  // deliberately narrow: it records the approval and marks the row APPROVED.
  // Connecting the action_type to the real domain mutation (refund, ship,
  // restock, etc.) lives in a follow-up that wires each action_type to its
  // service — for v1 we prove the human-in-the-loop path and the audit row.
  await c.env.DB.prepare(`
    UPDATE admin_action_proposals
    SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolution_note = ?
    WHERE proposal_token = ?
  `).bind(
    `${actor.email} approved: ${body.note || ''}`.trim(),
    body.proposal_token
  ).run();

  return c.json({ success: true, status: 'APPROVED', action_type: proposal.action_type });
});

export { adminAgentApp };
