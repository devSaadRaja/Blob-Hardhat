const { network } = require("hardhat")

async function moveTime(amount) {
  console.log("----------------");
  console.log("Moving seconds...");
  await network.provider.send("evm_increaseTime", [amount]);
  console.log(`Moved forward in time ${amount} seconds`);
  console.log("----------------");
}

module.exports = { moveTime }