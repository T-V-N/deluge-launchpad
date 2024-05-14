import { expect, assert } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";
import { Sale } from "../typechain-types";
import { ERC20Token } from "../typechain-types";
import { SaleContractFactory } from "../typechain-types/contracts/Factory.sol";
import { params } from "../utils/common";
import { ReferralContract } from "../typechain-types";
import { ReferralModule__factory } from "../typechain-types";
import { customError } from "./utils/saleErrors";


const eth1 = hre.ethers.parseEther("1")

async function getBlockTime() {
  const blockNum = await hre.ethers.provider.getBlockNumber();
  const block = await hre.ethers.provider.getBlock(blockNum);
  const ts = block?.timestamp || (Date.now() / 1000)

  return ts
}

describe("USDT Launch tests", async function () {
  let deployer: ethers.Signer, saler: ethers.Signer, depositor1: ethers.Signer, depositor2: ethers.Signer, depositor3: ethers.Signer;
  let refContract: ReferralContract, moduleFactory: ReferralModule__factory, sale: Sale, factory: SaleContractFactory, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token, saleToken: ERC20Token, locker: any;
  let ts: number;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3] = await hre.ethers.getSigners();

    const lockerF = await hre.ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");


    const referralFactory = await hre.ethers.getContractFactory("ReferralContract")
    refContract = await referralFactory.deploy(usdt.getAddress(), usdc.getAddress(), dai.getAddress(), 100, params.treasury);
    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");

    await usdt.transfer(await depositor1.getAddress(), hre.ethers.parseEther("10000"));
    await usdt.transfer(await depositor2.getAddress(), hre.ethers.parseEther("10000"));
    await usdt.transfer(await depositor3.getAddress(), hre.ethers.parseEther("10000"));

    const launchF = await hre.ethers.getContractFactory("SaleContractFactory", deployer);
    factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury)

    await factory.connect(saler).createSaleContract(await saleToken.getAddress(), await usdt.getAddress(), false, [], { value: params.fee });

    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    sale = await hre.ethers.getContractAt("Sale", saleAddress)
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdt.connect(depositor1).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdt.connect(depositor2).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdt.connect(depositor3).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();
  });

  it("Native buy should revert", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      params.salePrice,
      params.liqPrice,
      params.soft,
      params.hard,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale actives after init");

    await expect(sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n })).to.be.revertedWithCustomError(sale, customError.cantAcceptNative);
  });

  it("should revert unaproved buy", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      params.salePrice,
      params.liqPrice,
      params.soft,
      params.hard,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    await usdt.connect(depositor1).approve(await sale.getAddress(), 0)

    await expect(sale.connect(depositor1).buyTokensWithERC20(2000, ""))
      .to.be.revertedWithCustomError;
  });

  it("Successfull usdt + token sale happy path", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      params.salePrice,
      params.liqPrice,
      params.soft,
      params.hard,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");


    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("should send USDT fee to the treasury on token sale", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      params.salePrice,
      params.liqPrice,
      params.soft,
      params.hard,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    const treasuryInitialBalance = await usdt.balanceOf(params.treasury);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);

    const newTreasuryEthBalance = await usdt.balanceOf(params.treasury);
    const raised = (await sale.totalRaised()) * params.raiseFee / 100n

    await expect(newTreasuryEthBalance).to.equal(treasuryInitialBalance + raised, "Treasury should receive the fee");
  });

  it("should allow token purchases when sale is active", async function () {
    const purchaseAmount = 1_000n;
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 100, 100, 100, 2000, 10, 1000, 3600 * 24 * 30, refModule.getAddress());


    await expect(sale.connect(depositor1).buyTokensWithERC20(purchaseAmount, "")).to.changeTokenBalance(usdt, depositor1, -purchaseAmount);
    await expect(sale.connect(depositor1).buyTokensWithERC20(purchaseAmount, "")).to.changeTokenBalance(usdt, sale, purchaseAmount);

    await expect(await sale.totalRaised()).to.equal(purchaseAmount * 2n);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(purchaseAmount * 2n);
  });

  it("should reject purchases below the minimum amount", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const minPurchase = hre.ethers.parseEther("0.01")

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(startTime, endTime, 50, eth1, eth1, 500, 1000, minPurchase, minPurchase * 10n, 3600 * 24 * 30, refModule.getAddress());

    await expect(sale.connect(depositor1).buyTokensWithERC20(hre.ethers.parseEther("0.001"), "")).to.be.revertedWithCustomError(sale, customError.paymentOutsideMinMaxAmounts);
  });

  it("should not allow purchases after sale has ended", async function () {
    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(ts - 3600, ts + 3600, 50, eth1, eth1, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress());
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 2 hours forward
    await hre.ethers.provider.send("evm_mine");

    await expect(sale.connect(depositor1).buyTokensWithERC20(10, "")).to.be.revertedWithCustomError(sale, customError.outsideSaleTime);
  });


  it("should handle refunds correctly when the soft cap is not reached", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(ts, ts + 7200, 50, eth1, eth1, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress());
    const depositAmount = 100;
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    // Fast forward past end time without reaching soft cap
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    await expect(sale.connect(depositor1).refund()).to.changeTokenBalance(usdt, depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

  it("should allow claiming of tokens after the sale is finalized", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;

    const halfEth = hre.ethers.parseEther("0.5")
    const oneEth = hre.ethers.parseEther("1")
    const price = 1000n;

    const depositAmount = halfEth;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    // Setting up the sale and transferring tokens for distribution

    await sale.connect(saler).initializeSale(startTime, endTime, 50, price, 1200, halfEth, oneEth, halfEth, oneEth, 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");
    await sale.connect(depositor2).buyTokensWithERC20(depositAmount, "");


    // Finalizing the sale successfully
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 2 hours forward
    await hre.ethers.provider.send("evm_mine");

    //pre lock
    // 1 eth, price = 1000, 1000 tokens for sale
    // 50% liquidity, 1200 price for liquidity, 8% sale fee => 552 tokens to load into lp
    // total 1552
    await expect(await saleToken.balanceOf(sale)).to.be.equal(hre.ethers.parseEther("1552"))

    await sale.connect(saler).finalizeSale({ value: 150 });

    //post lock 552 tokens to liquidity
    await expect(await saleToken.balanceOf(sale)).to.be.equal(hre.ethers.parseEther("1000"))


    // Claiming tokens
    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(saleToken, depositor1, depositAmount * price);
    await expect(sale.connect(depositor2).claim()).to.changeTokenBalance(saleToken, depositor2, depositAmount * price);
    await expect(await saleToken.balanceOf(sale)).to.be.equal(0)
  });


  it("should prevent unauthorized users from initializing the sale", async function () {
    const startTime = ts - 100;
    const endTime = startTime + 10;

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    // Attempt to initialize the sale from a non-owner account
    await expect(sale.connect(depositor1).initializeSale(startTime, endTime, 50, 100, 200, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress())).to.be.reverted;
  });


  it("should correctly calculate raised amount and refund excess if purchase exceeds hard cap", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;
    const depositAmount = ethers.parseEther("500"); // close to hard cap
    const excessAmount = ethers.parseEther("100");

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, depositAmount, depositAmount, ethers.parseEther("10"), ethers.parseEther("500"), 3600 * 24 * 30, refModule.getAddress());

    // First, fill up close to the hard cap
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    // Attempt to exceed hard cap
    await expect(sale.connect(depositor3).buyTokensWithERC20(excessAmount, "")).to.be.revertedWithCustomError(sale, customError.saleGoalReached);
  });


  it("should reject token claims before sale finalization", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;
    const depositAmount = hre.ethers.parseEther("100");

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, hre.ethers.parseEther("100"), hre.ethers.parseEther("200"), hre.ethers.parseEther("100"), hre.ethers.parseEther("200"), 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    await expect(sale.connect(depositor1).claim()).to.be.revertedWithCustomError(sale, customError.notFinished);
  });

  it("should prevent refunding to non-contributors and double refunding", async function () {
    const startTime = ts;
    const endTime = startTime + 3600;
    const depositAmount = hre.ethers.parseEther("1");

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000")
    await refModule.init(sale);

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, hre.ethers.parseEther("2"), hre.ethers.parseEther("10"), hre.ethers.parseEther("1"), hre.ethers.parseEther("2"), 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    // Move past the end time without reaching the soft cap
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 2 hours forward
    await hre.ethers.provider.send("evm_mine");

    await sale.connect(depositor1).refund();

    // Attempt to refund to non-contributor or double refund
    await expect(sale.connect(depositor1).refund()).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
    await expect(sale.connect(depositor2).refund()).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
  });
});

