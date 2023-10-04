# Blob

#### This repo includes 3 main contracts; BlobToken, Feeding, and Staking.

Try running the following tasks:

```shell
git clone https://github.com/devSaadRaja/Blob-Hardhat.git .
npm install
npx hardhat test
```

#### For onchain deployment

Add .env file according to .env.example and run following commands:

```shell
npx hardhat run scripts/deployToken.js --network sepolia
npx hardhat run scripts/deployFeeding.js --network sepolia
npx hardhat run scripts/deployStaking.js --network sepolia
```