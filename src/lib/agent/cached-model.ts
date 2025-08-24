import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseMessage } from "@langchain/core/messages";
import { operationCache } from "./operation-cache";
import { agentLogger } from "./logger";

/**
 * Cached model wrapper that caches expensive model calls
 */
export class CachedModel {
  constructor(private model: BaseLanguageModel) {}

  /**
   * Generate cache key for model call
   */
  private generateCacheKey(messages: BaseMessage[], options?: any): string {
    const messageContent = messages.map(msg => ({
      role: msg._getType(),
      content: msg.content
    }));
    
    return {
      messages: messageContent,
      model: this.model.constructor.name,
      options: options || {}
    };
  }

  /**
   * Invoke model with caching
   */
  async invoke(messages: BaseMessage[], options?: any): Promise<any> {
    const cacheKey = this.generateCacheKey(messages, options);
    
    // Check cache first
    const cached = operationCache.get("model_response", cacheKey);
    if (cached) {
      agentLogger.info("[CachedModel] Cache hit for model invocation");
      return cached;
    }
    
    // Execute model call
    agentLogger.info("[CachedModel] Cache miss - executing model call");
    const startTime = Date.now();
    
    try {
      const result = await this.model.invoke(messages, options);
      
      // Cache the result
      const duration = Date.now() - startTime;
      operationCache.set("model_response", cacheKey, result);
      
      agentLogger.info(`[CachedModel] Model call completed in ${duration}ms`);
      return result;
    } catch (error) {
      agentLogger.error("[CachedModel] Model call failed", error);
      throw error;
    }
  }

  /**
   * Stream model response with caching
   */
  async stream(messages: BaseMessage[], options?: any): Promise<any> {
    // For streaming, we don't cache the stream itself, but we can cache the final result
    // This is a simplified approach - in production you might want more sophisticated streaming cache
    return this.model.stream(messages, options);
  }

  /**
   * Get underlying model
   */
  getModel(): BaseLanguageModel {
    return this.model;
  }
}
