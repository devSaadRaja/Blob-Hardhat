const { expect } = require("chai");

const parseUnits = (eth) => ethers.utils.parseUnits(String(eth), 6);
const parseEth = (eth) => ethers.utils.parseEther(String(eth));

describe("BlobToken", function () {
  let owner, addr1, addr2, pair, taxReceiver, totalSupply;
  let blob, USDC, mockUniswapRouter, mockAggregator;

  beforeEach(async () => {
    totalSupply = 10_000_000_000;

    [owner, addr1, addr2, pair, taxReceiver] = await ethers.getSigners();

    const Blob = await ethers.getContractFactory("BlobToken");
    blob = await Blob.deploy();

    const USDCToken = await ethers.getContractFactory("USDC");
    USDC = await USDCToken.deploy();

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    mockAggregator = await MockAggregator.deploy(parseEth(0.00002));

    // address private constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D; // Uniswap V2 Router address
    const MockUniswapRouter = await ethers.getContractFactory(
      "MockUniswapRouter"
    );
    mockUniswapRouter = await MockUniswapRouter.deploy();

    // add liquidity
    await USDC.connect(owner).transfer(
      mockUniswapRouter.address,
      parseUnits(50000000)
    ); // X

    await blob.connect(owner).updateThreshold(parseUnits(10)); // X
    await blob.connect(owner).setRewardAddress(USDC.address); // X

    await blob.connect(owner).setRouter(mockUniswapRouter.address);

    await blob.connect(owner).addDEXAddress(pair.address);
    await blob.connect(owner).addDEXAddress(mockUniswapRouter.address); //

    // await blob.connect(owner).addTaxExempts(blob.address);
    // await blob.connect(owner).addTaxExempts(staking.address);
    // await blob.connect(owner).addTaxExempts(feeding.address);

    await blob
      .connect(owner)
      .addTaxReceiver(taxReceiver.address, parseEth(100));

    await blob.connect(owner).setPriceFeed(mockAggregator.address);

    await blob.connect(owner).setDeploy(true);
  });

  describe("Deployment", () => {
    it("Correctly constructs an ERC20", async () => {
      expect(await blob.name()).to.equal("Blob");
      expect(await blob.symbol()).to.equal("BLOB");
      expect(await blob.decimals()).to.equal(18);
      expect(await blob.totalSupply()).to.equal(parseEth(totalSupply));
    });
  });

  describe("Tax", () => {
    it("Only owner should update tax", async () => {
      await expect(
        blob.connect(addr1).updateTax(parseEth(5))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Tax should not be greater than 10 %", async () => {
      await expect(
        blob.connect(owner).updateTax(parseEth(11))
      ).to.be.revertedWith("Tax should not be greater than 10 %");
    });

    it("Update Tax", async () => {
      await blob.connect(owner).updateTax(parseEth(6));
      expect(await blob.connect(owner).tax()).to.be.equal(parseEth(6));
    });

    it("Should be reverted with Total tax percentage should be 100", async () => {
      await blob
        .connect(owner)
        .updateReceiverTax(taxReceiver.address, parseEth(50));
      await blob.connect(owner).transfer(addr1.address, parseEth(100000000));
      await blob.connect(addr1).transfer(pair.address, parseEth(50000000));
      await expect(
        blob.connect(addr1).transfer(addr2.address, parseEth(50000000))
      ).to.be.revertedWith("Total tax percentage should be 100");
    });

    it("Add and Remove Tax Receivers", async () => {
      expect(
        (await blob.connect(owner).getAllTaxReceivers()).length
      ).to.be.equal(1);
      await blob.connect(owner).removeTaxReceiver(0);
      expect(
        (await blob.connect(owner).getAllTaxReceivers()).length
      ).to.be.equal(0);
    });

    it("Update Tax Receivers", async () => {
      expect(await blob.taxPercentages(taxReceiver.address)).to.be.equal(
        parseEth(100)
      );
      await blob
        .connect(owner)
        .updateReceiverTax(taxReceiver.address, parseEth(40));
      expect(await blob.taxPercentages(taxReceiver.address)).to.be.equal(
        parseEth(40)
      );
    });
  });

  describe("Set pairs + Transfer tokens", () => {
    let taxPercentage = 5 / 100;

    it("Only owner should add pair/pool", async () => {
      await expect(
        blob.connect(addr1).addDEXAddress(pair.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Simple transfer, no tax deduction", async () => {
      expect(await blob.balanceOf(owner.address)).to.equal(
        parseEth(totalSupply)
      );

      await blob.connect(owner).addTaxExempts(addr1.address);

      await blob.connect(owner).transfer(addr1.address, parseEth(50000));
      await blob.connect(addr1).transfer(pair.address, parseEth(50000));

      expect(await blob.balanceOf(addr1.address)).to.equal(0);
      expect(await blob.balanceOf(owner.address)).to.equal(
        parseEth(totalSupply - 50000)
      );
    });

    it("Transfer tokens, tax deduction, reduces supply and wallet balances", async () => {
      expect(await blob.balanceOf(owner.address)).to.equal(
        parseEth(totalSupply)
      );

      await blob.connect(owner).transfer(addr1.address, parseEth(60000000));
      await blob.connect(addr1).transfer(pair.address, parseEth(50000000));

      expect(await blob.balanceOf(addr1.address)).to.equal(parseEth(10000000));
      expect(await blob.balanceOf(pair.address)).to.equal(
        parseEth(50000000 - 50000000 * taxPercentage)
      );

      await blob.connect(addr1).transfer(addr2.address, parseEth(10));

      expect(await USDC.balanceOf(taxReceiver.address)).to.equal(
        parseUnits(50000000 * taxPercentage)
      );
      expect(await USDC.balanceOf(mockUniswapRouter.address)).to.equal(
        parseUnits(50000000 - 50000000 * taxPercentage)
      );
    });
  });
});