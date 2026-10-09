/**
 * Minimal client for the IO Bonzai Conversational Search API.
 * Docs: https://aisearch.iobonzai.com/openapi/v1.json
 *
 * Auth: X-API-Key header = tenant key (shown in Bonzai admin > API Keys & documentation).
 * Flow: POST /api/v1/conversation (start) -> conversationId
 *       POST /api/v1/conversation/{conversationId} (continue)
 */
class BonzaiClient {
  constructor({ baseUrl = "https://aisearch.iobonzai.com", apiKey, agentId }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.conversationId = null;
  }

  get isConfigured() {
    return Boolean(this.apiKey && this.agentId);
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const problem = await res.json();
        detail = problem.detail || problem.title || detail;
      } catch (_) {
        /* ignore parse errors */
      }
      throw new Error(`Bonzai API error (${res.status}): ${detail}`);
    }

    const data = await res.json();
    return BonzaiClient._normalize(data);
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "X-API-Key": this.apiKey },
    });

    if (!res.ok) {
      throw new Error(`Bonzai API error (${res.status}): ${res.statusText}`);
    }

    const data = await res.json();
    return BonzaiClient._normalize(data);
  }

  /**
   * The live API returns PascalCase keys (Response/Answer/References) even
   * though the published OpenAPI spec documents camelCase. Normalize both
   * so callers can rely on a single shape.
   */
  static _normalize(obj) {
    if (Array.isArray(obj)) return obj.map(BonzaiClient._normalize);
    if (obj === null || typeof obj !== "object") return obj;
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
      out[camelKey] = BonzaiClient._normalize(value);
    }
    return out;
  }

  /**
   * Send a message. Starts a conversation on the first call, continues it afterwards.
   * `conversationContext` lets us pass page-specific context (e.g. topic: "Wind Energy")
   * on the very first message so the agent can tailor itself to the page.
   */
  async sendMessage(prompt, conversationContext) {
    if (!this.conversationId) {
      const payload = { agentId: this.agentId, prompt };
      if (conversationContext) payload.conversationContext = conversationContext;
      const data = await this._post("/api/v1/conversation", payload);
      this.conversationId = data.conversationId;
      return data;
    }

    return this._post(`/api/v1/conversation/${this.conversationId}`, { prompt });
  }

  /**
   * Streaming variant of sendMessage. Calls `onChunk(answerDelta, normalizedEvent)`
   * for every NDJSON line the API emits, and resolves with the final normalized
   * event once the stream ends (so callers can read the final references/messageId).
   *
   * The streaming endpoints emit newline-delimited JSON objects shaped like the
   * non-streaming response, where `response.answer` is only the new text delta
   * for that line (not the full answer so far).
   */
  async sendMessageStreaming(prompt, conversationContext, onChunk) {
    const isFirst = !this.conversationId;
    const path = isFirst
      ? "/api/v1/conversation"
      : `/api/v1/conversation/${this.conversationId}/streaming`;

    const payload = isFirst
      ? { agentId: this.agentId, prompt, stream: true, ...(conversationContext ? { conversationContext } : {}) }
      : { prompt };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Bonzai API error (${res.status}): ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        const event = BonzaiClient._normalize(JSON.parse(line));
        lastEvent = event;
        if (!this.conversationId) this.conversationId = event.conversationId;

        const delta = event.response && event.response.answer ? event.response.answer : "";
        if (delta) onChunk(delta, event);
      }
    }

    if (buffer.trim()) {
      const event = BonzaiClient._normalize(JSON.parse(buffer.trim()));
      lastEvent = event;
      const delta = event.response && event.response.answer ? event.response.answer : "";
      if (delta) onChunk(delta, event);
    }

    return lastEvent;
  }

  /**
   * Fetch example questions configured in Bonzai admin ("Example questions" tab)
   * for this agent, so suggested chips are managed centrally instead of hardcoded
   * per page.
   */
  async getExampleQuestions() {
    const data = await this._get(`/api/v1/examplequestion?agentId=${this.agentId}`);
    return Array.isArray(data) ? data : [];
  }

  async sendFeedback(messageId, feedbackScore, feedback) {
    if (!this.conversationId) return;
    return this._post(`/api/v1/conversation/${this.conversationId}/feedback`, {
      messageId,
      feedbackScore,
      feedback: feedback || null,
    });
  }

  reset() {
    this.conversationId = null;
  }
}
