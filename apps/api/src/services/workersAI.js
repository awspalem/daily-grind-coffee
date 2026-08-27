export class WorkersAIService {
    aiBinding;
    constructor(aiBinding) {
        this.aiBinding = aiBinding;
    }
    /**
     * Generates text embeddings using Cloudflare Workers AI (bge-base-en-v1.5)
     */
    async generateEmbedding(text) {
        if (!this.aiBinding) {
            return this.generateSyntheticEmbedding(text);
        }
        try {
            const response = await this.aiBinding.run('@cf/baai/bge-base-en-v1.5', {
                text: [text],
            });
            return response.data[0];
        }
        catch (err) {
            console.warn('Workers AI embedding error, using fallback vectorizer:', err);
            return this.generateSyntheticEmbedding(text);
        }
    }
    /**
     * Synchronous embedding for one text — used as the fallback path for any
     * product that doesn't have a stored vector (see agents/agent.ts and the
     * hourly backfill in services/maintenance.ts). The async path through
     * Workers AI is preferred when you have many vectors; this one runs the
     * same lexical hash deterministically in the request isolate.
     */
    generateEmbeddingSync(text) {
        return this.generateSyntheticEmbedding(text);
    }
    /**
     * Cosine similarity between two dense vector representations
     */
    calculateSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length || vecA.length === 0)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    /**
     * Fast lexical-semantic hash fallback for local environments
     */
    generateSyntheticEmbedding(text, dim = 64) {
        const vector = new Array(dim).fill(0);
        const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            for (let j = 0; j < word.length; j++) {
                const charCode = word.charCodeAt(j);
                const index = (charCode * 31 + j * 7 + i * 13) % dim;
                vector[index] += 1 / (i + 1);
            }
        }
        // Normalize
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
        return vector.map((v) => v / norm);
    }
}
