import { assert, expect } from "chai";
import hre from "hardhat";
import {
  BSCPancakeswapV2Locker,
  SaleContractFactory,
  UncappedSaleContractFactory,
  Sale,
  ERC20Token,
  UncappedSale,
} from "../typechain-types/index.js";

import {
  ReferralContract,
  ReferralContract__factory,
  ReferralModuleRefundable,
  ReferralModuleRefundable__factory,
} from "../lib/deluge-referral/typechain-types/index.js";
import { UniswapV2Deployer } from "./utils/Uniswap.js";
import { params } from "../utils/common.js";
import { customError } from "./utils/saleErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

const { ethers, networkHelpers } = await hre.network.connect();

// ─── Sale.sol branch coverage ───────────────────────────────────────────────

describe("Sale — branch coverage", function () {
  let deployer: HardhatEthersSigner,
    saler: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let sale: Sale,
    factory: SaleContractFactory,
    saleToken: ERC20Token,
    locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract;
  let usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;
  let uniRouterAddress: string, uniFactoryAddress: string;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, , signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, router } = await uniswap.deploy(signer);
    uniRouterAddress = await router.getAddress();
    uniFactoryAddress = await uniFactory.getAddress();

    const saleTokenF = await ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    refContract = await new ReferralContract__factory(saler).deploy(
      [
        usdt.getAddress(),
        usdc.getAddress(),
        dai.getAddress(),
        ethers.ZeroAddress,
      ],
      100,
      params.treasury
    );

    const launchF = await ethers.getContractFactory(
      "SaleContractFactory",
      deployer
    );
    factory = await launchF.deploy(
      locker.getAddress(),
      params.fee,
      params.raiseFee,
      params.treasury,
      refContract
    );

    await factory
      .connect(saler)
      .createSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        false,
        [],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );

    const events = await factory.queryFilter(
      factory.filters.SaleContractCreated,
      -1
    );
    sale = await ethers.getContractAt("Sale", events[0].args[0]);
    await saleToken
      .connect(saler)
      .approve(await sale.getAddress(), ethers.MaxUint256);
  });

  // --- constructor whitelist branch (lines 125, 127-128) ---
  it("should set whitelist in constructor when non-empty array passed", async function () {
    await factory
      .connect(saler)
      .createSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        false,
        [depositor1.address, depositor2.address],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );
    const events = await factory.queryFilter(
      factory.filters.SaleContractCreated,
      -1
    );
    const wlSale = await ethers.getContractAt(
      "Sale",
      events[events.length - 1].args[0]
    );
    expect(await wlSale.isWhitelist()).to.be.true;
    expect(await wlSale.whitelist(depositor1.address)).to.be.true;
    expect(await wlSale.whitelist(depositor2.address)).to.be.true;
  });

  // --- initializeSale validation branches ---
  it("should revert on double initialization", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.InitProblem);
  });

  it("should revert on wrong sale date (endTime in past)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) - 100;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t - 200,
          t,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongSaleDate);
  });

  it("should revert on wrong sale date (endTime <= startTime)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 100;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongSaleDate);
  });

  it("should revert on wrong liquidityPt (0)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          0,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongLiquidityPt);
  });

  it("should revert on wrong liquidityPt (>50)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          51,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongLiquidityPt);
  });

  it("should revert when softCap > hardCap", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          2000,
          1000,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.SoftCapShouldBeLessThanHardCap
    );
  });

  it("should revert when minPurchase > maxPurchase", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          500,
          100,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.MinPurchaseShouldBeLessThanMaxPurchase
    );
  });

  it("should revert when lockPeriod < 3600", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          100,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.tooSmallLockPeriod);
  });

  it("should revert when sale duration > 7 days", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 8 * 86400,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.SaleDurationMustBeLessThanWeek
    );
  });

  it("should revert when sale starts > 7 days from now", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 8 * 86400;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.SaleMustStartInOneWeek);
  });

  // --- buyTokensWithERC20 on native sale (line 226) ---
  it("should revert buyTokensWithERC20 on native sale", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale.connect(depositor1).buyTokensWithERC20(1000, "")
    ).to.be.revertedWithCustomError(sale, customError.cantAcceptERC20);
  });

  // --- finalizeSale before endTime (line 275) ---
  it("should revert finalizeSale before sale ends", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.be.revertedWithCustomError(sale, customError.SaleNotEnded);
  });

  // --- finalizeSale with unfinalized referral (line 279) ---
  it("should revert finalizeSale when referral not finalized", async function () {
    await factory
      .connect(saler)
      .createSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        true,
        [],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );
    const events = await factory.queryFilter(
      factory.filters.SaleContractCreated,
      -1
    );
    const refSale = await ethers.getContractAt(
      "Sale",
      events[events.length - 1].args[0]
    );
    await saleToken
      .connect(saler)
      .approve(await refSale.getAddress(), ethers.MaxUint256);

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(refSale);

    const t = (await networkHelpers.time.latest()) + 1;
    await refSale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await refSale.connect(depositor1).buyTokensWithNative("", { value: 2000n });

    await networkHelpers.time.increase(4 * 3600);
    await expect(
      refSale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.be.revertedWithCustomError(refSale, customError.FinishReferral);
  });

  // --- finalizeSale when softCap not reached (line 341) ---
  it("should return tokens to owner when softCap not reached", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        10_000,
        20_000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 500n });

    await networkHelpers.time.increase(4 * 3600);

    const ownerBefore = await saleToken.balanceOf(saler);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    const ownerAfter = await saleToken.balanceOf(saler);
    expect(ownerAfter - ownerBefore).to.equal(params.tokenSupply);
    expect(await sale.finished()).to.be.true;
  });

  // --- claim: NoDeposit ---
  it("should revert claim with no deposit", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        20_000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });

    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await expect(
      sale.connect(depositor2).claim()
    ).to.be.revertedWithCustomError(sale, customError.noDeposit);
  });

  // --- claim: AlreadyClaimed ---
  it("should revert double claim", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        20_000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });

    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await sale.connect(depositor1).claim();
    await expect(
      sale.connect(depositor1).claim()
    ).to.be.revertedWithCustomError(sale, customError.alreadyClaimed);
  });

  // --- extendLock: AlreadyFinished ---
  it("should revert extendLock after sale finished", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        20_000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });
    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await expect(
      sale.connect(saler).extendLock(3600)
    ).to.be.revertedWithCustomError(sale, "AlreadyFinished");
  });

  // --- extendLock: success ---
  it("should allow extendLock before sale finished", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    const lockBefore = await sale.lockPeriod();
    await sale.connect(saler).extendLock(7200);
    expect(await sale.lockPeriod()).to.equal(lockBefore + 7200n);
  });
});

// ─── UncappedSale.sol branch coverage ────────────────────────────────────────

describe("UncappedSale — branch coverage", function () {
  let deployer: HardhatEthersSigner,
    saler: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let sale: UncappedSale,
    factory: UncappedSaleContractFactory,
    saleToken: ERC20Token,
    locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract;
  let usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;
  let uniRouterAddress: string, uniFactoryAddress: string;
  let refModule: ReferralModuleRefundable;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, , signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, router } = await uniswap.deploy(signer);
    uniRouterAddress = await router.getAddress();
    uniFactoryAddress = await uniFactory.getAddress();

    const saleTokenF = await ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    refContract = await new ReferralContract__factory(saler).deploy(
      [
        usdt.getAddress(),
        usdc.getAddress(),
        dai.getAddress(),
        ethers.ZeroAddress,
      ],
      100,
      params.treasury
    );
    refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    const launchF = await ethers.getContractFactory(
      "UncappedSaleContractFactory",
      deployer
    );
    factory = await launchF.deploy(
      locker.getAddress(),
      params.fee,
      params.raiseFee,
      params.treasury,
      refContract
    );

    await factory
      .connect(saler)
      .createUncappedSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        false,
        [],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );

    const count = await factory.totalLaunchesCount();
    sale = await ethers.getContractAt(
      "UncappedSale",
      await factory.launches(count - 1n)
    );
    await saleToken
      .connect(saler)
      .approve(await sale.getAddress(), ethers.MaxUint256);
  });

  it("should set whitelist in constructor when non-empty array passed", async function () {
    await factory
      .connect(saler)
      .createUncappedSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        false,
        [depositor1.address, depositor2.address],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );
    const count = await factory.totalLaunchesCount();
    const wlSale = await ethers.getContractAt(
      "UncappedSale",
      await factory.launches(count - 1n)
    );
    expect(await wlSale.isWhitelist()).to.be.true;
    expect(await wlSale.whitelist(depositor1.address)).to.be.true;
  });

  it("should revert on double initialization", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.InitProblem);
  });

  it("should revert on wrong sale date", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) - 100;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t - 200,
          t,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongSaleDate);
  });

  it("should revert on wrong liquidityPt", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          0,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.WrongLiquidityPt);
  });

  it("should revert when minPurchase > maxPurchase", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          500,
          100,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.MinPurchaseShouldBeLessThanMaxPurchase
    );
  });

  it("should revert when lockPeriod < 3600", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          100,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.tooSmallLockPeriod);
  });

  it("should revert when sale duration > 7 days", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 8 * 86400,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.SaleDurationMustBeLessThanWeek
    );
  });

  it("should revert when sale starts > 7 days from now", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 8 * 86400;
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          t,
          t + 3600,
          params.tokenSupply,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.SaleMustStartInOneWeek);
  });

  it("should revert buyTokensWithERC20 on native sale", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale.connect(depositor1).buyTokensWithERC20(1000, "")
    ).to.be.revertedWithCustomError(sale, customError.cantAcceptERC20);
  });

  it("should revert finalizeSale before sale ends", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    await expect(
      sale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.be.revertedWithCustomError(sale, customError.SaleNotEnded);
  });

  it("should revert finalizeSale when referral not finalized", async function () {
    await factory
      .connect(saler)
      .createUncappedSaleContract(
        await saleToken.getAddress(),
        ethers.ZeroAddress,
        true,
        [],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );
    const count = await factory.totalLaunchesCount();
    const refSale = await ethers.getContractAt(
      "UncappedSale",
      await factory.launches(count - 1n)
    );
    await saleToken
      .connect(saler)
      .approve(await refSale.getAddress(), ethers.MaxUint256);

    const rm = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await rm.connect(saler).init(refSale);

    const t = (await networkHelpers.time.latest()) + 1;
    await refSale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        rm.getAddress()
      );
    await refSale.connect(depositor1).buyTokensWithNative("", { value: 2000n });
    await networkHelpers.time.increase(4 * 3600);

    await expect(
      refSale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.be.revertedWithCustomError(refSale, "FinishReferral");
  });

  it("should return tokens to owner when softCap not reached", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        10_000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 500n });
    await networkHelpers.time.increase(4 * 3600);

    const ownerBefore = await saleToken.balanceOf(saler);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    const ownerAfter = await saleToken.balanceOf(saler);
    expect(ownerAfter - ownerBefore).to.equal(params.tokenSupply);
    expect(await sale.finished()).to.be.true;
  });

  it("should revert claim with no deposit", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });
    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await expect(
      sale.connect(depositor2).claim()
    ).to.be.revertedWithCustomError(sale, customError.noDeposit);
  });

  it("should revert double claim", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });
    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await sale.connect(depositor1).claim();
    await expect(
      sale.connect(depositor1).claim()
    ).to.be.revertedWithCustomError(sale, customError.alreadyClaimed);
  });

  it("should revert extendLock after sale finished", async function () {
    await refModule.connect(saler).init(sale);
    const t = (await networkHelpers.time.latest()) + 1;
    await sale
      .connect(saler)
      .initializeSale(
        t,
        t + 3600,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        1000,
        100,
        10_000,
        params.minLock,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", { value: 1000n });
    await networkHelpers.time.increase(4 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    await expect(
      sale.connect(saler).extendLock(3600)
    ).to.be.revertedWithCustomError(sale, "AlreadyFinished");
  });

  it("should revert getPrice before init", async function () {
    await expect(sale.getPrice()).to.be.revertedWithCustomError(
      sale,
      customError.InitProblem
    );
  });
});

// ─── VestingFactory branch coverage ──────────────────────────────────────────

describe("VestingFactory — branch coverage", function () {
  let deployer: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    user1: HardhatEthersSigner;
  let saleToken: ERC20Token;

  beforeEach(async function () {
    [deployer, treasury, , user1] = await ethers.getSigners();
    const saleTokenF = await ethers.getContractFactory("ERC20Token", deployer);
    saleToken = await saleTokenF.deploy("VTKN");
  });

  it("should revert constructor with zero treasury", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    await expect(
      f.deploy(ethers.ZeroAddress, 1000)
    ).to.be.revertedWithCustomError(f, "NotZeroAddress");
  });

  it("should revert constructor with zero fee", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    await expect(
      f.deploy(treasury.getAddress(), 0)
    ).to.be.revertedWithCustomError(f, "NotZero");
  });

  it("should revert createPeriodicVestingContract with insufficient fee", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    const vf = await f.deploy(treasury.getAddress(), 1000);
    const t = (await networkHelpers.time.latest()) + 60;
    await expect(
      vf.createPeriodicVestingContract(
        saleToken.getAddress(),
        t,
        0,
        10n * 10n ** 18n,
        3600,
        15n * 10n ** 18n,
        { value: 999 }
      )
    ).to.be.revertedWithCustomError(vf, "PayForCreation");
  });

  it("should revert createLinearVestingContract with insufficient fee", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    const vf = await f.deploy(treasury.getAddress(), 1000);
    const t = (await networkHelpers.time.latest()) + 60;
    await expect(
      vf.createLinearVestingContract(saleToken.getAddress(), t, 3600, {
        value: 999,
      })
    ).to.be.revertedWithCustomError(vf, "PayForCreation");
  });

  it("should allow owner to setVestingFee", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    const vf = await f.deploy(treasury.getAddress(), 1000);
    await vf.setVestingFee(5000);
    expect(await vf.vestingFee()).to.equal(5000);
  });

  it("getVestingCount / getVestingContracts / getTotalVestingsCount", async function () {
    const f = await ethers.getContractFactory("VestingContractFactory");
    const vf = await f.deploy(treasury.getAddress(), 1000);

    expect(await vf.getTotalVestingsCount()).to.equal(0);
    expect(await vf.getVestingCount(deployer.address)).to.equal(0);
    expect(await vf.getVestingContracts(deployer.address)).to.deep.equal([]);

    const t = (await networkHelpers.time.latest()) + 60;
    await vf.createLinearVestingContract(saleToken.getAddress(), t, 3600, {
      value: 1000,
    });

    expect(await vf.getTotalVestingsCount()).to.equal(1);
    expect(await vf.getVestingCount(deployer.address)).to.equal(1);
    const contracts = await vf.getVestingContracts(deployer.address);
    expect(contracts.length).to.equal(1);
  });
});
