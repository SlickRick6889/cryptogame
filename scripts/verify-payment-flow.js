const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Wallets
const USER_WALLET = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';
const DEV_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';
const DUMMY_TOKEN = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

async function checkSOLBalances() {
  console.log('💰 SOL BALANCE CHECK');
  console.log('==================');
  
  try {
    // User wallet balance
    const userBalance = await connection.getBalance(new PublicKey(USER_WALLET));
    const userSOL = userBalance / 1000000000;
    
    // Dev wallet balance  
    const devBalance = await connection.getBalance(new PublicKey(DEV_WALLET));
    const devSOL = devBalance / 1000000000;
    
    console.log('👤 User Wallet:', USER_WALLET);
    console.log('💎 User Balance:', userSOL.toFixed(6), 'SOL');
    console.log('');
    console.log('🏛️  Dev Wallet:', DEV_WALLET);
    console.log('💎 Dev Balance:', devSOL.toFixed(6), 'SOL');
    console.log('');
    
    if (devSOL > 1) {
      console.log('✅ Dev wallet received SOL payments!');
    } else {
      console.log('❌ Dev wallet balance is low - payments might not be going through');
    }
    
    return { userSOL, devSOL };
  } catch (error) {
    console.error('❌ Error checking SOL balances:', error);
    return { userSOL: 0, devSOL: 0 };
  }
}

async function checkTokenBalances() {
  console.log('\n🪙 TOKEN BALANCE CHECK');
  console.log('====================');
  
  try {
    const tokenMint = new PublicKey(DUMMY_TOKEN);
    
    // Check user's DUMMY token balance
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(USER_WALLET)
    );
    
    // Check dev's DUMMY token balance
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(DEV_WALLET)
    );
    
    console.log('👤 User Token Account:', userTokenAccount.toString());
    console.log('🏛️  Dev Token Account:', devTokenAccount.toString());
    console.log('');
    
    // Get token balances
    let userTokenBalance = 0;
    let devTokenBalance = 0;
    
    try {
      const userTokenInfo = await connection.getTokenAccountBalance(userTokenAccount);
      userTokenBalance = userTokenInfo.value.uiAmount || 0;
      console.log('💰 User DUMMY Balance:', userTokenBalance);
    } catch (e) {
      console.log('❌ User has no DUMMY token account or balance');
    }
    
    try {
      const devTokenInfo = await connection.getTokenAccountBalance(devTokenAccount);
      devTokenBalance = devTokenInfo.value.uiAmount || 0;
      console.log('💰 Dev DUMMY Balance:', devTokenBalance);
    } catch (e) {
      console.log('❌ Dev has no DUMMY token account or balance');
    }
    
    console.log('');
    
    if (userTokenBalance > 0) {
      console.log('✅ User has DUMMY tokens!');
    } else {
      console.log('❌ User has no DUMMY tokens yet');
    }
    
    if (devTokenBalance > 0) {
      console.log('✅ Dev wallet has DUMMY tokens to distribute');
    } else {
      console.log('⚠️  Dev wallet has no DUMMY tokens to distribute!');
    }
    
    return { userTokenBalance, devTokenBalance };
    
  } catch (error) {
    console.error('❌ Error checking token balances:', error);
    return { userTokenBalance: 0, devTokenBalance: 0 };
  }
}

async function checkRecentTransactions() {
  console.log('\n📊 RECENT TRANSACTIONS');
  console.log('=====================');
  
  try {
    // Get recent transactions for user wallet
    console.log('👤 User wallet recent transactions:');
    const userSigs = await connection.getSignaturesForAddress(
      new PublicKey(USER_WALLET),
      { limit: 5 }
    );
    
    for (const sig of userSigs) {
      const tx = await connection.getTransaction(sig.signature);
      if (tx) {
        console.log(`  📅 ${new Date(tx.blockTime * 1000).toLocaleString()}`);
        console.log(`  🔗 ${sig.signature}`);
        
        // Check if this was a transfer to dev wallet
        if (tx.transaction.message.accountKeys.some(key => 
          key.toString() === DEV_WALLET
        )) {
          console.log('  💰 ✅ PAYMENT TO DEV WALLET FOUND!');
        }
        console.log('');
      }
    }
    
    // Get recent transactions for dev wallet
    console.log('🏛️  Dev wallet recent transactions:');
    const devSigs = await connection.getSignaturesForAddress(
      new PublicKey(DEV_WALLET),
      { limit: 3 }
    );
    
    for (const sig of devSigs) {
      const tx = await connection.getTransaction(sig.signature);
      if (tx) {
        console.log(`  📅 ${new Date(tx.blockTime * 1000).toLocaleString()}`);
        console.log(`  🔗 ${sig.signature}`);
        console.log('');
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking transactions:', error);
  }
}

async function checkFirebaseStatus() {
  console.log('\n🔥 FIREBASE STATUS CHECK');
  console.log('========================');
  
  try {
    const response = await fetch('https://us-central1-website-6889.cloudfunctions.net/getTreasuryStatus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: {} }),
    });
    
    const result = await response.json();
    
    if (result.result?.success) {
      console.log('✅ Firebase functions are working!');
      console.log('Treasury Status:', JSON.stringify(result.result.treasury, null, 2));
    } else {
      console.log('❌ Firebase functions error:', result);
    }
    
  } catch (error) {
    console.error('❌ Error checking Firebase:', error);
  }
}

async function main() {
  console.log('🎮 STAYPOOL - Payment Flow Verification');
  console.log('=======================================');
  console.log('');
  
  // Check all the components
  const solBalances = await checkSOLBalances();
  const tokenBalances = await checkTokenBalances();
  await checkRecentTransactions();
  await checkFirebaseStatus();
  
  // Summary
  console.log('\n📋 SUMMARY');
  console.log('==========');
  
  if (solBalances.userSOL < 1 && solBalances.devSOL > 1) {
    console.log('✅ SOL Payment: SUCCESS - Your SOL went to dev wallet');
  } else {
    console.log('❌ SOL Payment: Issue detected');
  }
  
  if (tokenBalances.userTokenBalance > 0) {
    console.log('✅ Token Distribution: SUCCESS - You received tokens');
  } else if (tokenBalances.devTokenBalance > 0) {
    console.log('⚠️  Token Distribution: Dev has tokens but you haven\'t received them');
  } else {
    console.log('❌ Token Distribution: Dev wallet has no tokens to distribute');
  }
  
  console.log('\n🎯 Next Steps:');
  if (tokenBalances.devTokenBalance === 0) {
    console.log('1. Fund dev wallet with DUMMY tokens for distribution');
  }
  if (tokenBalances.userTokenBalance === 0 && tokenBalances.devTokenBalance > 0) {
    console.log('2. Check Firebase function logs for token distribution errors');
  }
}

main().catch(console.error); 