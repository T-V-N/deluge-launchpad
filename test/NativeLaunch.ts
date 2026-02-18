import { assert, expect } from "chai";
import hre from "hardhat";

import {
  BSCPancakeswapV2Locker,
  SaleContractFactory,
  Sale,
  ERC20Token,
} from "../typechain-types/index.js";
import { BaseContract } from "ethers";

import {
  ReferralContract,
  ReferralContract__factory,
  ReferralModuleRefundable__factory,
} from "../lib/deluge-referral/typechain-types/index.js";
import { UniswapV2Deployer } from "./utils/Uniswap.js";

import { params } from "../utils/common.js";
import { customError } from "./utils/saleErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

const { ethers, networkHelpers } = await hre.network.connect();

const eth1 = ethers.parseEther("1");

describe("Native Launch tests", async function () {
  let deployer: HardhatEthersSigner,
    saler: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    depositor3: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let sale: Sale,
    factory: SaleContractFactory,
    saleToken: ERC20Token,
    locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract,
    usdt: ERC20Token,
    usdc: ERC20Token,
    weth9: BaseContract,
    dai: ERC20Token;
  let router: BaseContract;

  let ts: number;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, weth9: _weth9, router: _router } = await uniswap.deploy(signer);
    weth9 = _weth9;
    router = _router;

    let uniRouterAddress = await _router.getAddress();
    let uniFactoryAddress = await uniFactory.getAddress();

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
        "0x0000000000000000000000000000000000000000",
        false,
        [],
        uniFactoryAddress,
        uniRouterAddress,
        { value: params.fee }
      );
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1);
    const event = events[0];
    const saleAddress = event.args[0];

    sale = await ethers.getContractAt("Sale", saleAddress);
    saleToken
      .connect(saler)
      .approve(
        await sale.getAddress(),
        ethers.parseEther("10000000000000000000000000000000000000")
      );
    ts = await networkHelpers.time.latest();
  });

  it("Successfull native token sale happy path", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
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

    assert((await sale.finished()) == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert((await sale.finished()) == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("should allow adding multiple addresses to the whitelist", async function () {
    await sale
      .connect(saler)
      .addToWhitelist([
        await depositor1.getAddress(),
        await depositor2.getAddress(),
      ]);

    assert((await sale.whitelist(await depositor1.getAddress())) == true);
    assert((await sale.whitelist(await depositor2.getAddress())) == true);
  });

  it("should allow removing addresses from the whitelist", async function () {
    await sale
      .connect(saler)
      .addToWhitelist([
        await depositor1.getAddress(),
        await depositor2.getAddress(),
      ]);

    await sale
      .connect(saler)
      .removeFromWhitelist([
        await depositor1.getAddress(),
        await depositor2.getAddress(),
      ]);

    assert((await sale.whitelist(await depositor1.getAddress())) == false);
    assert((await sale.whitelist(await depositor2.getAddress())) == false);
  });

  it("should allow whitelisted addresses to buy tokens", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
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

    await sale
      .connect(saler)
      .addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);
    await expect(
      sale.connect(depositor1).buyTokensWithNative("", { value: 100 })
    )
      .to.emit(sale, "TokensPurchased")
      .withArgs(await depositor1.getAddress(), 100);

    await expect(
      sale.connect(depositor2).buyTokensWithNative("", { value: 100 })
    )
      .to.emit(sale, "TokensPurchased")
      .withArgs(await depositor2.getAddress(), 100);
  });

  it("should revert when non-whitelisted address tries to buy tokens", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
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
    await sale
      .connect(saler)
      .addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);

    await expect(
      sale.connect(depositor3).buyTokensWithNative("", { value: 100 })
    ).to.be.revertedWithCustomError(sale, customError.NotWhitelisted);
  });

  it("should allow native token purchases when sale is active", async function () {
    const purchaseAmount = 1_000n;

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        100,
        100,
        100,
        2000,
        10,
        1000,
        3600 * 24 * 30,
        refModule.getAddress()
      );

    await expect(
      sale.connect(depositor1).buyTokensWithNative("", {
        value: purchaseAmount,
      })
    ).to.changeEtherBalances(
      ethers,
      [depositor1, sale],
      [-purchaseAmount, purchaseAmount]
    );

    await expect(await sale.totalRaised()).to.equal(purchaseAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(
      purchaseAmount
    );
  });

  it("should send ETH fee to the treasury on native token sale", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        100,
        100,
        10000,
        200000,
        10,
        10000,
        3600 * 24 * 30,
        refModule.getAddress()
      );

    await sale.connect(depositor1).buyTokensWithNative("", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("", { value: 4_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await networkHelpers.setBalance(params.treasury, 0);
    const raised = ((await sale.totalRaised()) * params.raiseFee) / 100n;

    expect(
      await sale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.changeEtherBalance(ethers, params.treasury, raised);
  });

  it("should reject purchases below the minimum amount", async function () {
    const minPurchase = ethers.parseEther("0.01");

    refContract = await new ReferralContract__factory(saler).deploy(
      [usdt.getAddress(), usdc.getAddress(), dai.getAddress(), ethers.ZeroAddress],
      100,
      params.treasury
    );

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        eth1,
        eth1,
        500,
        1000,
        minPurchase,
        minPurchase * 10n,
        3600 * 24 * 30,
        refModule.getAddress()
      );

    await expect(
      sale.connect(depositor1).buyTokensWithNative("", {
        value: ethers.parseEther("0.001"),
      })
    ).to.be.revertedWithCustomError(
      sale,
      customError.paymentOutsideMinMaxAmounts
    );
  });

  it("should not allow purchases after sale has ended", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        eth1,
        eth1,
        500,
        1000,
        10,
        200,
        3600 * 24 * 30,
        refModule.getAddress()
      );
    await networkHelpers.time.increaseTo(endTime + 1);

    await expect(
      sale.connect(depositor1).buyTokensWithNative("", {
        value: 10,
      })
    ).to.be.revertedWithCustomError(sale, customError.outsideSaleTime);
  });

  it("should handle refunds correctly when the soft cap is not reached", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        startTime + 7200,
        50,
        eth1,
        eth1,
        500,
        1000,
        10,
        200,
        3600 * 24 * 30,
        refModule.getAddress()
      );
    const depositAmount = 100;
    await sale.connect(depositor1).buyTokensWithNative("", {
      value: depositAmount,
    });

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(depositor1).refund()).to.changeEtherBalance(
      ethers,
      depositor1,
      depositAmount
    );
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

  it("should allow claiming of tokens after the sale is finalized", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;
    const halfEth = ethers.parseEther("0.5");
    const oneEth = ethers.parseEther("1");
    const price = 1000n;

    const depositAmount = halfEth;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        price,
        1200,
        halfEth,
        oneEth,
        halfEth,
        oneEth,
        3600 * 24 * 30,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", {
      value: depositAmount,
    });
    await sale.connect(depositor2).buyTokensWithNative("", {
      value: depositAmount,
    });

    await networkHelpers.time.increase(3 * 3600);

    await expect(await saleToken.balanceOf(sale)).to.be.equal(
      ethers.parseEther("1552")
    );

    await sale.connect(saler).finalizeSale({ value: 150 });

    await expect(await saleToken.balanceOf(sale)).to.be.equal(
      ethers.parseEther("1000")
    );

    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor1,
      depositAmount * price
    );
    await expect(sale.connect(depositor2).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor2,
      depositAmount * price
    );
    await expect(await saleToken.balanceOf(sale)).to.be.equal(0);
  });

  it("should prevent unauthorized users from initializing the sale", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await expect(
      sale
        .connect(depositor1)
        .initializeSale(
          startTime,
          endTime,
          50,
          100,
          200,
          500,
          1000,
          10,
          200,
          3600 * 24 * 30,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(
      sale,
      customError.OwnableUnauthorizedAccount
    );
  });

  it("should correctly calculate raised amount and refund excess if purchase exceeds hard cap", async function () {
    const depositAmount = ethers.parseEther("500");
    const excessAmount = ethers.parseEther("100");
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        1000,
        1200,
        depositAmount,
        depositAmount,
        ethers.parseEther("10"),
        ethers.parseEther("500"),
        3600 * 24 * 30,
        refModule.getAddress()
      );

    await sale.connect(depositor1).buyTokensWithNative("", {
      value: depositAmount,
    });

    await expect(
      sale.connect(depositor3).buyTokensWithNative("", {
        value: excessAmount,
      })
    ).to.be.revertedWithCustomError(sale, customError.saleGoalReached);
  });

  it("should reject token claims before sale finalization", async function () {
    const depositAmount = ethers.parseEther("100");
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        1000,
        1200,
        ethers.parseEther("100"),
        ethers.parseEther("200"),
        ethers.parseEther("100"),
        ethers.parseEther("200"),
        3600 * 24 * 30,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", {
      value: depositAmount,
    });

    await expect(
      sale.connect(depositor1).claim()
    ).to.be.revertedWithCustomError(sale, customError.notFinished);
  });

  it("should prevent refunding to non-contributors and double refunding", async function () {
    const depositAmount = ethers.parseEther("1");
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;
    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        50,
        1000,
        1200,
        ethers.parseEther("2"),
        ethers.parseEther("10"),
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        3600 * 24 * 30,
        refModule.getAddress()
      );
    await sale.connect(depositor1).buyTokensWithNative("", {
      value: depositAmount,
    });

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(depositor1).refund();

    await expect(
      sale.connect(depositor1).refund()
    ).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
    await expect(
      sale.connect(depositor2).refund()
    ).to.be.revertedWithCustomError(sale, customError.nothingToRefund);
  });

  it("should finalize when Uniswap pair already exists (router refunds excess ETH)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const salePrice = 1000n;
    const liqPrice = 1500n;
    const softCap = ethers.parseEther("1");
    const hardCap = ethers.parseEther("2");

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        75,
        salePrice,
        liqPrice,
        softCap,
        hardCap,
        softCap,
        hardCap,
        3600 * 24 * 30,
        refModule.getAddress()
      );

    await sale
      .connect(depositor1)
      .buyTokensWithNative("", { value: softCap });

    // Pre-seed the Uniswap pair with skewed ratio before finalize.
    // This simulates a front-run: someone adds liquidity with a different
    // price, so when the sale tries addLiquidityETH, the router refunds
    // the excess ETH back to the sale contract.
    const seedTokenAmount = ethers.parseEther("100");
    const seedEthAmount = ethers.parseEther("0.001");
    await saleToken.connect(saler).approve(await router.getAddress(), seedTokenAmount);
    // @ts-ignore — BaseContract doesn't have addLiquidityETH typed
    await router.connect(saler).addLiquidityETH(
      await saleToken.getAddress(),
      seedTokenAmount,
      0,
      0,
      saler.address,
      (await networkHelpers.time.latest()) + 600,
      { value: seedEthAmount }
    );

    await networkHelpers.time.increase(3 * 3600);

    // Without receive() this would revert because the router sends excess ETH
    // back to the sale contract after adjusting amounts to match existing reserves.
    await expect(
      sale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.not.be.revert(ethers);

    assert(await sale.finished() == true, "Sale should be finished");
  });
});
