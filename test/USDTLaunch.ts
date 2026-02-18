import { expect, assert } from "chai";
import hre from "hardhat";
import { ethers as ethersLib } from "ethers";
import { Sale, ERC20Token, SaleContractFactory } from "../typechain-types/index.js";
import {
  ReferralContract,
  ReferralContract__factory,
  ReferralModuleRefundable__factory,
} from "../lib/deluge-referral/typechain-types/index.js";
import { params } from "../utils/common.js";
import { customError } from "./utils/saleErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { UniswapV2Deployer } from "./utils/Uniswap.js";

const { ethers, networkHelpers } = await hre.network.connect();

const eth1 = ethers.parseEther("1");

describe("USDT Launch tests", async function () {
  let deployer: HardhatEthersSigner, saler: HardhatEthersSigner, depositor1: HardhatEthersSigner, depositor2: HardhatEthersSigner, depositor3: HardhatEthersSigner, signer: HardhatEthersSigner;
  let refContract: ReferralContract, sale: Sale, factory: SaleContractFactory, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token, saleToken: ERC20Token, locker: any;
  let ts: number;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] = await ethers.getSigners();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, weth9, router } = await uniswap.deploy(signer);

    let uniRouterAddress = await router.getAddress();
    let uniFactoryAddress = await uniFactory.getAddress();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const saleTokenF = await ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    refContract = await new ReferralContract__factory(saler).deploy(
      [usdt.getAddress(), usdc.getAddress(), dai.getAddress(), ethers.ZeroAddress],
      100,
      params.treasury
    );

    await usdt.transfer(await depositor1.getAddress(), ethers.parseEther("10000"));
    await usdt.transfer(await depositor2.getAddress(), ethers.parseEther("10000"));
    await usdt.transfer(await depositor3.getAddress(), ethers.parseEther("10000"));

    const launchF = await ethers.getContractFactory("SaleContractFactory", deployer);
    factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury, refContract)

    await factory.connect(saler).createSaleContract(await saleToken.getAddress(), await usdt.getAddress(), false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });

    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    sale = await ethers.getContractAt("Sale", saleAddress)
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdt.connect(depositor1).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdt.connect(depositor2).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdt.connect(depositor3).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();
  });

  it("Native buy should revert", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.liquidityPt, params.salePrice, params.liqPrice, params.soft, params.hard, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale actives after init");

    await expect(sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n })).to.be.revertedWithCustomError(sale, customError.cantAcceptNative);
  });

  it("should revert unaproved buy", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.liquidityPt, params.salePrice, params.liqPrice, params.soft, params.hard, params.min, params.max, params.minLock, refModule.getAddress());
    await usdt.connect(depositor1).approve(await sale.getAddress(), 0)

    await expect(sale.connect(depositor1).buyTokensWithERC20(2000, ""))
      .to.be.revertedWithCustomError(usdt, "ERC20InsufficientAllowance");
  });

  it("Successfull usdt + token sale happy path", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.liquidityPt, params.salePrice, params.liqPrice, params.soft, params.hard, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("should send USDT fee to the treasury on token sale", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.liquidityPt, params.salePrice, params.liqPrice, params.soft, params.hard, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

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

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 100, 100, 100, 2000, 10, 1000, 3600 * 24 * 30, refModule.getAddress());

    await expect(sale.connect(depositor1).buyTokensWithERC20(purchaseAmount, "")).to.changeTokenBalance(ethers, usdt, depositor1, -purchaseAmount);
    await expect(sale.connect(depositor1).buyTokensWithERC20(purchaseAmount, "")).to.changeTokenBalance(ethers, usdt, sale, purchaseAmount);

    await expect(await sale.totalRaised()).to.equal(purchaseAmount * 2n);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(purchaseAmount * 2n);
  });

  it("should reject purchases below the minimum amount", async function () {
    const minPurchase = ethers.parseEther("0.01")

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, eth1, eth1, 500, 1000, minPurchase, minPurchase * 10n, 3600 * 24 * 30, refModule.getAddress());

    await expect(sale.connect(depositor1).buyTokensWithERC20(ethers.parseEther("0.001"), "")).to.be.revertedWithCustomError(sale, customError.paymentOutsideMinMaxAmounts);
  });

  it("should not allow purchases after sale has ended", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, eth1, eth1, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress());
    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(depositor1).buyTokensWithERC20(10, "")).to.be.revertedWithCustomError(sale, customError.outsideSaleTime);
  });

  it("should handle refunds correctly when the soft cap is not reached", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 7200;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, eth1, eth1, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress());
    const depositAmount = 100;
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(depositor1).refund()).to.changeTokenBalance(ethers, usdt, depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

  it("should allow claiming of tokens after the sale is finalized", async function () {
    const halfEth = ethers.parseEther("0.5")
    const oneEth = ethers.parseEther("1")
    const price = 1000n;
    const depositAmount = halfEth;

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, price, 1200, halfEth, oneEth, halfEth, oneEth, 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");
    await sale.connect(depositor2).buyTokensWithERC20(depositAmount, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(await saleToken.balanceOf(sale)).to.be.equal(ethers.parseEther("1552"))
    await sale.connect(saler).finalizeSale({ value: 150 });
    await expect(await saleToken.balanceOf(sale)).to.be.equal(ethers.parseEther("1000"))

    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(ethers, saleToken, depositor1, depositAmount * price);
    await expect(sale.connect(depositor2).claim()).to.changeTokenBalance(ethers, saleToken, depositor2, depositAmount * price);
    await expect(await saleToken.balanceOf(sale)).to.be.equal(0)
  });

  it("should prevent unauthorized users from initializing the sale", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await expect(sale.connect(depositor1).initializeSale(startTime, endTime, 50, 100, 200, 500, 1000, 10, 200, 3600 * 24 * 30, refModule.getAddress())).to.be.revertedWithCustomError(sale, customError.OwnableUnauthorizedAccount);
  });

  it("should correctly calculate raised amount and refund excess if purchase exceeds hard cap", async function () {
    const depositAmount = ethersLib.parseEther("500");
    const excessAmount = ethersLib.parseEther("100");

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, depositAmount, depositAmount, ethersLib.parseEther("10"), ethersLib.parseEther("500"), 3600 * 24 * 30, refModule.getAddress());

    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    await expect(sale.connect(depositor3).buyTokensWithERC20(excessAmount, "")).to.be.revertedWithCustomError(sale, customError.saleGoalReached);
  });

  it("should reject token claims before sale finalization", async function () {
    const depositAmount = ethers.parseEther("100");

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("100"), ethers.parseEther("200"), 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    await expect(sale.connect(depositor1).claim()).to.be.revertedWithCustomError(sale, customError.notFinished);
  });

  it("should prevent refunding to non-contributors and double refunding", async function () {
    const depositAmount = ethers.parseEther("1");

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract)
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 50, 1000, 1200, ethers.parseEther("2"), ethers.parseEther("10"), ethers.parseEther("1"), ethers.parseEther("2"), 3600 * 24 * 30, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithERC20(depositAmount, "");

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(depositor1).refund();

    await expect(sale.connect(depositor1).refund()).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
    await expect(sale.connect(depositor2).refund()).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
  });
});
