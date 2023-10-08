const { expect } = require("chai");
const { moveBlocks } = require("../utils/move-blocks");
const { moveTime } = require("../utils/move-time");

const parseUnits = (eth) => ethers.utils.parseUnits(String(eth), 6);
const parseUnits4 = (eth) => ethers.utils.parseUnits(String(eth), 4);
const parseEth = (eth) => ethers.utils.parseEther(String(eth));
const formatEth = (wei) => Number(ethers.utils.formatEther(String(wei)));

describe("Feeding", function () {
  let owner, user;
  let meme, blob, USDC, feeding, mockUniswapRouter, mockAggregator;
  let feedPoolRewardThreshold, baseGrowthRate, growthRateIncrease;
  let amountIn, vestingTime, feedPoolValue, slippage;

  const SECONDS_IN_A_DAY = 86400;
  var CURRENT_TIME_IN_SECONDS;

  beforeEach(async () => {
    CURRENT_TIME_IN_SECONDS = Math.round(Date.now() / 1000);

    [owner, user, ...addrs] = await ethers.getSigners();

    feedPoolRewardThreshold = 50000;
    growthRateIncrease = 0.001;
    baseGrowthRate = 1.03; // ? only works with values greater than 1

    feedPoolValue = 25365;
    amountIn = 10000;
    vestingTime = 3; // days
    slippage = 4.5;

    const Meme = await ethers.getContractFactory("PEPE");
    meme = await Meme.deploy();
    const Blob = await ethers.getContractFactory("BlobToken");
    blob = await Blob.deploy();
    const USDCToken = await ethers.getContractFactory("USDC");
    USDC = await USDCToken.deploy();

    const MockUniswapRouter = await ethers.getContractFactory(
      "MockUniswapRouter"
    );
    mockUniswapRouter = await MockUniswapRouter.deploy();

    const Feeding = await ethers.getContractFactory("Feeding");
    feeding = await Feeding.deploy(
      parseUnits(feedPoolRewardThreshold),
      parseEth(baseGrowthRate),
      parseEth(growthRateIncrease)
    );

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    mockAggregator = await MockAggregator.deploy(parseEth(0.00002222222));

    await blob.setPriceFeed(mockAggregator.address); // X

    // Mint and approve tokens for user
    await meme.transfer(user.address, parseEth(50000));
    await meme.connect(user).approve(feeding.address, parseEth(50000));

    await blob.connect(owner).updateThreshold(parseUnits(10)); // X
    await blob.connect(owner).setRewardAddress(USDC.address); // X

    await blob.connect(owner).setRouter(mockUniswapRouter.address);

    await blob.connect(owner).addDEXAddress(mockUniswapRouter.address); // pair

    // Add liquidity
    await blob.transfer(mockUniswapRouter.address, parseEth(10000000)); // X
    // await USDC.transfer(mockUniswapRouter.address, parseUnits(10000000)); // X

    await blob.connect(owner).transfer(feeding.address, parseEth(10000000)); // X
    await USDC.connect(owner).transfer(
      feeding.address,
      parseUnits(feedPoolValue)
    ); // X

    await blob.connect(owner).addTaxExempts(feeding.address);
    await blob.connect(owner).addTaxReceiver(feeding.address, parseEth(100));

    await feeding.connect(owner).setRouter(mockUniswapRouter.address);
    await feeding.connect(owner).setRewardAddress(USDC.address);

    // only for testing vvv ................
    await feeding.connect(owner).setBLOB(blob.address); // remove constant BLOB
    // function setBLOB(address blob) external onlyOwner isValidAddress(blob) {
    //     BLOB = blob;
    // }
    // ................ ^^^ ................

    // adding token paths
    await feeding.connect(owner).addFeedToken(meme.address);
    await feeding.connect(owner).setTokenPath([USDC.address, blob.address]);
    await feeding
      .connect(owner)
      .setTokenPath([meme.address, USDC.address, blob.address]);
  });

  it("should withdraw amount", async function () {
    expect(await USDC.balanceOf(feeding.address)).to.be.equal(
      parseUnits(feedPoolValue)
    );
    expect(await USDC.balanceOf(user.address)).to.be.equal(parseEth(0));

    await feeding
      .connect(owner)
      .withdrawFunds(user.address, USDC.address, parseUnits(feedPoolValue));

    expect(await USDC.balanceOf(feeding.address)).to.be.equal(parseEth(0));
    expect(await USDC.balanceOf(user.address)).to.be.equal(
      parseUnits(feedPoolValue)
    );
  });

  it("should calculate rewards", async function () {
    var expectedReward =
      (feedPoolValue / feedPoolRewardThreshold + 1) *
      ((growthRateIncrease * vestingTime + baseGrowthRate) ** vestingTime -
        1) +
      1;

    if (feedPoolValue == 0) expectedReward = 0;
    else if (expectedReward > 2) expectedReward = 2;

    const finalValue = formatEth(
      await feeding.calculateFeedReward(parseEth(vestingTime))
    );
    expect(finalValue.toFixed(4)).to.be.equal(expectedReward.toFixed(4));
  });

  it("should swap tokens", async function () {
    // add swapper instead of USDC in contract
    // Swap tokens
    const tx = await feeding
      .connect(user)
      .feed(
        meme.address,
        parseEth(amountIn),
        parseUnits4(slippage),
        parseEth(vestingTime)
      );

    // Verify that swap happened
    await expect(tx.wait()).to.not.be.reverted;

    // Fetch vesting balance of the user
    const vestingBalance = await feeding.vestingBalances(user.address, 0);

    // Verify that vesting balance was updated correctly
    expect(vestingBalance.amount).to.be.gt(0);
    expect(vestingBalance.vestingTime).to.be.gte(
      CURRENT_TIME_IN_SECONDS + SECONDS_IN_A_DAY * vestingTime
    );
  });

  it("should not allow user to claim tokens before vesting time", async () => {
    // add swapper instead of USDC in contract
    // Swap tokens
    await feeding
      .connect(user)
      .feed(
        meme.address,
        parseEth(amountIn),
        parseUnits4(slippage),
        parseEth(vestingTime)
      );

    await expect(
      feeding.connect(user).claim(blob.address, 0)
    ).to.be.revertedWith("Vesting period not reached");
  });

  it("should allow user to claim tokens after vesting time", async function () {
    // add swapper instead of USDC in contract
    // Swap tokens
    await feeding
      .connect(user)
      .feed(
        meme.address,
        parseEth(amountIn),
        parseUnits4(slippage),
        parseEth(vestingTime)
      );

    // Delay for vesting time plus a little extra to make sure the time has definitely passed
    await moveTime(SECONDS_IN_A_DAY * vestingTime);
    await moveBlocks(1);

    // User claims the tokens
    await feeding.connect(user).claim(blob.address, 0);

    // Get user's final balance
    const finalBalance = await blob.balanceOf(user.address);
    expect(formatEth(finalBalance).toFixed()).to.be.equal("11542");
  });

  it("should not allow swap if contract is not approved to spend tokens", async () => {
    // Reset approval
    await meme.connect(user).approve(feeding.address, 0);

    await expect(
      feeding
        .connect(user)
        .feed(
          meme.address,
          parseEth(amountIn),
          parseUnits4(slippage),
          parseEth(vestingTime)
        )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("should not allow claim if user has not fed yet", async () => {
    await expect(
      feeding.connect(user).claim(blob.address, 0)
    ).to.be.revertedWith("Vesting doesn't exist");
  });

  it("should not allow claim if user has no vesting balance", async () => {
    // add swapper instead of USDC in contract
    // Swap tokens
    await feeding
      .connect(user)
      .feed(
        meme.address,
        parseEth(amountIn),
        parseUnits4(slippage),
        parseEth(vestingTime)
      );

    // Delay for vesting time plus a little extra to make sure the time has definitely passed
    await moveTime(SECONDS_IN_A_DAY * vestingTime);
    await moveBlocks(1);

    await feeding.connect(user).claim(blob.address, 0);
    await expect(
      feeding.connect(user).claim(blob.address, 0)
    ).to.be.revertedWith("Already claimed");
  });

  it("should update balance after claim", async () => {
    // add swapper instead of USDC in contract
    await feeding
      .connect(user)
      .feed(
        meme.address,
        parseEth(amountIn),
        parseUnits4(slippage),
        parseEth(vestingTime)
      );

    expect(await meme.balanceOf(user.address)).to.be.equal(parseEth(40000));
    expect(
      (await feeding.vestingBalances(user.address, 0)).vestingTime
    ).to.be.gte(CURRENT_TIME_IN_SECONDS + SECONDS_IN_A_DAY * vestingTime);

    await moveTime(SECONDS_IN_A_DAY * vestingTime);
    await moveBlocks(1);

    await feeding.connect(user).claim(blob.address, 0);

    expect(await meme.balanceOf(user.address)).to.be.equal(parseEth(40000));
    expect(
      Math.trunc(formatEth(await blob.balanceOf(user.address)))
    ).to.be.equal(11542);
    expect(
      (await feeding.vestingBalances(user.address, 0)).vestingTime
    ).to.be.gte(CURRENT_TIME_IN_SECONDS + SECONDS_IN_A_DAY * vestingTime);
  });
});