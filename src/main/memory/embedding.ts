import { EmbeddingProvider } from './types.js';
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Xenova/Transformers Embedding Provider
 * モデル: Xenova/multilingual-e5-small (384次元)
 */
export class XenovaEmbeddingProvider implements EmbeddingProvider {
    private extractor: FeatureExtractionPipeline | null = null;
    private model: string;
    private dimension: number;
    private initPromise: Promise<void> | null = null;

    constructor(model: string = 'Xenova/multilingual-e5-small') {
        this.model = model;
        this.dimension = 384;  // multilingual-e5-smallの次元数
    }

    /**
     * モデルの遅延初期化
     */
    private async ensureInitialized(): Promise<void> {
        if (this.extractor) return;
        
        if (!this.initPromise) {
            this.initPromise = (async () => {
                console.log(`[XenovaEmbedding] Loading model: ${this.model}`);
                this.extractor = await pipeline('feature-extraction', this.model);
                console.log(`[XenovaEmbedding] Model loaded`);
            })();
        }
        
        await this.initPromise;
    }

    async embed(text: string): Promise<number[]> {
        await this.ensureInitialized();
        
        if (!this.extractor) {
            throw new Error('Extractor not initialized');
        }

        const output = await this.extractor(text, { 
            pooling: 'mean', 
            normalize: true 
        });
        
        return Array.from(output.data as Float32Array);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const text of texts) {
            const embedding = await this.embed(text);
            results.push(embedding);
        }
        return results;
    }

    getDimension(): number {
        return this.dimension;
    }
}

/**
 * Ollama Embedding Provider（バックアップ用）
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private baseUrl: string;
    private model: string;
    private dimension: number;

    constructor(
        baseUrl: string = 'http://localhost:11434',
        model: string = 'nomic-embed-text'
    ) {
        this.baseUrl = baseUrl;
        this.model = model;
        this.dimension = 768;
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                prompt: text,
            }),
        });

        if (!response.ok) {
            throw new Error(`Embedding failed: ${response.statusText}`);
        }

        const data = await response.json() as { embedding: number[] };
        return data.embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const text of texts) {
            const embedding = await this.embed(text);
            results.push(embedding);
        }
        return results;
    }

    getDimension(): number {
        return this.dimension;
    }
}

/**
 * Embeddingプロバイダのファクトリ
 */
export function createEmbeddingProvider(
    type: 'xenova' | 'ollama' = 'xenova'
): EmbeddingProvider {
    switch (type) {
        case 'xenova':
            return new XenovaEmbeddingProvider();
        case 'ollama':
            return new OllamaEmbeddingProvider();
        default:
            throw new Error(`Unknown embedding provider: ${type}`);
    }
}