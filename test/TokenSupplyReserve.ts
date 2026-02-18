import { expect } from "chai";
import hre from "hardhat";

import {
  BSCPancakeswapV2Locker,
  SaleContractFactory,
  UncappedSaleContractFactory,
  Sale,
  UncappedSale,
  ERC20Token,
} from "../typechain-types/index.js";

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

describe("Token Supply & ETH Reserve tests — Capped Sale", async function () {
  let saler: HardhatEthersSigner,
    deployer: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let sale: Sale,
    factory: SaleContractFactory,
    saleToken: ERC20Token,
    locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract;
  let usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, , signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, router } = await uniswap.deploy(signer);

    const uniRouterAddress = await router.getAddress();
    const uniFactoryAddress = await uniFactory.getAddress();

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

    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1);
    const saleAddress = events[0].args[0];

    sale = await ethers.getContractAt("Sale", saleAddress);
    await saleToken
      .connect(saler)
      .approve(
        await sale.getAddress(),
        ethers.parseEther("10000000000000000000000000000000000000")
      );
  });

  it("should reject tokenSupply below MIN_TOKEN_SUPPLY (1e24)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const tooSmall = ethers.parseEther("999999"); // 999_999e18 < 1e24
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          tooSmall,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.TokenSupplyOutOfRange);
  });

  it("should reject tokenSupply above MAX_TOKEN_SUPPLY (1e27)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const tooLarge = ethers.parseEther("1000000001"); // > 1e27
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          tooLarge,
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.TokenSupplyOutOfRange);
  });

  it("should reject ethReserve below MIN_ETH_RESERVE (10 ether)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const tooSmall = ethers.parseEther("9");
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          params.tokenSupply,
          tooSmall,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.EthReserveOutOfRange);
  });

  it("should reject ethReserve above MAX_ETH_RESERVE (100 ether)", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const tooLarge = ethers.parseEther("101");
    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          params.tokenSupply,
          tooLarge,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.EthReserveOutOfRange);
  });

  it("should accept boundary values for tokenSupply and ethReserve", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const minSupply = ethers.parseEther("1000000"); // 1e24
    const minReserve = ethers.parseEther("10"); // 10e18

    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          minSupply,
          minReserve,
          params.liquidityPt,
          params.soft,
          params.hard,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.not.be.revert(ethers);

    expect(await sale.tokenSupply()).to.equal(minSupply);
    expect(await sale.ethReserve()).to.equal(minReserve);
  });

  it("should store liquidityPt and compute tokensForSale / tokensForLiquidity", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const supply = ethers.parseEther("10000000"); // 10M tokens

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        supply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );

    expect(await sale.liquidityPt()).to.equal(params.liquidityPt);
    expect(await sale.getTokensForSale()).to.equal(
      (supply * (100n - params.liquidityPt)) / 100n
    );
    expect(await sale.getTokensForLiquidity()).to.equal(
      (supply * params.liquidityPt) / 100n
    );
  });

  it("should transfer full tokenSupply on init", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const supply = ethers.parseEther("5000000"); // 5M tokens

    const balBefore = await saleToken.balanceOf(sale);
    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        supply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.hard,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    const balAfter = await saleToken.balanceOf(sale);

    expect(balAfter - balBefore).to.equal(supply);
  });

  it("should correctly compute claim amount based on tokenSupply", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const supply = ethers.parseEther("1000000"); // 1M
    const hardCap = ethers.parseEther("10");
    const deposit = ethers.parseEther("5");

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        supply,
        params.ethReserve,
        params.liquidityPt,
        hardCap,
        hardCap,
        deposit,
        hardCap,
        params.minLock,
        refModule.getAddress()
      );

    await sale.connect(depositor1).buyTokensWithNative("", { value: deposit });
    await sale.connect(depositor2).buyTokensWithNative("", { value: deposit });

    await networkHelpers.time.increase(3 * 3600);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    const tokensForSale = (supply * 80n) / 100n;
    const expectedClaim = (deposit * tokensForSale) / hardCap;

    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor1,
      expectedClaim
    );
    await expect(sale.connect(depositor2).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor2,
      expectedClaim
    );

    expect(await saleToken.balanceOf(sale)).to.equal(0);
  });

  it("should cap ethForLiquidity at ethAfterFee when ethReserve > raised", async function () {
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

    await sale.connect(depositor1).buyTokensWithNative("", { value: 5_000n });
    await sale.connect(depositor2).buyTokensWithNative("", { value: 5_000n });

    await networkHelpers.time.increase(3 * 3600);

    await expect(
      sale.connect(saler).finalizeSale({ value: params.lockerFee })
    ).to.not.be.revert(ethers);

    expect(await sale.finished()).to.be.true;
  });

  it("should return unsold tokens to owner when totalRaised < hardCap", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;
    const supply = ethers.parseEther("1000000");
    const hardCap = ethers.parseEther("10");
    const softCap = ethers.parseEther("2");
    const deposit = ethers.parseEther("2");

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        supply,
        params.ethReserve,
        params.liquidityPt,
        softCap,
        hardCap,
        deposit,
        hardCap,
        params.minLock,
        refModule.getAddress()
      );

    await sale.connect(depositor1).buyTokensWithNative("", { value: deposit });

    await networkHelpers.time.increase(3 * 3600);

    const ownerBalBefore = await saleToken.balanceOf(saler);
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    const ownerBalAfter = await saleToken.balanceOf(saler);

    const tokensForSale = (supply * 80n) / 100n;
    const tokensSold = (tokensForSale * deposit) / hardCap;
    const unsold = tokensForSale - tokensSold;

    expect(ownerBalAfter - ownerBalBefore).to.equal(unsold);
  });

  it("liquidityPt=34: 66% tokens sold to buyers, 34% sent to LP", async function () {
    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    const startTime = (await networkHelpers.time.latest()) + 1;
    const endTime = startTime + 3600;

    const supply = ethers.parseEther("1000000"); // 1M tokens
    const liqPt = 34n;
    const hardCap = ethers.parseEther("10");
    const deposit = ethers.parseEther("5");

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        supply,
        params.ethReserve,
        liqPt,
        hardCap,
        hardCap,
        deposit,
        hardCap,
        params.minLock,
        refModule.getAddress()
      );

    expect(await sale.liquidityPt()).to.equal(liqPt);

    const expectedForSale = (supply * 66n) / 100n;
    const expectedForLiq = supply - expectedForSale;
    expect(await sale.getTokensForSale()).to.equal(expectedForSale);
    expect(await sale.getTokensForLiquidity()).to.equal(expectedForLiq);

    await sale.connect(depositor1).buyTokensWithNative("", { value: deposit });
    await sale.connect(depositor2).buyTokensWithNative("", { value: deposit });
    expect(await sale.totalRaised()).to.equal(hardCap);

    await networkHelpers.time.increase(3 * 3600);

    const saleBalBefore = await saleToken.balanceOf(sale);
    expect(saleBalBefore).to.equal(supply);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    expect(await sale.finished()).to.be.true;

    const expectedClaim = (deposit * expectedForSale) / hardCap;
    expect(expectedClaim).to.equal(expectedForSale / 2n);

    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor1,
      expectedClaim
    );
    await expect(sale.connect(depositor2).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor2,
      expectedClaim
    );

    expect(await saleToken.balanceOf(sale)).to.equal(0n);
  });
});

describe("Token Supply & ETH Reserve tests — Uncapped Sale", async function () {
  let saler: HardhatEthersSigner,
    deployer: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let sale: UncappedSale,
    factory: UncappedSaleContractFactory,
    saleToken: ERC20Token,
    locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract;
  let refModule: any;
  let usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, , signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, router } = await uniswap.deploy(signer);

    const uniRouterAddress = await router.getAddress();
    const uniFactoryAddress = await uniFactory.getAddress();

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
    const saleAddress = await factory.launches(count - 1n);

    sale = await ethers.getContractAt("UncappedSale", saleAddress);
    await refModule.connect(saler).init(sale);
    await saleToken
      .connect(saler)
      .approve(
        await sale.getAddress(),
        ethers.parseEther("10000000000000000000000000000000000000")
      );
  });

  it("should reject tokenSupply out of range", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          ethers.parseEther("999999"),
          params.ethReserve,
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.TokenSupplyOutOfRange);
  });

  it("should reject ethReserve out of range", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await expect(
      sale
        .connect(saler)
        .initializeSale(
          startTime,
          endTime,
          params.tokenSupply,
          ethers.parseEther("9"),
          params.liquidityPt,
          params.soft,
          params.min,
          params.max,
          params.minLock,
          refModule.getAddress()
        )
    ).to.be.revertedWithCustomError(sale, customError.EthReserveOutOfRange);
  });

  it("should compute getPrice() using derived tokensForSale", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;
    const softCap = 10_000n;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        softCap,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );

    const tokensForSale = (params.tokenSupply * 80n) / 100n;
    expect(await sale.getPrice()).to.equal(tokensForSale / softCap);
  });

  it("should finalize and allow claim for uncapped sale", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;
    const deposit = 5_000n;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );

    await sale.connect(depositor1).buyTokensWithNative("", { value: deposit });
    await sale.connect(depositor2).buyTokensWithNative("", { value: deposit });

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    expect(await sale.finished()).to.be.true;

    const price = await sale.getPrice();
    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(
      ethers,
      saleToken,
      depositor1,
      deposit * price
    );
  });

  it("should transfer full tokenSupply on init", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    const balBefore = await saleToken.balanceOf(sale);
    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );
    const balAfter = await saleToken.balanceOf(sale);

    expect(balAfter - balBefore).to.equal(params.tokenSupply);
  });

  it("getTokensForSale and getTokensForLiquidity should sum to tokenSupply", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale
      .connect(saler)
      .initializeSale(
        startTime,
        endTime,
        params.tokenSupply,
        params.ethReserve,
        params.liquidityPt,
        params.soft,
        params.min,
        params.max,
        params.minLock,
        refModule.getAddress()
      );

    const forSale = await sale.getTokensForSale();
    const forLiq = await sale.getTokensForLiquidity();
    expect(forSale + forLiq).to.equal(params.tokenSupply);
    expect(forSale).to.equal((params.tokenSupply * 80n) / 100n);
  });
});
