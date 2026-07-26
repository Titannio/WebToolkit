/**
 * @module cache.utils
 * @description Lightweight in-memory cache utility with expiration support.
 */

/**
 * Optional cache expiration and capacity defaults.
 */
export interface MemoryCacheOptions {
    /** Default time-to-live in milliseconds. Zero disables expiration. */
    defaultTtlMs?: number
    /** Maximum number of entries retained using least-recently-used eviction. */
    maxEntries?: number
}

/**
 * Simple in-memory cache utility with key-based storage and expiration support.
 * Designed to be framework-agnostic and work in both Node.js and Browser environments.
 *
 * @template T - The type of data being cached.
 */
export class MemoryCache<T = unknown> {
    /**
     * Internal storage for cached entries.
     * @private
     */
    #cache = new Map<string, { value: T; expiresAt?: number }>();

    /**
     * Map of active timeout timers for automatic cache expiration.
     * @private
     */
    #timers = new Map<string, ReturnType<typeof setTimeout>>();

    #defaultTtlMs?: number

    #maxEntries?: number

    /**
     * Creates a cache with optional default expiration and capacity.
     *
     * @param {MemoryCacheOptions} [options={}] - Cache defaults.
     */
    constructor({ defaultTtlMs, maxEntries }: MemoryCacheOptions = {}) {
        if (defaultTtlMs !== undefined && (!Number.isFinite(defaultTtlMs) || defaultTtlMs < 0)) {
            throw new Error('defaultTtlMs must be a non-negative finite number')
        }
        if (maxEntries !== undefined && (!Number.isInteger(maxEntries) || maxEntries < 1)) {
            throw new Error('maxEntries must be a positive integer')
        }

        this.#defaultTtlMs = defaultTtlMs
        this.#maxEntries = maxEntries
    }

    /**
     * Retrieves an item from the cache.
     *
     * @param {string} key - The unique identifier for the cached data.
     * @returns {T | undefined} - The cached value associated with the key, or undefined if not found or expired.
     */
    get(key: string): T | undefined {
        const entry = this.#cache.get(key);
        if (!entry) return undefined;

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.delete(key);
            return undefined;
        }

        if (this.#maxEntries !== undefined) {
            this.#cache.delete(key)
            this.#cache.set(key, entry)
        }

        return entry.value;
    }

    /**
     * Stores an item in the cache with an optional TTL.
     *
     * @param {string} key - The unique identifier for the cached data.
     * @param {T} value - The data to store in the cache.
     * @param {number} [ttlMs] - Optional time-to-live in milliseconds.
     * @returns {void}
     */
    set(key: string, value: T, ttlMs?: number): void {
        this.delete(key); // Clear existing timer/value

        const effectiveTtlMs = ttlMs ?? this.#defaultTtlMs
        const expiresAt = effectiveTtlMs ? Date.now() + effectiveTtlMs : undefined;
        this.#cache.set(key, { value, expiresAt });

        if (effectiveTtlMs) {
            const timer = setTimeout(() => this.delete(key), effectiveTtlMs);
            this.#timers.set(key, timer);
        }

        if (this.#maxEntries !== undefined && this.#cache.size > this.#maxEntries) {
            this.delete(this.#cache.keys().next().value!)
        }
    }

    /**
     * Number of unexpired entries.
     */
    get size(): number {
        const now = Date.now()
        for (const [key, entry] of this.#cache) {
            if (entry.expiresAt && now > entry.expiresAt) this.delete(key)
        }
        return this.#cache.size
    }

    /**
     * Checks if an item exists and is not expired.
     *
     * @param {string} key - The unique identifier for the cached data.
     * @returns {boolean} - True if the key exists and is valid, false otherwise.
     */
    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    /**
     * Removes an item from the cache and clears its expiration timer.
     *
     * @param {string} key - The unique identifier for the cached data.
     * @returns {void}
     */
    delete(key: string): void {
        const timer = this.#timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.#timers.delete(key);
        }
        this.#cache.delete(key);
    }

    /**
     * Clears all items from the cache and stops all timers.
     * 
     * @returns {void}
     */
    clear(): void {
        for (const timer of this.#timers.values()) {
            clearTimeout(timer);
        }
        this.#timers.clear();
        this.#cache.clear();
    }
}
