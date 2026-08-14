import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { agentApp } from '../src/routes/agent';
import type { Env } from '../src/types/env';

// Mock DB for D1
const mockDb: any = {
  prepare(sql: string) {
    return {
      bind(...params: any[]) {
        return {
          async first() {
            if (sql.includes('orders')) {
              return {
                order_number: params[0] || 'TDG-102938',
                status: 'ROASTING IN PROGRESS',
                total_cents: 1850,
                tracking_number: 'BLR-EXPRESS-99281',
                carrier: 'Indiranagar Roastery Courier',
                created_at: new Date().toISOString()
              };
            }
            if (sql.includes('product_variants')) {
              return { price_cents: 1850 };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };
  }
};

const mockEnv: Env = {
  DB: mockDb,
  ENVIRONMENT: 'development',
  STOREFRONT_URL: 'http://localhost:5173',
  ADMIN_URL: 'http://localhost:5174',
  CURRENCY: 'usd',
  GROQ_MODEL: 'llama-3.3-70b-versatile',
};

async function testLiveAgent() {
  console.log('--- Testing Agent Chat Endpoint ---');

  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/agent', agentApp);

  // Test 1: Single turn brewing guide
  console.log('\n[Test 1] Single turn: South Indian Filter Kaapi ratio & guide');
  const res1 = await app.request('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'How do I brew authentic South Indian Filter Kaapi?' })
  }, mockEnv);

  assert.strictEqual(res1.status, 200);
  const data1 = await res1.json() as any;
  console.log('Status:', res1.status);
  console.log('Reply:\n', data1.reply);
  assert.ok(data1.success);
  assert.ok(data1.reply.includes('1:5') || data1.reply.includes('Filter Kaapi'));

  // Test 2: Multi-turn conversation with memory
  console.log('\n[Test 2] Multi-turn memory: Karnataka estate recommendation followed by grind question');
  const messages = [
    { role: 'user', content: 'What micro-lots do you roast from Karnataka?' },
    { role: 'assistant', content: 'We roast the renowned Chikmagalur Attikan Estate Honey from the Baba Budan Giri range (1,750m elevation) with notes of sweet jaggery, red apple, and roasted hazelnut!' },
    { role: 'user', content: 'What grind size and ratio should I use if I want to brew this on my V60?' }
  ];

  const res2 = await app.request('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  }, mockEnv);

  assert.strictEqual(res2.status, 200);
  const data2 = await res2.json() as any;
  console.log('Status:', res2.status);
  console.log('Reply:\n', data2.reply);
  assert.ok(data2.success);
  assert.ok(data2.reply.includes('1:16') || data2.reply.includes('V60') || data2.reply.includes('Attikan'));

  // Test 3: Propose Add to Cart action
  console.log('\n[Test 3] Add to cart tool & proposed action verification');
  const res3 = await app.request('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': 'test-session-123' },
    body: JSON.stringify({ message: 'Please add 1 bag of Chikmagalur Attikan Honey ground for South Indian Filter to my cart' })
  }, mockEnv);

  assert.strictEqual(res3.status, 200);
  const data3 = await res3.json() as any;
  console.log('Status:', res3.status);
  console.log('Reply:\n', data3.reply);
  assert.ok(data3.success);

  console.log('\n✅ All Agent Live tests passed successfully!');
}

testLiveAgent().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
