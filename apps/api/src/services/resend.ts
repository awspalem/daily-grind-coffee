export class ResendEmailService {
  constructor(
    private apiKey?: string,
    private fromEmail: string = 'The Daily Roast <onboarding@resend.dev>'
  ) {}

  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey) {
      console.warn(`[Email] RESEND_API_KEY not configured — skipping send to ${to}: "${subject}"`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.fromEmail, to: [to], subject, html }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Email] Resend API error (${res.status}) sending to ${to}:`, errText);
        return { success: false, error: errText };
      }

      return { success: true };
    } catch (err: any) {
      console.error(`[Email] Resend request failed sending to ${to}:`, err);
      return { success: false, error: err.message || 'Network error' };
    }
  }
}
