const { deployContract, verify } = require("./functions");

async function main() {
  const Blob = await deployContract("BlobToken", []);
  await Blob.deployTransaction.wait(5);

  await verify(Blob.address, []);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });