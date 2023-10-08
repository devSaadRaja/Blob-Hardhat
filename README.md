# Blob

#### This repo includes the following 3 main contracts:
- *BlobToken*
    - 5% buy/sell tax
    - sending tax to tax receivers
    - a threshold to meet for sending tax
    - convert Blob to WETH and then send to tax receivers
- *Feeding*
    - can be fed different tokens from the list (taxed and non-taxed)
    - can have multiple feeding instances with different tokens
    - vesting period of 1 to 7 days
    - custom reward formula (1x - 2x)
    - slippage tolerance
- *Staking*
    - 2 rewards; WETH ad sBlob
    - sBlob not transferable other than to/from Staking
    - can have multiple staking instances
    - WETH rewards after every epoch
    - reinvest and auto-reinvest features

### 

#### Try running the following commands:

```shell
git clone https://github.com/devSaadRaja/Blob-Hardhat.git .
npm install
npx hardhat test
```

#### For onchain deployment

Add .env file according to .env.example and run the following commands:

```shell
npx hardhat run scripts/deployToken.js --network sepolia
npx hardhat run scripts/deployFeeding.js --network sepolia
npx hardhat run scripts/deployStaking.js --network sepolia
```