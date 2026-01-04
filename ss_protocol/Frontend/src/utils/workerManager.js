/**
 * AMM Worker Manager
 * 
 * Singleton manager for the AMM Calculator Web Worker.
 * Keeps heavy AMM calculations off the main thread.
 * 
 * Features:
 * - Single worker instance (prevents multiple worker spawns)
 * - Request/response matching with requestIds
 * - Automatic worker restart on crash
 * - Timeout handling for stale requests
 * - Memory-efficient worker pooling
 */

let worker = null;
let isReady = false;
let pendingRequests = new Map();
let requestIdCounter = 0;

const REQUEST_TIMEOUT = 30000; // 30 second timeout

/**
 * Initialize or get the worker instance
 */
function getWorker() {
  if (worker) return worker;
  
  try {
    // Create worker with proper module import
    worker = new Worker(
      new URL('../workers/ammCalculator.worker.js', import.meta.url),
      { type: 'module' }
    );
    
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    
    console.debug('[AMM Worker] Initialized');
    return worker;
  } catch (error) {
    console.error('[AMM Worker] Failed to initialize:', error);
    return null;
  }
}

/**
 * Handle messages from worker
 */
function handleWorkerMessage(event) {
  const { type, result, error, requestId } = event.data;
  
  if (type === 'WORKER_READY') {
    isReady = true;
    console.debug('[AMM Worker] Ready');
    return;
  }
  
  if (type === 'AMM_RESULT' || type === 'AMM_ERROR') {
    const pending = pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      
      if (type === 'AMM_ERROR') {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
  }
}

/**
 * Handle worker errors
 */
function handleWorkerError(error) {
  console.error('[AMM Worker] Error:', error);
  
  // Reject all pending requests
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('Worker crashed'));
  }
  pendingRequests.clear();
  
  // Restart worker
  terminateWorker();
  getWorker();
}

/**
 * Terminate the worker
 */
export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
    isReady = false;
  }
}

/**
 * Calculate AMM values using the worker
 * Returns a promise that resolves with { values, totalSum, timestamp }
 */
export function calculateAmmValuesAsync(tokens, tokenBalances, options) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    
    if (!w) {
      reject(new Error('Worker not available'));
      return;
    }
    
    const requestId = ++requestIdCounter;
    
    // Set timeout
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('AMM calculation timeout'));
    }, REQUEST_TIMEOUT);
    
    // Store pending request
    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      timestamp: Date.now()
    });
    
    // Send to worker
    w.postMessage({
      type: 'CALCULATE_AMM',
      tokens,
      tokenBalances,
      options,
      requestId
    });
  });
}

/**
 * Check if worker is ready
 */
export function isWorkerReady() {
  return isReady;
}

/**
 * Get count of pending requests
 */
export function getPendingCount() {
  return pendingRequests.size;
}

/**
 * Clear stale pending requests (older than 60 seconds)
 */
export function clearStaleRequests() {
  const now = Date.now();
  const staleThreshold = 60000;
  
  for (const [requestId, pending] of pendingRequests) {
    if (now - pending.timestamp > staleThreshold) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Request stale'));
      pendingRequests.delete(requestId);
    }
  }
}

// Initialize worker on module load
getWorker();

// Cleanup stale requests every 30 seconds
setInterval(clearStaleRequests, 30000);

export default {
  calculateAmmValuesAsync,
  terminateWorker,
  isWorkerReady,
  getPendingCount,
  clearStaleRequests,
};
