import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

// Solana connection
export const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_HOST || 'https://api.devnet.solana.com',
  'confirmed'
);

// Jupiter API configuration
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: any[];
}

export interface SwapInstructionsResponse {
  tokenLedgerInstruction: string | null;
  computeBudgetInstructions: string[];
  setupInstructions: string[];
  swapInstruction: string;
  cleanupInstruction: string | null;
  addressLookupTableAddresses: string[];
}

/**
 * Get a quote for swapping SOL to a token via Jupiter
 */
export async function getJupiterQuote(
  inputMint: string, // SOL mint address
  outputMint: string, // Target token mint address
  amount: number // Amount in lamports
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: '50', // 0.5% slippage
  });

  const response = await fetch(`${JUPITER_API_URL}/quote?${params}`);
  
  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get swap instructions from Jupiter
 */
export async function getJupiterSwapInstructions(
  quote: JupiterQuoteResponse,
  userPublicKey: string,
  wrapAndUnwrapSol: boolean = true
): Promise<SwapInstructionsResponse> {
  const response = await fetch(`${JUPITER_API_URL}/swap-instructions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!response.ok) {
    throw new Error(`Jupiter swap instructions failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Create a transaction for swapping SOL to tokens
 */
export async function createSwapTransaction(
  inputMint: string,
  outputMint: string,
  amount: number,
  userPublicKey: PublicKey
): Promise<{ transaction: Transaction; quote: JupiterQuoteResponse }> {
  try {
    // Get quote from Jupiter
    const quote = await getJupiterQuote(inputMint, outputMint, amount);
    
    // Get swap instructions
    const swapInstructions = await getJupiterSwapInstructions(
      quote,
      userPublicKey.toBase58()
    );

    // Create transaction
    const transaction = new Transaction();
    
    // Add compute budget instructions
    if (swapInstructions.computeBudgetInstructions.length > 0) {
      swapInstructions.computeBudgetInstructions.forEach((instruction) => {
        transaction.add(Transaction.from(Buffer.from(instruction, 'base64')).instructions[0]);
      });
    }

    // Add setup instructions
    if (swapInstructions.setupInstructions.length > 0) {
      swapInstructions.setupInstructions.forEach((instruction) => {
        transaction.add(Transaction.from(Buffer.from(instruction, 'base64')).instructions[0]);
      });
    }

    // Add swap instruction
    transaction.add(
      Transaction.from(Buffer.from(swapInstructions.swapInstruction, 'base64')).instructions[0]
    );

    // Add cleanup instruction
    if (swapInstructions.cleanupInstruction) {
      transaction.add(
        Transaction.from(Buffer.from(swapInstructions.cleanupInstruction, 'base64')).instructions[0]
      );
    }

    return { transaction, quote };
  } catch (error) {
    console.error('Error creating swap transaction:', error);
    throw error;
  }
}

/**
 * Transfer tokens to the prize wallet
 */
export async function createTokenTransferTransaction(
  tokenMint: PublicKey,
  fromWallet: PublicKey,
  toWallet: PublicKey,
  amount: number
): Promise<Transaction> {
  const transaction = new Transaction();

  // Get associated token accounts
  const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromWallet);
  const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toWallet);

  // Check if destination token account exists
  const toTokenAccountInfo = await connection.getAccountInfo(toTokenAccount);
  
  if (!toTokenAccountInfo) {
    // Create associated token account for destination
    transaction.add(
      createAssociatedTokenAccountInstruction(
        fromWallet, // payer
        toTokenAccount,
        toWallet,
        tokenMint
      )
    );
  }

  // Add transfer instruction
  const { createTransferInstruction } = await import('@solana/spl-token');
  transaction.add(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromWallet,
      amount
    )
  );

  return transaction;
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  tokenMint: PublicKey,
  wallet: PublicKey
): Promise<number> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(tokenMint, wallet);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return balance.value.uiAmount || 0;
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  }
}

/**
 * Get SOL balance for a wallet
 */
export async function getSolBalance(wallet: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(wallet);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error getting SOL balance:', error);
    return 0;
  }
}

/**
 * Check if a transaction is confirmed
 */
export async function confirmTransaction(signature: string): Promise<boolean> {
  try {
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    return !confirmation.value.err;
  } catch (error) {
    console.error('Error confirming transaction:', error);
    return false;
  }
}

/**
 * Constants for common mints
 */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Convert SOL amount to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
} 