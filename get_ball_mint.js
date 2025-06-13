const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  projectId: "website-6889",
  // Add other config if needed
};

async function getBallMintAddress() {
  try {
    console.log('🔍 Calling Firebase debugConfig to get BALL token mint...');
    
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const functions = getFunctions(app);
    
    // Call the debug function
    const debugConfig = httpsCallable(functions, 'debugConfig');
    const result = await debugConfig({});
    
    const data = result.data;
    
    if (data.success) {
      console.log('\n✅ Debug Config Results:');
      console.log('📊 Firebase Config:');
      console.log('   Token Mint:', data.status.firebaseConfig.tokenMint);
      console.log('   RPC URL:', data.status.firebaseConfig.rpcUrl);
      
      console.log('\n🏀 BALL Token Config:');
      console.log('   Exists:', data.status.ballToken.exists);
      console.log('   Mint Address:', data.status.ballToken.mintAddress);
      
      console.log('\n💰 Treasury Config:');
      console.log('   Has Private Key:', data.status.treasury.hasPrivateKey);
      
      // Determine which mint address is being used
      const actualMint = data.status.firebaseConfig.tokenMint !== 'NOT SET' 
        ? data.status.firebaseConfig.tokenMint 
        : data.status.ballToken.mintAddress !== 'NOT SET'
        ? data.status.ballToken.mintAddress
        : process.env.BALL_TOKEN_MINT || 'BALLrveijbhu42QaS2XW1pRBYfMji73bGeYJghUvQs6y';
      
      console.log('\n🎯 ACTUAL BALL TOKEN MINT BEING USED:');
      console.log('   ' + actualMint);
      
      return actualMint;
      
    } else {
      console.error('❌ Debug config failed:', data.error);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error calling debug config:', error.message);
    return null;
  }
}

// Run the function
getBallMintAddress().then(mint => {
  if (mint) {
    console.log('\n✅ Success! Use this mint address in your Jupiter test:');
    console.log('   ' + mint);
  }
}).catch(console.error); 