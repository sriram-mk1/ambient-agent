import { agentLogger } from "./logger";

// ================================================================================================
// 🎯 OPERATION CACHE - Caches expensive operations (model outputs, tool results, API calls)
// ================================================================================================

interface CachedOperation<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
  type: "model_response" | "tool_result" | "api_call" | "memory_retrieval";
  size: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  memoryUsage: number;
}

/**
 * Operation Cache - Caches expensive operations like model outputs, tool results, and API calls
 * This is different from the AgentManager's user-level caching which caches setup/configuration
 */
export class OperationCache {
  private cache = new Map<string, CachedOperation>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    memoryUsage: 0,
  };
  
  // TTL configurations for different operation types
  private readonly TTL_CONFIG = {
    model_response: 5 * 60 * 1000, // 5 minutes - model responses can change
    tool_result: 15 * 60 * 1000, // 15 minutes - tool results can be stale
    api_call: 10 * 60 * 1000, // 10 minutes - API calls can be expensive
    memory_retrieval: 30 * 60 * 1000, // 30 minutes - memory doesn't change often
  };

  // Memory limits
  private readonly MAX_CACHE_SIZE = 1000; // Max 1000 cached operations
  private readonly MAX_MEMORY_USAGE = 50 * 1024 * 1024; // 50MB max memory usage

  /**
   * Generate cache key for an operation
   */
  generateKey(type: string, params: any): string {
    const normalizedParams = this.normalizeParams(params);
    const keyData = JSON.stringify({ type, params: normalizedParams });
    return this.hashString(keyData);
  }

  /**
   * Normalize parameters for consistent hashing
   */
  private normalizeParams(params: any): any {
    if (typeof params === 'string') return params;
    if (typeof params !== 'object' || params === null) return params;
    
    if (Array.isArray(params)) {
      return params.map(item => this.normalizeParams(item));
    }
    
    const normalized: any = {};
    const keys = Object.keys(params).sort();
    for (const key of keys) {
      normalized[key] = this.normalizeParams(params[key]);
    }
    return normalized;
  }

  /**
   * Simple hash function for cache keys
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Calculate approximate size of cached data
   */
  private calculateSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 100; // Default estimate
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CachedOperation): boolean {
    return Date.now() > (entry.timestamp + entry.ttl);
  }

  /**
   * Clean up expired entries and enforce memory limits
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        cleaned++;
        this.stats.evictions++;
      }
    }
    
    // If still over limits, remove oldest entries
    if (this.cache.size > this.MAX_CACHE_SIZE || this.stats.memoryUsage > this.MAX_MEMORY_USAGE) {
      const entries = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);
      
      const toRemove = Math.min(
        entries.length,
        Math.max(
          this.cache.size - this.MAX_CACHE_SIZE,
          Math.ceil((this.stats.memoryUsage - this.MAX_MEMORY_USAGE) / 1000)
        )
      );
      
      for (let i = 0; i < toRemove; i++) {
        const [key, entry] = entries[i];
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        cleaned++;
        this.stats.evictions++;
      }
    }
    
    if (cleaned > 0) {
      this.stats.size = this.cache.size;
      agentLogger.info(`[OperationCache] Cleaned up ${cleaned} entries`);
    }
  }

  /**
   * Get cached operation result
   */
  get<T = any>(
    type: CachedOperation["type"],
    params: any
  ): T | undefined {
    const key = this.generateKey(type, params);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    
    if (this.isExpired(entry)) {
      this.stats.memoryUsage -= entry.size;
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return undefined;
    }
    
    this.stats.hits++;
    agentLogger.info(`[OperationCache] Cache hit for ${type}: ${key}`);
    return entry.data as T;
  }

  /**
   * Cache operation result
   */
  set<T = any>(
    type: CachedOperation["type"],
    params: any,
    data: T,
    customTtl?: number
  ): void {
    const key = this.generateKey(type, params);
    const ttl = customTtl || this.TTL_CONFIG[type];
    const size = this.calculateSize(data);
    
    // Remove existing entry if it exists
    const existing = this.cache.get(key);
    if (existing) {
      this.stats.memoryUsage -= existing.size;
    }
    
    // Add new entry
    const entry: CachedOperation<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      key,
      type,
      size,
    };
    
    this.cache.set(key, entry);
    this.stats.memoryUsage += size;
    this.stats.size = this.cache.size;
    
    agentLogger.info(`[OperationCache] Cached ${type}: ${key} (${size} bytes)`);
    
    // Cleanup if needed
    this.cleanup();
  }

  /**
   * Check if operation is cached (without incrementing stats)
   */
  has(type: CachedOperation["type"], params: any): boolean {
    const key = this.generateKey(type, params);
    const entry = this.cache.get(key);
    
    if (!entry || this.isExpired(entry)) {
      if (entry) {
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        this.stats.evictions++;
      }
      return false;
    }
    
    return true;
  }

  /**
   * Remove specific cache entry
   */
  invalidate(type: CachedOperation["type"], params: any): void {
    const key = this.generateKey(type, params);
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.memoryUsage -= entry.size;
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.size = this.cache.size;
      agentLogger.info(`[OperationCache] Invalidated ${type}: ${key}`);
    }
  }

  /**
   * Clear all cache entries for a specific type
   */
  invalidateType(type: CachedOperation["type"]): void {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.type === type) {
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        removed++;
        this.stats.evictions++;
      }
    }
    this.stats.size = this.cache.size;
    agentLogger.info(`[OperationCache] Invalidated ${removed} entries of type ${type}`);
  }

  /**
   * Clear all cache entries for a specific user
   */
  invalidateUser(userId: string): void {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (key.includes(userId)) {
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        removed++;
        this.stats.evictions++;
      }
    }
    this.stats.size = this.cache.size;
    agentLogger.info(`[OperationCache] Invalidated ${removed} entries for user ${userId}`);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: size,
      size: 0,
      memoryUsage: 0,
    };
    agentLogger.info(`[OperationCache] Cleared all ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & {
    hitRate: number;
    types: Record<string, number>;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    // Count entries by type
    const types: Record<string, number> = {};
    for (const entry of this.cache.values()) {
      types[entry.type] = (types[entry.type] || 0) + 1;
    }
    
    return {
      ...this.stats,
      hitRate,
      types,
    };
  }

  /**
   * Get cache entries for debugging
   */
  getDebugInfo(): {
    stats: ReturnType<OperationCache["getStats"]>;
    entries: Array<{
      key: string;
      type: string;
      age: number;
      size: number;
      expiresIn: number;
    }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      type: entry.type,
      age: now - entry.timestamp,
      size: entry.size,
      expiresIn: (entry.timestamp + entry.ttl) - now,
    }));
    
    return {
      stats: this.getStats(),
      entries,
    };
  }
}

// Singleton instance
export const operationCache = new OperationCache();
