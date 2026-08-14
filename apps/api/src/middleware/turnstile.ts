import type { Context, Next } from 'hono';
import type { Env } from '../types/env';

/**
 * Cloudflare Turnstile Server-Side Validation Middleware
 * Validates the turnstile response token against Cloudflare's siteverify endpoint.
 */
export async function turnstileValidator(c: Context<{ Bindings: Env }>, next: Next) {
  const secretKey = c.env.TURNSTILE_SECRET_KEY;
  
  // In development/test mode or if secret key is not set, allow requests through
  if (!secretKey || secretKey === 'placeholder' || c.env.ENVIRONMENT === 'development') {
    return next();
  }

  const rawJson = await c.req.raw.clone().json().catch(() => ({})) as Record<string, any>;
  const token = c.req.header('X-Turnstile-Token') || rawJson?.turnstile_token;
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';

  if (!token) {
    return c.json({ success: false, error: 'Turnstile bot challenge token is required' }, 403);
  }

  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);
  formData.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    const outcome = await res.json() as { success: boolean; 'error-codes'?: string[] };
    if (!outcome.success) {
      console.warn('Turnstile challenge failed:', outcome['error-codes']);
      return c.json({ success: false, error: 'Bot verification challenge failed. Please refresh and retry.' }, 403);
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
    // Fail closed on production security boundaries
    return c.json({ success: false, error: 'Security validation unavailable' }, 500);
  }

  return next();
}
