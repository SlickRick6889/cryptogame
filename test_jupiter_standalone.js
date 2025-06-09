const { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const axios = require('axios');

// Configuration
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389';
const BALL_TOKEN_MINT = 'BALLrveijbhu42QaS2XW1pRBYfMji73bGeYJghUvQs6y'; // BALL token mint (correct)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';

// Treasury wallet private key (get from Firebase config or command line argument)
// SECURITY: Never hardcode private keys! Use environment variables or command line arguments.

async function testJupiterSwap() {
  try {
    console.log('🧪 Testing Jupiter Swap: 0.025 SOL → BALL tokens');
    console.log('=' .repeat(60));
    
    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    console.log('✅ Connected to Solana RPC');
    
    // Load treasury wallet (you'll need to provide the actual private key)
    console.log('📝 Please provide your treasury wallet private key...');
    console.log('⚠️  For security, you should enter it manually when prompted');
    
    // For now, let's just test the quote API without executing
    await testJupiterQuote();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

async function testJupiterQuote() {
  try {
    console.log('\n🔍 Step 1: Testing Jupiter Quote API');
    
    const solAmount = 0.025; // 0.025 SOL
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    
    console.log(`💰 Requesting quote for ${solAmount} SOL (${lamports} lamports)`);
    
    // Get quote from Jupiter
    const quoteUrl = `${JUPITER_API_URL}/quote?inputMint=${SOL_MINT}&outputMint=${BALL_TOKEN_MINT}&amount=${lamports}&slippageBps=300`;
    
    console.log('🌐 Jupiter Quote URL:', quoteUrl);
    
    const quoteResponse = await axios.get(quoteUrl);
    const quote = quoteResponse.data;
    
    if (!quote || quote.error) {
      throw new Error(`Jupiter quote failed: ${quote?.error || 'Unknown error'}`);
    }
    
    console.log('✅ Jupiter Quote Success!');
    console.log('📊 Quote Details:');
    console.log(`   Input: ${quote.inAmount} lamports (${quote.inAmount / LAMPORTS_PER_SOL} SOL)`);
    console.log(`   Output: ${quote.outAmount} tokens`);
    console.log(`   Price Impact: ${quote.priceImpactPct}%`);
    console.log(`   Route: ${quote.routePlan?.length || 0} steps`);
    
    // Show route details
    if (quote.routePlan && quote.routePlan.length > 0) {
      console.log('🗺️  Route Plan:');
      quote.routePlan.forEach((step, index) => {
        console.log(`   Step ${index + 1}: ${step.swapInfo?.label || 'Unknown DEX'}`);
      });
    }
    
    // Test token account detection
    await testTokenProgram();
    
    // Show final calculation
    const ballTokens = parseInt(quote.outAmount);
    const ballTokensFormatted = (ballTokens / 1e9).toLocaleString(); // 9 decimals for BALL token
    
    console.log('\n🎯 RESULT:');
    console.log(`   ${solAmount} SOL would get you approximately ${ballTokensFormatted} BALL tokens`);
    console.log(`   Raw amount: ${ballTokens} (with decimals)`);
    
    return quote;
    
  } catch (error) {
    console.error('❌ Jupiter quote test failed:', error.response?.data || error.message);
    throw error;
  }
}

async function testTokenProgram() {
  try {
    console.log('\n🔍 Step 2: Detecting BALL Token Program');
    
    const connection = new Connection(RPC_URL, 'confirmed');
    const tokenMint = new PublicKey(BALL_TOKEN_MINT);
    
    // Get mint account info
    const mintInfo = await connection.getAccountInfo(tokenMint);
    
    if (!mintInfo) {
      console.log('❌ Could not find BALL token mint account');
      return;
    }
    
    console.log('✅ BALL token mint found');
    console.log(`   Owner Program: ${mintInfo.owner.toString()}`);
    
    // Check which token program it uses
    if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      console.log('🔍 BALL token uses TOKEN_2022_PROGRAM_ID');
    } else if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      console.log('🔍 BALL token uses legacy TOKEN_PROGRAM_ID');
    } else {
      console.log('⚠️  BALL token uses unknown program:', mintInfo.owner.toString());
    }
    
    // Get token supply and decimals
    const supply = await connection.getTokenSupply(tokenMint);
    console.log(`   Decimals: ${supply.value.decimals}`);
    console.log(`   Total Supply: ${supply.value.uiAmountString}`);
    
  } catch (error) {
    console.error('❌ Token program detection failed:', error.message);
  }
}

async function testFullSwapWithWallet(privateKeyBase58) {
  try {
    console.log('\n🔍 Step 3: Testing Full Swap Transaction');
    
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Fix: use bs58.default.decode if bs58.decode doesn't work
    let wallet;
    try {
      wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    } catch (error) {
      // Try alternative import method
      wallet = Keypair.fromSecretKey(bs58.default.decode(privateKeyBase58));
    }
    
    console.log(`👛 Using wallet: ${wallet.publicKey.toString()}`);
    
    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    
    console.log(`💰 Wallet balance: ${solBalance} SOL`);
    
    if (solBalance < 0.03) {
      console.log('⚠️  Insufficient SOL for test (need at least 0.03 SOL)');
      return;
    }
    
    // Get quote
    const quote = await testJupiterQuote();
    
    // Get swap transaction
    console.log('🔄 Creating swap transaction...');
    
    const swapResponse = await axios.post(`${JUPITER_API_URL}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    });
    
    const { swapTransaction } = swapResponse.data;
    
    // Deserialize and sign transaction
    const transactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    
    transaction.sign([wallet]);
    
    console.log('📤 Sending transaction...');
    
    // Send transaction
    const signature = await connection.sendTransaction(transaction);
    
    console.log(`✅ Transaction sent: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.log('❌ Transaction failed:', confirmation.value.err);
    } else {
      console.log('🎉 Transaction confirmed successfully!');
      console.log(`💰 Successfully swapped 0.025 SOL for ${parseInt(quote.outAmount) / 1e9} BALL tokens!`);
    }
    
    return signature;
    
  } catch (error) {
    console.error('❌ Full swap test failed:', error.response?.data || error.message);
    throw error;
  }
}

// Interactive mode
async function runInteractiveTest() {
  console.log('🎮 Jupiter Swap Test Suite');
  console.log('=' .repeat(60));
  
  // Test quote first (always safe)
  await testJupiterQuote();
  
  // Ask if user wants to test actual swap
  console.log('\n❓ Do you want to test an actual swap?');
  console.log('   This will require your treasury wallet private key');
  console.log('   and will execute a real transaction.');
  console.log('\n   If yes, provide your treasury private key as argument:');
  console.log('   node test_jupiter_standalone.js YOUR_PRIVATE_KEY_HERE');
}

// Main execution
async function main() {
  const privateKey = process.argv[2];
  
  if (privateKey) {
    console.log('🔑 Private key provided - running full swap test');
    await testFullSwapWithWallet(privateKey);
  } else {
    console.log('📊 Running quote-only test');
    await runInteractiveTest();
  }
}

// Run the test
main().catch(console.error); 