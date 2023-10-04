const { expect } = require("chai");
const { moveBlocks } = require("../utils/move-blocks");
const { moveTime } = require("../utils/move-time");

const parseUnits = (eth) => ethers.utils.parseUnits(String(eth), 6);
const parseEth = (eth) => ethers.utils.parseEther(String(eth));
const formatEth = (wei) => Number(ethers.utils.formatEther(String(wei)));

describe("Staking", function () {
  let deployer, treasury, user1, user2, user3, users;
  let blob,
    rewardToken,
    USDC,
    datetime,
    staking,
    mockUniswapRouter,
    totalSupply;

  const SECONDS_IN_A_DAY = 86400;
  const SECONDS_IN_AN_HOUR = 3600;
  var CURRENT_TIME_IN_SECONDS;

  beforeEach(async () => {
    totalSupply = 10_000_000_000;
    CURRENT_TIME_IN_SECONDS = Math.round(Date.now() / 1000);

    [deployer, treasury, user1, user2, user3, ...users] =
      await ethers.getSigners();

    const Blob = await ethers.getContractFactory("BlobToken");
    blob = await Blob.deploy();
    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy();
    const USDCToken = await ethers.getContractFactory("USDC");
    USDC = await USDCToken.deploy();
    const MockUniswapRouter = await ethers.getContractFactory(
      "MockUniswapRouter"
    );
    mockUniswapRouter = await MockUniswapRouter.deploy();
    const Datetime = await ethers.getContractFactory("DateTime");
    datetime = await Datetime.deploy();
    const Staking = await ethers.getContractFactory("Staking");
    staking = await Staking.deploy(blob.address, rewardToken.address);

    await rewardToken
      .connect(deployer)
      .initialize(staking.address);

    await staking.connect(deployer).setSwapper(USDC.address);
    await staking.connect(deployer).setRewardAddress(USDC.address);
    await staking.connect(deployer).setRouter(mockUniswapRouter.address);

    await blob.connect(deployer).transfer(user1.address, parseEth(1000000));
    await blob.connect(deployer).transfer(user2.address, parseEth(1000000));
    await blob.connect(deployer).transfer(user3.address, parseEth(1000000));
    await blob.connect(user1).approve(staking.address, parseEth(1000000));
    await blob.connect(user2).approve(staking.address, parseEth(1000000));
    await blob.connect(user3).approve(staking.address, parseEth(1000000));

    await blob.connect(deployer).addTaxReceiver(treasury.address, 100); // X

    await USDC.connect(deployer).transfer(
      treasury.address,
      parseUnits(1000000)
    ); // X

    await blob
      .connect(deployer)
      .transfer(mockUniswapRouter.address, parseEth(100000000)); // X

    // await blob.connect(deployer).addDEXAddress(pair.address);
    await blob.connect(deployer).addTaxExempts(staking.address);

    await staking.connect(deployer).setDatetime(datetime.address); // from mainnet deployment

    await staking.connect(deployer).setAutoReinvestThreshold(parseUnits(50));

    await USDC.connect(treasury).approve(staking.address, parseUnits(1000000));
    await staking.connect(treasury).deposit(parseUnits(1000000));

    await staking.connect(deployer).initialize();
  });

  it("should correctly constructs token", async () => {
    expect(await blob.name()).to.equal("Blob");
    expect(await blob.symbol()).to.equal("BLOB");
    expect(await blob.decimals()).to.equal(18);
    expect(await blob.totalSupply()).to.equal(parseEth(totalSupply));
  });

  it("should correctly constructs staking reward token", async () => {
    expect(await rewardToken.name()).to.equal("Reward Token");
    expect(await rewardToken.symbol()).to.equal("sBlob");
    expect(await rewardToken.decimals()).to.equal(18);
  });

  it("should correctly constructs staking contract", async () => {
    const amountPerEpoch = parseUnits((1000000 / 366).toFixed(6));
    expect(await staking.BLOB()).to.equal(blob.address);
    expect(await staking.SBLOB()).to.equal(rewardToken.address);
    expect(await staking.amountPerEpoch()).to.equal(amountPerEpoch);
    expect((await staking.getEpochDetails(1)).staked).to.equal(0);
    expect((await staking.getEpochDetails(1)).duration).to.equal(
      SECONDS_IN_AN_HOUR * 4
    );
    expect((await staking.getEpochDetails(1)).end).to.be.gte(
      CURRENT_TIME_IN_SECONDS + SECONDS_IN_AN_HOUR * 4
    );
    expect((await staking.getEpochDetails(1)).distribute).to.equal(
      amountPerEpoch
    );
  });

  it("should update warmup period", async function () {
    expect(await staking.warmupPeriod()).to.be.equal(SECONDS_IN_A_DAY * 4);
    await expect(staking.connect(user1).setWarmupPeriod(1)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await expect(staking.connect(deployer).setWarmupPeriod(1)).to.be.reverted;
    await staking.connect(deployer).setWarmupPeriod(SECONDS_IN_A_DAY * 3);
    expect(await staking.warmupPeriod()).to.be.equal(SECONDS_IN_A_DAY * 3);
  });

  it("should update epoch duration", async function () {
    expect(await staking.epochDuration()).to.be.equal(SECONDS_IN_AN_HOUR * 4);
    await expect(staking.connect(user1).setEpochDuration(1)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await expect(
      staking.connect(deployer).setEpochDuration(SECONDS_IN_A_DAY * 5)
    ).to.be.reverted;
    await staking.connect(deployer).setEpochDuration(SECONDS_IN_AN_HOUR * 3);
    expect(await staking.epochDuration()).to.be.equal(SECONDS_IN_AN_HOUR * 3);
  });

  it("should update balances after stake", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user2).stake(parseEth(500));

    expect(await blob.balanceOf(staking.address)).to.be.equal(parseEth(2000));
    expect(await rewardToken.balanceOf(user1.address)).to.be.equal(
      parseEth(1500)
    );

    expect(await staking.totalStaked()).to.be.equal(parseEth(2000));
    expect(await staking.totalStakesByUser(user1.address)).to.be.equal(
      parseEth(1500)
    );
    expect(await staking.totalStakesByUser(user2.address)).to.be.equal(
      parseEth(500)
    );

    expect((await staking.stakes(user1.address, 0)).balance).to.be.equal(
      parseEth(1000)
    );
    expect((await staking.stakes(user1.address, 1)).balance).to.be.equal(
      parseEth(500)
    );
    expect((await staking.stakes(user1.address, 0)).epochNumber).to.be.equal(1);
    expect((await staking.stakes(user1.address, 1)).epochNumber).to.be.equal(1);
    expect((await staking.stakes(user1.address, 0)).start).to.be.gte(
      CURRENT_TIME_IN_SECONDS
    );
    expect((await staking.stakes(user1.address, 0)).expiry).to.be.gte(
      CURRENT_TIME_IN_SECONDS + SECONDS_IN_A_DAY * 4
    );
    expect((await staking.stakes(user2.address, 0)).expiry).to.be.gte(
      CURRENT_TIME_IN_SECONDS + SECONDS_IN_A_DAY * 4
    );
  });

  it("should not let transfer reward tokens other than to/from staking", async function () {
    // staking
    await staking.connect(user1).stake(parseEth(1000));

    // transfer to other user
    await expect(
      rewardToken.connect(user1).transfer(user2.address, parseEth(50))
    ).to.be.revertedWith("Can't transfer sBlob");
    expect(await rewardToken.balanceOf(user2.address)).to.be.equal(0);

    // transfer to staking
    await rewardToken.connect(user1).transfer(staking.address, parseEth(1000));
    expect(await rewardToken.balanceOf(user1.address)).to.be.equal(0);
    expect(await rewardToken.balanceOf(staking.address)).to.be.equal(
      parseEth(10000000000)
    );
  });

  it("should revert if unstaking more than staked", async function () {
    await staking.connect(user1).stake(parseEth(1000));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1000));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.connect(user1)["unstake(uint256)"](parseEth(500));

    await expect(
      staking.connect(user1)["unstake(uint256,uint256)"](parseEth(600), 0)
    ).to.be.revertedWith("Invalid amount");
  });

  it("should update balances after unstake some tokens", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user1).stake(parseEth(500));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1500));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.connect(user1)["unstake(uint256)"](parseEth(500));
    await staking.connect(user1)["unstake(uint256)"](parseEth(250));
    await staking.connect(user1)["unstake(uint256)"](parseEth(500));

    expect(await staking.totalStaked()).to.equal(parseEth(250));
    expect(await staking.totalStakesByUser(user1.address)).to.equal(
      parseEth(250)
    );
    expect(await blob.balanceOf(staking.address)).to.be.equal(parseEth(250));
    expect(await blob.balanceOf(user1.address)).to.be.equal(parseEth(999750));
    expect(await rewardToken.balanceOf(user1.address)).to.be.equal(
      parseEth(250)
    );
    expect((await staking.stakes(user1.address, 0)).balance).to.be.equal(
      parseEth(250)
    );

    await staking.connect(user1).unstakeAll();

    /// ----------------------------------

    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user1).stake(parseEth(500));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1500));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.connect(user1)["unstake(uint256,uint256)"](parseEth(500), 0);
    await staking.connect(user1)["unstake(uint256,uint256)"](parseEth(250), 1);

    expect(await staking.totalStaked()).to.equal(parseEth(750));
    expect(await staking.totalStakesByUser(user1.address)).to.equal(
      parseEth(750)
    );
    expect(await blob.balanceOf(staking.address)).to.be.equal(parseEth(750));
    expect(await blob.balanceOf(user1.address)).to.be.equal(parseEth(999250));
    expect(await rewardToken.balanceOf(user1.address)).to.be.equal(
      parseEth(750)
    );
    expect((await staking.stakes(user1.address, 0)).balance).to.be.equal(
      parseEth(500)
    );
    expect((await staking.stakes(user1.address, 1)).balance).to.be.equal(
      parseEth(250)
    );
  });

  it("should remove stake position after unstake", async function () {
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(515));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1015));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      2
    );

    await staking.connect(user1)["unstake(uint256,uint256)"](parseEth(250), 0);
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      2
    );

    await staking.connect(user1)["unstake(uint256,uint256)"](parseEth(250), 0);
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      1
    );

    await staking.connect(user1)["unstake(uint256,uint256)"](parseEth(515), 0);
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      0
    );

    /////////////////////////////////////////////////////////////////////////////

    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(515));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1015));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      2
    );
    await staking.connect(user1)["unstake(uint256)"](parseEth(250));
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      2
    );
    await staking.connect(user1)["unstake(uint256)"](parseEth(255));
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      1
    );
  });

  it("should update balances after unstake all tokens", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user2).stake(parseEth(500));

    await rewardToken.connect(user1).approve(staking.address, parseEth(1500));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    // await staking.connect(user1).claimAll();
    await staking.connect(user1).unstakeAll();
    expect(await staking.totalStaked()).to.equal(parseEth(500));
    expect(await staking.totalStakesByUser(user1.address)).to.equal(
      parseEth(0)
    );
    expect(await staking.totalStakesByUser(user2.address)).to.equal(
      parseEth(500)
    );

    expect(await blob.balanceOf(staking.address)).to.be.equal(parseEth(500));
    expect(await blob.balanceOf(user1.address)).to.be.equal(parseEth(1000000));
    expect(await rewardToken.balanceOf(user1.address)).to.be.equal(parseEth(0));
    expect((await staking.getStakeDetails(user1.address)).length).to.be.equal(
      0
    );
  });

  it("should not let claim before warmup period ends", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await expect(staking.connect(user1).claimReward(0)).to.be.revertedWith(
      "Warmup Period not Ended!"
    );
  });

  it("should update values after claim rewards", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user2).stake(parseEth(500));
    await staking.connect(user3).stake(parseEth(500));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    await staking.connect(user1).claimReward(0);
    expect(await USDC.balanceOf(user1.address)) // user 1 rewards
      .to.be.equal(1366120000);
    expect(await staking.totalRewardsPaid()).to.be.equal(1366120000);

    await staking.connect(user2).claimReward(0);
    expect(await USDC.balanceOf(user2.address)) // user 2 rewards
      .to.be.equal(683060000);
    expect(await staking.totalRewardsPaid()).to.be.equal(2049180000);

    await staking.connect(user3).claimReward(0);
    expect(await USDC.balanceOf(user3.address)) // user 3 rewards
      .to.be.equal(683060000);
    expect(await staking.totalRewardsPaid()).to.be.equal(2732240000);
  });

  it("should update values after claimAll rewards", async function () {
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user2).stake(parseEth(250));
    await staking.connect(user2).stake(parseEth(250));
    await staking.connect(user3).stake(parseEth(250));
    await staking.connect(user3).stake(parseEth(250));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    await staking.connect(user1).claimAll();
    expect(await USDC.balanceOf(user1.address)) // user 1 rewards
      .to.be.equal(1366120000);
    expect(await staking.totalRewardsPaid()).to.be.equal(1366120000);

    await staking.connect(user2).claimAll();
    expect(await USDC.balanceOf(user2.address)) // user 2 rewards
      .to.be.equal(683060000);
    expect(await staking.totalRewardsPaid()).to.be.equal(2049180000);

    await staking.connect(user3).claimAll();
    expect(await USDC.balanceOf(user3.address)) // user 3 rewards
      .to.be.equal(683060000);
    expect(await staking.totalRewardsPaid()).to.be.equal(2732240000);
  });

  it("should update values after reinvest", async function () {
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(500));
    await staking.connect(user1).stake(parseEth(500));

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    await staking.connect(user1).reinvest();

    const user1Stakes = (await staking.getStakeDetails(user1.address)).length;
    expect(user1Stakes).to.be.equal(5);

    expect(formatEth(await staking.totalStaked())).to.be.equal(4732.24);
    expect(await staking.totalRewardsPaid()).to.be.equal(parseUnits(2732.24));
  });

  it("test eligible users", async function () {
    // await staking.connect(user1).stake(parseEth(500));
    // await staking.connect(user2).stake(parseEth(500));
    // await staking.connect(user3).stake(parseEth(1000));

    // await staking.connect(user1).subscribeAutoReinvest();
    // await staking.connect(user2).subscribeAutoReinvest();
    // await staking.connect(user3).subscribeAutoReinvest();

    for (let i = 0; i < users.length; i++) {
      await blob.connect(deployer).transfer(users[i].address, parseEth(500));
      await blob.connect(users[i]).approve(staking.address, parseEth(500));
      await staking.connect(users[i]).stake(parseEth(500));
      await staking.connect(users[i]).subscribeAutoReinvest();
      console.log(users[i].address);
    }

    await moveTime(SECONDS_IN_A_DAY * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    console.log(await staking.getTotalPages()); // 3 : 0-2
    console.log(await staking.getEligibleUsers(2));
  });

  // it("test eligible users", async function () {
  //   for (let i = 0; i < users.length; i++) {
  //     await blob.connect(deployer).transfer(users[i].address, parseEth(500));
  //     await blob.connect(users[i]).approve(staking.address, parseEth(500));
  //     await staking.connect(users[i]).stake(parseEth(500));
  //     await staking.connect(users[i]).subscribeAutoReinvest();
  //   }
  //   await moveTime(SECONDS_IN_A_DAY * 4);
  //   await moveBlocks(1);

  //   await staking.startNextEpoch();

  //   const totalPages = await staking.getTotalPages();
  //   for (let i = 1; i < totalPages; i++) {
  //     const rewards = [];
  //     const [eligible_users, balances] = await staking.getEligibleUsers(i);

  //     let totalRewards = 0;
  //     for (let j = 0; j < balances.length; j++) {
  //       totalRewards += balances[j];
  //     }

  //     await staking
  //       .connect(deployer)
  //       .swap(USDC.address, blob.address, totalRewards, 0);
  //   }

  //   // await blob.connect(deployer).updateReinvestStakes(user_addresses);
  // });

  // it("should update values after auto-reinvest", async function () {
  //   await staking.connect(user1).stake(parseEth(500));
  //   await staking.connect(user1).stake(parseEth(500));
  //   await staking.connect(user2).stake(parseEth(500));
  //   await staking.connect(user2).stake(parseEth(500));

  //   await staking.connect(user1).subscribeAutoReinvest();
  //   await staking.connect(user2).subscribeAutoReinvest();

  //   await moveTime(SECONDS_IN_A_DAY * 4);
  //   await moveBlocks(1);

  //   await staking.startNextEpoch();

  //   const user1Stakes = (await staking.getStakeDetails(user1.address)).length;
  //   expect(user1Stakes).to.be.equal(3);
  //   const user2Stakes = (await staking.getStakeDetails(user2.address)).length;
  //   expect(user2Stakes).to.be.equal(3);

  //   expect(await staking.totalStaked()).to.be.equal(parseEth(4732.24));
  //   expect(await staking.totalRewardsPaid()).to.be.equal(parseUnits(2732.24));
  // });

  // it.only("max unstake gasfee test", async function () {
  //   let totalStaked = 0;
  //   for (let i = 0; i < 50; i++) {
  //     await staking.connect(user1).stake(parseEth(500));
  //     totalStaked += 500;
  //   }

  //   for (let two_months = 0; two_months < 6; two_months++) {
  //     for (let i = 0; i < 365; i++) {
  //       await moveTime(SECONDS_IN_AN_HOUR * 4);
  //       await moveBlocks(1);

  //       await staking.startNextEpoch();
  //     }

  //     await USDC.connect(deployer).transfer(
  //       treasury.address,
  //       parseUnits(1000000)
  //     );
  //     await USDC.connect(treasury).approve(
  //       staking.address,
  //       parseUnits(1000000)
  //     );
  //     await staking.connect(treasury).deposit(parseUnits(1000000));
  //   }

  //   await rewardToken
  //     .connect(user1)
  //     .approve(staking.address, parseEth(totalStaked));

  //   await staking.connect(user1).unstakeAll();
  // });

  // it("max reinvest gasfee test", async function () {
  //   for (let i = 0; i < 50; i++) {
  //     await staking.connect(user1).stake(parseEth(500));
  //   }

  //   for (let two_months = 0; two_months < 12; two_months++) {
  //     for (let i = 0; i < 365; i++) {
  //       await moveTime(SECONDS_IN_AN_HOUR * 4);
  //       await moveBlocks(1);

  //       await staking.startNextEpoch();
  //     }

  //     await USDC.connect(deployer).transfer(
  //       treasury.address,
  //       parseUnits(1000000)
  //     );
  //     await USDC.connect(treasury).approve(
  //       staking.address,
  //       parseUnits(1000000)
  //     );
  //     await staking.connect(treasury).deposit(parseUnits(1000000));
  //   }

  //   console.log((await staking.getStakeDetails(user1.address)).length);
  //   console.log(await staking.getClaimable(user1.address));

  //   await staking.connect(user1).reinvest();

  //   console.log((await staking.getStakeDetails(user1.address)).length);
  //   console.log(await staking.getClaimable(user1.address));
  // });

  // it("max auto-reinvest gasfee test", async function () {
  //   for (let i = 0; i < users.length; i++) {
  //     await blob
  //       .connect(deployer)
  //       .transfer(users[i].address, parseEth(1000000));
  //     await blob.connect(users[i]).approve(staking.address, parseEth(1000000));
  //     await staking.connect(users[i]).subscribeAutoReinvest();

  //     for (let j = 0; j < 26; j++) {
  //       await staking.connect(users[i]).stake(parseEth(500));
  //     }
  //   }

  //   // for (let two_months = 0; two_months < 3; two_months++) {
  //   for (let i = 0; i < 100; i++) {
  //     // 365
  //     await moveTime(SECONDS_IN_AN_HOUR * 4);
  //     await moveBlocks(1);

  //     await staking.startNextEpoch();

  //     // 9119877

  //     //   await USDC.connect(deployer).transfer(
  //     //     treasury.address,
  //     //     parseUnits(1000000)
  //     //   );
  //     //   await USDC.connect(treasury).approve(
  //     //     staking.address,
  //     //     parseUnits(1000000)
  //     //   );
  //     //   await staking.connect(treasury).deposit(parseUnits(1000000));
  //   }
  //   // }
  // });

  // it("should not let claim if no claimable", async function () {
  //   await staking.connect(user1).stake(parseEth(1000));

  //   await moveTime(SECONDS_IN_A_DAY * 4);
  //   await moveBlocks(1);

  //   await staking.startNextEpoch();

  //   await staking.connect(user1).claimReward(0);
  //   await expect(staking.connect(user1).claimReward(0)).to.be.revertedWith(
  //     "Nothing to claim."
  //   );
  // });

  it("should start next epoch and update values accordingly", async function () {
    await staking.connect(user1).stake(parseEth(1000));
    await staking.connect(user2).stake(parseEth(1000));

    await moveTime(SECONDS_IN_AN_HOUR * 4);
    await moveBlocks(1);

    await staking.startNextEpoch();

    expect(await blob.balanceOf(staking.address)).to.be.equal(parseEth(2000));
    expect((await staking.getEpochDetails(1)).staked).to.equal(parseEth(2000));
    expect((await staking.getEpochDetails(1)).distribute).to.equal(
      parseUnits(2732.240437)
    );

    expect(await staking.currentEpoch()).to.be.equal(2);
    expect((await staking.getEpochDetails(2)).staked).to.equal(0);
    expect((await staking.getEpochDetails(2)).duration).to.equal(
      SECONDS_IN_AN_HOUR * 4
    );
    expect((await staking.getEpochDetails(2)).end).to.be.gte(
      CURRENT_TIME_IN_SECONDS + SECONDS_IN_AN_HOUR * 8
    );
    expect((await staking.getEpochDetails(2)).distribute).to.equal(
      parseUnits(2732.240437)
    );
  });

  it("should update values on 1st of every month", async function () {
    // // run individually - .only
    // await staking.connect(user1).stake(parseEth(1000));
    // await staking.startNextEpoch();
    // await moveTime(SECONDS_IN_AN_HOUR * 4);
    // await moveBlocks(1);
    // await staking.startNextEpoch();
    // await USDC.connect(deployer).transfer(treasury.address, parseUnits(1000000));
    // await USDC.connect(treasury).approve(staking.address, parseUnits(1000000));
    // await staking.connect(treasury).deposit(parseUnits(1000000));
    // await moveTime(SECONDS_IN_A_DAY * 17); // set number according to your current date
    // await moveBlocks(1);
    // await staking.startNextEpoch();
    // expect(await USDC.balanceOf(treasury.address)).to.be.equal(parseEth(0));
    // expect((await staking.getEpochDetails(1)).staked).to.equal(parseEth(1000));
    // expect((await staking.getEpochDetails(2)).staked).to.equal(parseEth(1000));
    // expect((await staking.getEpochDetails(3)).staked).to.equal(parseEth(0));
    // expect((await staking.getEpochDetails(1)).distribute).to.gte(
    //   parseUnits(2732.240437)
    // );
    // expect((await staking.getEpochDetails(2)).distribute).to.gte(
    //   parseUnits(2732.240437)
    // );
    // expect((await staking.getEpochDetails(3)).distribute).to.gte(
    //   parseUnits(5449.550598)
    // );
  });
});