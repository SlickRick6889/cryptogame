const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

// Generate a new keypair for testing
const testWallet = Keypair.generate();

console.log('🧪 STAYPOOL Test Treasury Wallet Generated!');
console.log('==========================================');
console.log('');
console.log('📍 Public Address:');
console.log(testWallet.publicKey.toString());
console.log('');
console.log('🔐 Private Key (Base58):');
console.log(bs58.encode(testWallet.secretKey));
console.log('');
console.log('💡 Next Steps:');
console.log('1. Fund this wallet with devnet SOL: https://faucet.solana.com');
console.log('2. Add the address to .env.local');
console.log('3. Add the private key to functions/.env');
console.log('');
console.log('⚠️  DEVNET ONLY - DO NOT USE ON MAINNET!');
console.log('=========================================='); 