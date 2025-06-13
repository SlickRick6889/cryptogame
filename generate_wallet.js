const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

// Generate a new keypair
const keypair = Keypair.generate();

console.log('🔑 New Treasury Wallet Generated:');
console.log('📍 Public Key (Address):', keypair.publicKey.toString());
console.log('🔐 Private Key (Base58):', bs58.encode(keypair.secretKey));
console.log('');
console.log('⚠️  IMPORTANT: Save the private key securely!');
console.log('💰 Send some SOL to the public address to fund the treasury');
console.log('');
console.log('🚀 To set this in Firebase Functions:');
console.log(`firebase functions:config:set treasury.pk="${bs58.encode(keypair.secretKey)}"`); 