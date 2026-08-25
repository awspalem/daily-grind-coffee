export class ResendEmailService {
    apiKey;
    fromEmail;
    constructor(apiKey, fromEmail = 'The Daily Roast <onboarding@resend.dev>') {
        this.apiKey = apiKey;
        this.fromEmail = fromEmail;
    }
    async send(to, subject, html) {
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
        }
        catch (err) {
            console.error(`[Email] Resend request failed sending to ${to}:`, err);
            return { success: false, error: err.message || 'Network error' };
        }
    }
}
