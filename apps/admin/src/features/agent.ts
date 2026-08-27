/**
 * Admin Maya — operations co-pilot chat drawer.
 *
 * Mirrors the streaming protocol of apps/storefront/src/main.ts (sendAgentMessage)
 * but for /api/admin/agent/chat/stream. No voice, no brew timer, no
 * storefront action cards — only operations read tools and human-in-the-loop
 * proposals that the operator must Approve or Reject before any write fires.
 *
 * Lazy: the drawer is empty until the operator clicks the top-bar button, and
 * the first click is the only moment the SSE wiring initializes. Conversation
 * history is hydrated on first open from /api/admin/agent/history; the agent
 * route filters by actor_id so two admins never see each other's turns.
 */

import { adminFetch, esc, toast } from './shared';
import { icons } from '../icons';
import type { RouteModule } from '../router';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  proposedActions?: ProposedAction[];
  /** True while the assistant's reply is still streaming. */
  streaming?: boolean;
}

interface ProposedAction {
  proposal_token: string;
  action_type: string;
  payload: Record<string, unknown>;
  summary: string;
}

const HISTORY_LIMIT = 12;

function renderMarkdownLite(text: string): string {
  // Tiny markdown subset: **bold**, `code`, line breaks, and very basic
  // lists. The full render lives in the storefront; admin doesn't need it.
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n- /g, '\n• ')
    .replace(/\n/g, '<br>');
}

function messageHtml(m: ChatMessage): string {
  const cls = m.role === 'user' ? 'admin-agent-bubble--user' : 'admin-agent-bubble--assistant';
  if (m.streaming && !m.content) {
    return `<div class="admin-agent-bubble ${cls} admin-agent-typing"><span></span><span></span><span></span></div>`;
  }
  let body = `<div class="admin-agent-bubble ${cls}">${m.content ? renderMarkdownLite(m.content) : ''}</div>`;
  if (m.proposedActions?.length) {
    body += m.proposedActions.map(actionCardHtml).join('');
  }
  return body;
}

function actionCardHtml(a: ProposedAction): string {
  const safeSummary = esc(a.summary);
  const safeType = esc(a.action_type);
  return `
    <div class="admin-agent-tool-card" data-proposal="${esc(a.proposal_token)}">
      <div class="admin-agent-tool-card-header">
        <span class="status-badge shipped">PROPOSAL · ${safeType}</span>
      </div>
      <p class="admin-agent-tool-card-body">${safeSummary}</p>
      <div class="admin-agent-tool-card-actions">
        <button class="btn-primary" data-action="approve" data-token="${esc(a.proposal_token)}">Approve</button>
        <button class="btn-secondary" data-action="reject" data-token="${esc(a.proposal_token)}">Reject</button>
      </div>
    </div>
  `;
}

function suggestionChipsHtml(): string {
  return `
    <div class="admin-agent-chips">
      <button class="admin-agent-chip" data-prompt="What needs my attention today?">What needs attention today?</button>
      <button class="admin-agent-chip" data-prompt="Show me orders paid but not yet roasted."">Orders awaiting roast</button>
      <button class="admin-agent-chip" data-prompt="Which variants are low on stock?">Low stock</button>
      <button class="admin-agent-chip" data-prompt="How many subscription renewals are due today?">Renewals due today</button>
    </div>
  `;
}

let mounted = false;
let messages: ChatMessage[] = [];
let busy = false;

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`admin agent: missing ${sel}`);
  return el;
}

function renderDrawer(): void {
  const list = document.getElementById('admin-agent-messages')!;
  list.innerHTML = messages.length
    ? messages.map(messageHtml).join('')
    : `<div class="admin-agent-empty">
        <div class="empty-state-icon">${icons.sparkle}</div>
        <div class="empty-state-title">Maya, your ops co-pilot</div>
        <div class="empty-state-body">Ask about orders, stock, renewals, or reviews. Write actions always go through Approve / Reject — nothing fires without your click.</div>
        ${suggestionChipsHtml()}
      </div>`;
  list.scrollTop = list.scrollHeight;
}

function setBusy(b: boolean): void {
  busy = b;
  const input = document.getElementById('admin-agent-input') as HTMLInputElement | null;
  const sendBtn = document.getElementById('admin-agent-send') as HTMLButtonElement | null;
  if (input) input.disabled = b;
  if (sendBtn) sendBtn.disabled = b;
}

async function sendMessage(text: string): Promise<void> {
  if (busy || !text.trim()) return;
  const userMsg: ChatMessage = { role: 'user', content: text.trim() };
  const assistantMsg: ChatMessage = { role: 'assistant', content: '', streaming: true };
  messages = [...messages, userMsg, assistantMsg].slice(-HISTORY_LIMIT * 2);
  renderDrawer();
  setBusy(true);

  const payloadMessages = [...messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: text.trim() }];

  try {
    const res = await adminFetch<{ error?: string }>('/api/admin/agent/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: payloadMessages }),
    });
    // adminFetch already JSON-parses; SSE isn't supported by the helper today
    // (the storefront uses a custom parseSSEStream). Until that's ported, the
    // admin path falls back to a non-streaming POST and shows the same reply.
    // The backend's /chat/stream endpoint is wired and will work as soon as
    // we swap in a streaming helper.
    if (!res.success) {
      messages[messages.length - 1] = { role: 'assistant', content: `Sorry, I couldn't reach operations. ${res.error || ''}`.trim() };
    } else if ((res as any).reply) {
      messages[messages.length - 1] = {
        role: 'assistant',
        content: (res as any).reply,
        proposedActions: (res as any).proposed_actions,
      };
    }
  } catch (err) {
    console.error('[admin agent] send failed', err);
    messages[messages.length - 1] = { role: 'assistant', content: 'Network error talking to Maya.' };
  } finally {
    setBusy(false);
    renderDrawer();
  }
}

async function resolveProposal(token: string, action: 'approve' | 'reject'): Promise<void> {
  const res = await adminFetch<{ error?: string }>('/api/admin/agent/confirm-action', {
    method: 'POST',
    json: { proposal_token: token, action, note: action === 'reject' ? 'rejected in chat' : 'approved in chat' },
  });
  if (!res.success) { toast(res.error || `Could not ${action} the proposal`, 'error'); return; }
  toast(action === 'approve' ? 'Proposal approved' : 'Proposal rejected', 'success');
  // Drop the card from the message that contained it.
  messages = messages.map((m) => ({
    ...m,
    proposedActions: (m.proposedActions || []).filter((a) => a.proposal_token !== token),
  }));
  renderDrawer();
}

function mountDrawer(): void {
  if (mounted) return;
  const drawer = $('admin-agent-drawer');
  drawer.innerHTML = `
    <header class="admin-agent-header">
      <div class="admin-agent-header-text">
        <strong>Maya</strong>
        <span class="admin-agent-header-sub">Operations co-pilot</span>
      </div>
      <button class="admin-agent-close" id="admin-agent-close" type="button" aria-label="Close Maya">×</button>
    </header>
    <div class="admin-agent-messages" id="admin-agent-messages" role="log" aria-live="polite"></div>
    <form class="admin-agent-input-row" id="admin-agent-form">
      <input class="admin-input-styled" id="admin-agent-input" type="text" autocomplete="off" placeholder="Ask Maya anything about orders, stock, or renewals…" />
      <button class="btn-primary" id="admin-agent-send" type="submit">Send</button>
    </form>
  `;
  renderDrawer();
  $('admin-agent-close').addEventListener('click', close);
  $('admin-agent-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.getAttribute('aria-hidden') === 'false') close();
  });
  $('admin-agent-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('admin-agent-input') as HTMLInputElement;
    const text = input.value;
    input.value = '';
    void sendMessage(text);
  });
  // Suggestion chips (event delegation — chips re-render every time the list re-renders).
  document.getElementById('admin-agent-messages')!.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.admin-agent-chip') as HTMLElement | null;
    if (chip?.dataset.prompt) {
      void sendMessage(chip.dataset.prompt);
      return;
    }
    const btn = (e.target as HTMLElement).closest('[data-action][data-token]') as HTMLElement | null;
    if (btn) {
      void resolveProposal(btn.dataset.token!, btn.dataset.action as 'approve' | 'reject');
    }
  });
  mounted = true;
}

function open(): void {
  mountDrawer();
  $('admin-agent-drawer').setAttribute('aria-hidden', 'false');
  $('admin-agent-backdrop').setAttribute('aria-hidden', 'false');
  document.body.classList.add('admin-agent-open');
  setTimeout(() => (document.getElementById('admin-agent-input') as HTMLInputElement | null)?.focus(), 80);
  // First-open hydration; subsequent opens are instant (messages already in memory).
  if (messages.length === 0) {
    void adminFetch<{ history?: { role: 'user' | 'assistant'; content: string }[] }>('/api/admin/agent/history')
      .then((res) => {
        if (res.success && res.history) {
          messages = res.history.map((h) => ({ role: h.role, content: h.content }));
          renderDrawer();
        }
      });
  }
}

function close(): void {
  $('admin-agent-drawer').setAttribute('aria-hidden', 'true');
  $('admin-agent-backdrop').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('admin-agent-open');
}

// The router requires a RouteModule shape, but the agent is a global drawer
// rather than a page. We register an empty route that the nav never points
// at, and expose open() via the document so the top-bar button can call it.
const route: RouteModule = { mount() { /* no-op; opened by the top-bar button */ } };
export default route;
export const openAdminAgent = open;
