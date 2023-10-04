const { deployContract, verify } = require("./functions");

async function main() {
  const args = [parseEth(50000), parseEth(1.03), parseEth(0.001)];

  const Feeding = await deployContract("Feeding", args);
  await Feeding.deployTransaction.wait(5);

  await verify(Feeding.address, args);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });