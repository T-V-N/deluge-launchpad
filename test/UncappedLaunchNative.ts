import { assert, expect } from "chai";
import hre from "hardhat";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol/index.js";
import { UncappedSale } from "../typechain-types/contracts/UncappedSale.js";
import { UncappedSaleContractFactory } from "../typechain-types/index.js";
import { BSCPancakeswapV2Locker } from "../typechain-types/index.js";
import {
  ReferralContract,
  ReferralContract__factory,
  ReferralModuleRefundable,
  ReferralModuleRefundable__factory,
} from "../lib/deluge-referral/typechain-types/index.js";
import { Contract } from "ethers";

import { params } from "../utils/common.js";

import { customError } from "./utils/saleErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { UniswapV2Deployer } from "./utils/Uniswap.js";

const { ethers, networkHelpers } = await hre.network.connect();

describe("Uncapped Sale tests", async function () {
  let deployer: HardhatEthersSigner, saler: HardhatEthersSigner, depositor1: HardhatEthersSigner, depositor2: HardhatEthersSigner, depositor3: HardhatEthersSigner, signer: HardhatEthersSigner;
  let sale: UncappedSale, factory: UncappedSaleContractFactory, saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let ts: number;
  let refModule: ReferralModuleRefundable, refContract: ReferralContract, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;

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

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    const launchF = await ethers.getContractFactory("UncappedSaleContractFactory", deployer);
    factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury, refContract)

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });

    const launchCount = await factory.totalLaunchesCount();
    const saleAddress = await factory.launches(launchCount - 1n);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();
  });

  it("Successful token sale happy path", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, 100_000_000n, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");
  });

  it("should allow adding multiple addresses to the whitelist", async function () {
    await expect(sale.connect(saler).addToWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]))
      .to.not.be.revert(ethers);
    expect(await sale.whitelist(await depositor1.getAddress())).to.be.true;
    expect(await sale.whitelist(await depositor2.getAddress())).to.be.true;
  });

  it("should allow removing addresses from the whitelist", async function () {
    await sale.connect(saler).addToWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]);
    await expect(sale.connect(saler).removeFromWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]))
      .to.not.be.revert(ethers);
    expect(await sale.whitelist(await depositor1.getAddress())).to.be.false;
    expect(await sale.whitelist(await depositor2.getAddress())).to.be.false;
  });

  it("should allow whitelisted addresses to buy tokens", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock, refModule.getAddress());

    await sale.connect(saler).addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);
    await expect(sale.connect(depositor1).buyTokensWithNative("", { value: 100 }))
      .to.emit(sale, 'TokensPurchased')
      .withArgs(await depositor1.getAddress(), 100);

    await expect(sale.connect(depositor2).buyTokensWithNative("", { value: 100 }))
      .to.emit(sale, 'TokensPurchased')
      .withArgs(await depositor2.getAddress(), 100);
  });

  it("should revert when non-whitelisted address tries to buy tokens", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    await sale.connect(saler).addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);

    await expect(sale.connect(depositor3).buyTokensWithNative("", { value: 100 }))
      .to.be.revertedWithCustomError(sale, customError.NotWhitelisted);
  });

  it("should handle refunds correctly when the soft cap is not reached", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 7200;
    const depositAmount = 100;
    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithNative("", { value: depositAmount });

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(depositor1).refund()).to.changeEtherBalance(ethers, depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

  it("should allow claiming of tokens after the sale is finalized", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;
    const tokensForSale = 1_000_000n;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, tokensForSale, 1_000_000n, 1_000_000n, 1_000_000n, params.minLock, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1_000_000n });

    await networkHelpers.time.increase(3 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(ethers, saleToken, depositor1, (await sale.getPrice()) * tokensForSale);
  });

  it("should prevent unauthorized users from initializing the sale", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await expect(sale.connect(depositor1).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock, refModule.getAddress())).to.be.revertedWithCustomError(sale, customError.OwnableUnauthorizedAccount);
  });

  it("should calculate the correct price per token dynamically", async function () {
    const tokensForSale = ethers.parseEther("1000");
    const softCap = ethers.parseEther("10");
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, tokensForSale, softCap, softCap, softCap * 10n, params.minLock, refModule.getAddress());

    const priceAtSoftCap = await sale.getPrice();
    expect(priceAtSoftCap).to.equal(tokensForSale / softCap);

    const overSoftCap = softCap + (ethers.parseEther("15"));
    await sale.connect(depositor1).buyTokensWithNative("", { value: overSoftCap });

    const priceAfterExceedingSoftCap = await sale.getPrice();
    expect(priceAfterExceedingSoftCap).to.equal(tokensForSale / (overSoftCap));
  });

  it("should reject purchases below the minimum amount", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    const minPurchase = ethers.parseEther("0.01")
    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, minPurchase, minPurchase * 10n, params.minLock, refModule.getAddress());

    await expect(sale.connect(depositor1).buyTokensWithNative("", { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(sale, customError.paymentOutsideMinMaxAmounts);
  });

  it("should not allow purchases after sale has ended", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 360;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    await networkHelpers.time.increase(3600 * 2);

    await expect(sale.connect(depositor1).buyTokensWithNative("", { value: params.min })).to.be.revertedWithCustomError(sale, customError.outsideSaleTime);
  });

  it("should send ETH fee to the treasury on native token sale", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), 1_000, 1_000n, ethers.parseEther("1000"), params.minLock, refModule.getAddress());

    await sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    const treasuryInitialEthBalance = await ethers.provider.getBalance(params.treasury);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    const newTreasuryEthBalance = await ethers.provider.getBalance(params.treasury);
    const raised = (await sale.totalRaised()) * (params.raiseFee) / (100n);
    expect(newTreasuryEthBalance - (treasuryInitialEthBalance)).to.equal(raised, "Treasury should receive the ETH fee");
  });

  it("should correctly handle refunds when the soft cap is not reached", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 7200;
    const depositAmount = ethers.parseEther("1");

    await sale.connect(saler).initializeSale(startTime, endTime, 51, ethers.parseEther("1000"), ethers.parseEther("10"), ethers.parseEther("1"), ethers.parseEther("1"), params.minLock, refModule.getAddress());
    await sale.connect(depositor1).buyTokensWithNative("", { value: depositAmount });

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(depositor1).refund()).to.changeEtherBalance(ethers, depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

});
