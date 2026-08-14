export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface GroqToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class GroqService {
  private apiKey?: string;
  private model: string;

  constructor(apiKey?: string, model: string = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chatCompletion(
    messages: GroqChatMessage[],
    tools?: GroqToolDefinition[],
    temperature: number = 0.5
  ) {
    if (!this.apiKey || this.apiKey === 'placeholder') {
      // Return a smart edge fallback agent response if Groq API key is not yet set
      return this.generateFallbackResponse(messages);
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
      max_tokens: 1024,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Groq API error:', err);
      return this.generateFallbackResponse(messages);
    }

    const data = await res.json() as any;
    return data.choices[0].message;
  }

  private generateFallbackResponse(messages: GroqChatMessage[]) {
    const lastMsg = messages[messages.length - 1]?.content.toLowerCase() || '';
    
    if (lastMsg.includes('ethiopia') || lastMsg.includes('light') || lastMsg.includes('floral')) {
      return {
        role: 'assistant',
        content: `I highly recommend our **Ethiopia Yirgacheffe Gedeb**! It's a natural process light roast with notes of fragrant jasmine, bergamot tea, and ripe white peach. It's extraordinary when brewed on a Hario V60 or Chemex. Would you like me to add a 250g bag to your cart?`,
      };
    }

    if (lastMsg.includes('espresso') || lastMsg.includes('dark') || lastMsg.includes('crema')) {
      return {
        role: 'assistant',
        content: `For a rich, full-bodied espresso with dense crema, you will love our **Midnight Runner Espresso**. It features deep dark cocoa nibs, molasses, and toasted almonds with zero bitter astringency. Perfect for straight shots or lattes.`,
      };
    }

    if (lastMsg.includes('v60') || lastMsg.includes('pour over') || lastMsg.includes('brew') || lastMsg.includes('ratio')) {
      return {
        role: 'assistant',
        content: `For a standard 1-cup Hario V60 pour over:
• **Ratio:** 1:16 (15g coffee to 240g water)
• **Grind:** Medium-fine (like table salt)
• **Water Temp:** 94°C (201°F)
• **Bloom:** 45g water for 45 seconds
• **Total Time:** 2:45 to 3:15 minutes

Would you like a recommendation on which beans pair best with this technique?`,
      };
    }

    return {
      role: 'assistant',
      content: `Welcome to **The Daily Grind**! I'm your dedicated Roastery AI Barista. I can help you discover single-origin beans based on your flavor preferences, provide step-by-step brew ratios (V60, AeroPress, French Press), check your order status, or help build your cart. What kind of coffee experience are you looking for today?`,
    };
  }
}
