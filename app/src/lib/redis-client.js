"use strict";

/**
 * @fileoverview Hardened Redis client for rate limiting.
 * Uses node-redis with production-ready configuration.
 */

const { createClient } = require("redis");
const { config } = require("../config");
const { logger } = require("../lib/logger");

/** @type {import('redis').RedisClientType | null} */
let client = null;

/** @type {boolean} */
let isConnecting = false;

/** @type {boolean} */
let isConnected = false;

/**
 * Build Redis client configuration with hardened settings.
 * @returns {import('redis').RedisClientOptions}
 */
function buildRedisConfig() {
    const redisUrl = config.redisUrl;

    if (!redisUrl) {
        throw new Error("REDIS_URL is required for Redis store");
    }

    return {
        url: redisUrl,

        // Client identification
        name: "mail-forwarding-api-ratelimit",

        // Socket configuration with hardened timeouts
        socket: {
            // Connection timeout: 5 seconds
            connectTimeout: 5000,

            // Socket idle timeout: 30 seconds (prevents stale connections)
            socketTimeout: 30000,

            // Keep TCP connection alive
            keepAlive: true,
            keepAliveInitialDelay: 5000,

            // Disable Nagle's algorithm for lower latency
            noDelay: true,

            // Reconnect strategy with exponential backoff
            reconnectStrategy: (retries, cause) => {
                // Log reconnection attempts
                logger.warn("redis.reconnecting", {
                    retries,
                    cause: cause?.message || String(cause),
                });

                // After 10 retries, give up (approximately 2 minutes of retrying)
                if (retries > 10) {
                    logger.error("redis.reconnect.giveup", { retries });
                    return new Error("Redis connection failed after max retries");
                }

                // Exponential backoff: 2^retries * 100ms, max 10 seconds
                // Plus random jitter 0-500ms to prevent thundering herd
                const jitter = Math.floor(Math.random() * 500);
                const delay = Math.min(Math.pow(2, retries) * 100, 10000);

                return delay + jitter;
            },
        },

        // Limit command queue to prevent memory exhaustion
        commandsQueueMaxLength: 10000,

        // Disable offline queue to fail fast when Redis is down
        disableOfflineQueue: false,
    };
}

/**
 * Get or create the Redis client singleton.
 * Lazily initializes and connects on first call.
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function getRedisClient() {
    if (client && isConnected) {
        return client;
    }

    if (isConnecting) {
        // Wait for ongoing connection attempt
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (isConnected && client) {
                    clearInterval(checkInterval);
                    resolve(client);
                } else if (!isConnecting) {
                    clearInterval(checkInterval);
                    reject(new Error("Redis connection failed"));
                }
            }, 100);

            // Timeout after 10 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error("Redis connection timeout"));
            }, 10000);
        });
    }

    isConnecting = true;

    try {
        const redisConfig = buildRedisConfig();

        client = createClient(redisConfig);

        // Event handlers for monitoring
        client.on("error", (err) => {
            logger.error("redis.error", { err: err?.message || String(err) });
            isConnected = false;
        });

        client.on("connect", () => {
            logger.info("redis.connecting");
        });

        client.on("ready", () => {
            logger.info("redis.ready");
            isConnected = true;
        });

        client.on("end", () => {
            logger.warn("redis.disconnected");
            isConnected = false;
        });

        client.on("reconnecting", () => {
            logger.info("redis.reconnecting");
        });

        // Connect to Redis
        await client.connect();

        isConnected = true;
        isConnecting = false;

        logger.info("redis.connected", { url: config.redisUrl?.replace(/:[^:@]+@/, ":***@") });

        return client;
    } catch (err) {
        isConnecting = false;
        isConnected = false;
        client = null;

        logger.error("redis.connect.failed", { err: err?.message || String(err) });
        throw err;
    }
}

/**
 * Check if Redis is configured and available.
 * @returns {boolean}
 */
function isRedisConfigured() {
    return Boolean(config.redisUrl);
}

/**
 * Check if Redis client is currently connected.
 * @returns {boolean}
 */
function isRedisConnected() {
    return isConnected && client !== null;
}

/**
 * Gracefully close the Redis connection.
 * @returns {Promise<void>}
 */
async function closeRedisClient() {
    if (client) {
        try {
            await client.quit();
            logger.info("redis.closed");
        } catch (err) {
            logger.warn("redis.close.error", { err: err?.message || String(err) });
            // Force disconnect if quit fails
            client.disconnect();
        } finally {
            client = null;
            isConnected = false;
            isConnecting = false;
        }
    }
}

module.exports = {
    getRedisClient,
    isRedisConfigured,
    isRedisConnected,
    closeRedisClient,
};
