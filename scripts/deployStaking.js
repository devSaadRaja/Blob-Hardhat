const { deployContract, verify } = require("./functions");

async function main() {
  // REWARD TOKEN ---
  const sBlob = await deployContract("RewardToken", []);
  await sBlob.deployTransaction.wait(5);
  await verify(sBlob.address, []);

  // STAKING ---
  const args = [
    "BLOB.address", // add blob address here according to chain
    sBlob.address,
  ];
  const Staking = await deployContract("Staking", args);
  await Staking.deployTransaction.wait(5);
  await verify(Staking.address, args);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });