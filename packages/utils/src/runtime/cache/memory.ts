/**
 * @module cache.utils
 * @description Lightweight in-memory cache utility with expiration support.
 */

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

        const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
        this.#cache.set(key, { value, expiresAt });

        if (ttlMs) {
            const timer = setTimeout(() => this.delete(key), ttlMs);
            this.#timers.set(key, timer);
        }
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
