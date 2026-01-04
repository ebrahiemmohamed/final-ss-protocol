/**
 * AMM Calculator Web Worker
 * Runs all expensive AMM calculations in background thread
 * to prevent UI blocking and memory issues
 */

import { ethers } from 'ethers';

// PulseX Router ABI (minimal)
const PULSEX_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const PULSEX_ROUTER_ADDRESS = '0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02';
// Defaults only (can be overridden per request via options)
const DEFAULT_WPLS_ADDRESS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';
const DEFAULT_STATE_ADDRESS = '0x233fDa1043d9fbE59Fe89fA0492644430C67C35a';

// RPC endpoint for background calculations
const RPC_URL = 'https://pulsechain-rpc.publicnode.com';

let provider = null;
let routerContract = null;

// Initialize provider and contract
function initProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    routerContract = new ethers.Contract(
      PULSEX_ROUTER_ADDRESS,
      PULSEX_ROUTER_ABI,
      provider
    );
  }
  return { provider, routerContract };
}

// Calculate PLS value for a single token via AMM
async function calculateTokenPlsValue(tokenAddress, balance, decimals = 18) {
  if (!balance || balance === '0' || !tokenAddress) return { numeric: 0, display: '0' };
  
  try {
    const { routerContract } = initProvider();
    
    // Parse balance to wei
    const balanceWei = ethers.parseUnits(String(balance), decimals);
    if (balanceWei === 0n) return { numeric: 0, display: '0' };
    
    // Get quote: TOKEN -> WPLS
    const path = [tokenAddress, WPLS_ADDRESS];
    const amounts = await routerContract.getAmountsOut(balanceWei, path);
    const plsAmount = amounts[amounts.length - 1];
    
    const numericValue = Number(ethers.formatEther(plsAmount));
    const displayValue = numericValue >= 1 
      ? Math.floor(numericValue).toLocaleString()
      : numericValue.toFixed(4);
    
    return { numeric: numericValue, display: displayValue };
  } catch (error) {
    console.debug('AMM calculation error for', tokenAddress, error.message);
    return { numeric: 0, display: 'N/A' };
  }
}

// Calculate TOKEN -> STATE output (wei)
async function calculateTokenStateWei(tokenAddress, balance, stateAddress, decimals = 18) {
  if (!balance || balance === '0' || !tokenAddress) return 0n;

  try {
    const { routerContract } = initProvider();
    const balanceWei = ethers.parseUnits(String(balance), decimals);
    if (balanceWei === 0n) return 0n;

    const path = [tokenAddress, stateAddress];
    const amounts = await routerContract.getAmountsOut(balanceWei, path);
    return amounts[amounts.length - 1] || 0n;
  } catch {
    return 0n;
  }
}

function formatWeiToIntegerWithCommas(wei) {
  try {
    if (wei === 0n) return '0';
    const full = ethers.formatEther(wei);
    const intPart = full.split('.')[0] || '0';
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch {
    return '0';
  }
}

function formatWeiToDisplay(wei) {
  try {
    if (wei === 0n) return '0';
    const full = ethers.formatEther(wei);
    const [intPart, decPart = ''] = full.split('.');
    const intNum = intPart || '0';
    if (intNum !== '0') {
      return intNum.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    const dec4 = (decPart + '0000').slice(0, 4);
    return `0.${dec4}`;
  } catch {
    return '0';
  }
}

// Calculate STATE -> PLS value
async function calculateStatePlsValue(stateBalance) {
  if (!stateBalance || stateBalance === '0') return { numeric: 0, display: '0' };
  
  try {
    const { routerContract } = initProvider();
    
    const balanceWei = ethers.parseUnits(String(stateBalance), 18);
    if (balanceWei === 0n) return { numeric: 0, display: '0' };
    
    // STATE -> WPLS
    const path = [STATE_ADDRESS, WPLS_ADDRESS];
    const amounts = await routerContract.getAmountsOut(balanceWei, path);
    const plsAmount = amounts[amounts.length - 1];
    
    const numericValue = Number(ethers.formatEther(plsAmount));
    const displayValue = numericValue >= 1 
      ? Math.floor(numericValue).toLocaleString()
      : numericValue.toFixed(4);
    
    return { numeric: numericValue, display: displayValue };
  } catch (error) {
    console.debug('STATE AMM calculation error', error.message);
    return { numeric: 0, display: 'N/A' };
  }
}

// Main calculation function - calculates all tokens at once
async function calculateAllAmmValues(tokens, tokenBalances) {
  return calculateAllAmmValuesWithOptions(tokens, tokenBalances, {});
}

async function calculateAllAmmValuesWithOptions(tokens, tokenBalances, options) {
  const onlyTotal = Boolean(options?.onlyTotal);
  const stateAddress = ethers.getAddress(options?.stateAddress || DEFAULT_STATE_ADDRESS);
  const wplsAddress = ethers.getAddress(options?.wplsAddress || DEFAULT_WPLS_ADDRESS);
  const results = {};
  let totalStateWei = 0n;

  // Full parallel calculation (fastest wall-clock time; may increase RPC load)
  const perTokenResults = await Promise.all(tokens.map(async (token) => {
    const tokenName = token.tokenName;
    const balance = tokenBalances?.[tokenName];

    if (tokenName === 'DAV') {
      return { tokenName, numeric: 0, display: '-----', stateWei: 0n };
    }

    if (tokenName === 'STATE') {
      const result = { numeric: 0, display: onlyTotal ? '0' : '0', stateWei: 0n, plsWei: 0n };
      try {
        const stateWei = ethers.parseUnits(String(balance || '0'), 18);
        return { tokenName, ...result, stateWei };
      } catch {
        return { tokenName, ...result, stateWei: 0n };
      }
    }

    if (!balance || !token.TokenAddress) {
      return { tokenName, numeric: 0, display: '0', stateWei: 0n };
    }

    // Always compute TOKEN -> STATE for totals.
    // Only compute TOKEN -> WPLS display values when needed.
    const stateWei = await calculateTokenStateWei(token.TokenAddress, balance, stateAddress);
    return { tokenName, numeric: 0, display: onlyTotal ? '0' : '0', stateWei };
  }));

  const stateWeiByToken = {};
  for (const result of perTokenResults) {
    stateWeiByToken[result.tokenName] = result.stateWei || 0n;
    if (result.tokenName !== 'DAV') {
      totalStateWei += result.stateWei || 0n;
    }
  }

  // Convert aggregated STATE total into PLS once
  let totalSum = '0';
  let totalPlsWei = 0n;
  try {
    if (totalStateWei > 0n) {
      const { routerContract } = initProvider();
      const path = [stateAddress, wplsAddress];
      const amounts = await routerContract.getAmountsOut(totalStateWei, path);
      totalPlsWei = amounts[amounts.length - 1] || 0n;
      totalSum = formatWeiToIntegerWithCommas(totalPlsWei);
    }
  } catch {
    totalSum = '0';
    totalPlsWei = 0n;
  }

  if (!onlyTotal) {
    for (const token of tokens) {
      const tokenName = token.tokenName;
      if (tokenName === 'DAV') {
        results[tokenName] = '-----';
        continue;
      }
      const tokenStateWei = stateWeiByToken[tokenName] || 0n;
      if (totalStateWei === 0n || totalPlsWei === 0n || tokenStateWei === 0n) {
        results[tokenName] = '0';
        continue;
      }
      const tokenPlsWei = (totalPlsWei * tokenStateWei) / totalStateWei;
      results[tokenName] = formatWeiToDisplay(tokenPlsWei);
    }
  }

  return {
    values: results,
    totalSum,
    timestamp: Date.now()
  };
}

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, tokens, tokenBalances, options, requestId } = event.data;
  
  if (type === 'CALCULATE_AMM') {
    try {
      const result = await calculateAllAmmValuesWithOptions(tokens, tokenBalances, options);
      self.postMessage({
        type: 'AMM_RESULT',
        result,
        requestId
      });
    } catch (error) {
      self.postMessage({
        type: 'AMM_ERROR',
        error: error.message,
        requestId
      });
    }
  }
};

// Signal worker is ready
self.postMessage({ type: 'WORKER_READY' });
