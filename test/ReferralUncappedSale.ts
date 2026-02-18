import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers as ethersLib } from "ethers";
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

import { params } from "../utils/common.js";
import { refError } from "./utils/refErrors.js";
import { customError } from "./utils/saleErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { UniswapV2Deployer } from "./utils/Uniswap.js";

const { ethers, networkHelpers } = await hre.network.connect();

describe("Uncapped Launch with Referral tests", async function () {
  let deployer: HardhatEthersSigner, saler: HardhatEthersSigner, depositor1: HardhatEthersSigner, depositor2: HardhatEthersSigner, depositor3: HardhatEthersSigner, refer: HardhatEthersSigner, signer: HardhatEthersSigner;
  let sale: UncappedSale, factory: UncappedSaleContractFactory, saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let refModule: ReferralModuleRefundable, refContract: ReferralContract, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;

  let uniRouterAddress: string;
  let uniFactoryAddress: string;
  let ts: number;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3, refer, signer] = await ethers.getSigners();

    const uniswap = new UniswapV2Deployer();
    const { uniFactory, weth9, router } = await uniswap.deploy(signer);

    uniRouterAddress = await router.getAddress();
    uniFactoryAddress = await uniFactory.getAddress();

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

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });

    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();
  });

  it("Successfull native token sale happy pat with Referral", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    expect(await refModule.getRefContract()).to.be.equal(await refContract.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await expect(await ethers.provider.getBalance(await sale.getAddress())).to.equal(12000);
    await expect(await refModule.getRefshareBalance()).to.equal(80);

    await sale.connect(saler).finalizeRef(100);

    await expect(await ethers.provider.getBalance(await refContract.getAddress())).to.equal(80);
    await expect(await ethers.provider.getBalance(await sale.getAddress())).to.equal(11920);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("Reward shall be withdrawable", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(saler).finalizeRef(100)).to.changeEtherBalances(ethers, [refContract, sale], [80, -80]);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    await expect(refContract.connect(refer).claimCode("someCode")).to.changeEtherBalances(ethers, [refContract, refer], [-40, 40]);
    await expect(refContract.connect(refer).claimCode("coolCode")).to.changeEtherBalances(ethers, [refContract, refer], [-40, 40]);
    await expect(refContract.connect(refer).claimCode("non existing code")).to.revertedWithCustomError(refContract, refError.CodeDoesntExist);
  });

  it("Withdraw empty code", async function () {
    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).claimCode("someCode");
  });

  it("Withdraw code which doesn't belong to ya", async function () {
    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(depositor3).claimCode("someCode")).to.revertedWithCustomError(refContract, refError.CodeDoesntBelongToCaller);
  });

  it("Code shall require payment", async function () {
    await expect(refContract.connect(refer).createReferralCode("fwsad",)).to.revertedWithCustomError(refContract, refError.PayForCreation);
    await expect(refContract.connect(refer).createReferralCode("dasd", { value: 99n })).to.revertedWithCustomError(refContract, refError.PayForCreation);
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.emit(refContract, "ReferralCodeCreated").withArgs('vzxvsd', refer);
  });

  it("Admin shall create codes for free", async function () {
    await expect(refContract.connect(saler).createReferralCodeAdmin("czxc", saler))
      .to.emit(refContract, "ReferralCodeCreated")
      .withArgs("czxc", await saler.getAddress());
  });

  it("Non-Admin shall not create codes for free", async function () {
    await expect(refContract.connect(saler).createReferralCode("aaaa1")).to.revertedWithCustomError(refContract, refError.PayForCreation);
  });

  it("Unable to create similar codes", async function () {
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.emit(refContract, "ReferralCodeCreated").withArgs('vzxvsd', refer);
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.revertedWithCustomError(refContract, refError.CodeAlreadyExists)
  });

  it("USDT test", async function () {
    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), usdt.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();

    await usdt.transfer(await depositor1.getAddress(), ethers.parseEther("10000"));
    await usdt.transfer(await depositor2.getAddress(), ethers.parseEther("10000"));
    await usdt.transfer(await depositor3.getAddress(), ethers.parseEther("10000"));

    await usdt.connect(depositor1).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdt.connect(depositor2).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdt.connect(depositor3).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(await usdt.balanceOf(sale)).to.equal(12000);
    await sale.connect(saler).finalizeRef(100);

    await expect(await usdt.balanceOf(refContract)).to.equal(80);
    await expect(await usdt.balanceOf(sale)).to.equal(11920);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("USDC test", async function () {
    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), usdc.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();

    await usdc.transfer(await depositor1.getAddress(), ethers.parseEther("10000"));
    await usdc.transfer(await depositor2.getAddress(), ethers.parseEther("10000"));
    await usdc.transfer(await depositor3.getAddress(), ethers.parseEther("10000"));

    await usdc.connect(depositor1).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdc.connect(depositor2).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await usdc.connect(depositor3).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(await usdc.balanceOf(sale)).to.equal(12000);
    await sale.connect(saler).finalizeRef(100);

    await expect(await usdc.balanceOf(refContract)).to.equal(80);
    await expect(await usdc.balanceOf(sale)).to.equal(11920);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("DAI test", async function () {
    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), dai.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();

    await dai.transfer(await depositor1.getAddress(), ethers.parseEther("10000"));
    await dai.transfer(await depositor2.getAddress(), ethers.parseEther("10000"));
    await dai.transfer(await depositor3.getAddress(), ethers.parseEther("10000"));

    await dai.connect(depositor1).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await dai.connect(depositor2).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await dai.connect(depositor3).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(await dai.balanceOf(sale)).to.equal(12000);
    await sale.connect(saler).finalizeRef(100);

    await expect(await dai.balanceOf(refContract)).to.equal(80);
    await expect(await dai.balanceOf(sale)).to.equal(11920);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("Only owner can init and once", async function () {
    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await expect(refModule.connect(refer).init(sale)).to.revertedWithCustomError(refModule, refError.OwnableUnauthorizedAccount)
    await refModule.connect(saler).init(sale);
    await expect(refModule.connect(saler).init(sale)).to.revertedWithCustomError(refModule, refError.InitProblem)
  });

  it("Only parent sale can process depositse", async function () {
    await expect(refModule.connect(refer).processReferralCode("code", 1_000n, ethers.ZeroAddress)).to.revertedWithCustomError(refModule, refError.OnlyParentContract)
    await expect(refModule.connect(refer).finalizeReferralCodes(10)).to.revertedWithCustomError(refModule, refError.OnlyParentContract)
  });

  it("Partial finalization test", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    expect(await refModule.getRefContract()).to.be.equal(await refContract.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("1", { value: 100n });
    await refContract.connect(refer).createReferralCode("2", { value: 100n });
    await refContract.connect(refer).createReferralCode("3", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("1", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("2", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("3", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("1", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await sale.connect(saler).finalizeRef(1);
    await expect(await refModule.isFinalized()).to.equal(false);

    await sale.connect(saler).finalizeRef(1);
    await expect(await refModule.isFinalized()).to.equal(false);

    await sale.connect(saler).finalizeRef(1);
    await expect(sale.connect(saler).finalizeRef(1)).to.revertedWithCustomError(sale, customError.AlreadyFinalizedRef);
    await expect(await refModule.isFinalized()).to.equal(true);
  });

  it("Random erc20 test", async function () {
    const saleTokenF = await ethers.getContractFactory("ERC20Token", saler);
    const randomToken = await saleTokenF.deploy("RND");

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), randomToken.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    refModule = await new ReferralModuleRefundable__factory(saler).deploy(refContract);

    sale = await ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    await saleToken.connect(saler).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await networkHelpers.time.latest();

    await randomToken.transfer(await depositor1.getAddress(), ethers.parseEther("10000"));
    await randomToken.transfer(await depositor2.getAddress(), ethers.parseEther("10000"));
    await randomToken.transfer(await depositor3.getAddress(), ethers.parseEther("10000"));

    await randomToken.connect(depositor1).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await randomToken.connect(depositor2).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))
    await randomToken.connect(depositor3).approve(await sale.getAddress(), ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await networkHelpers.time.increase(3 * 3600);

    await expect(await randomToken.balanceOf(sale)).to.equal(12000);
    await sale.connect(saler).finalizeRef(100);

    await expect(await randomToken.balanceOf(refContract)).to.equal(0);
    await expect(await randomToken.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("Owner can delete code", async function () {
    const startTime = (await networkHelpers.time.latest()) + 2;
    const endTime = startTime + 3600;

    await sale.connect(saler).initializeSale(startTime, endTime, params.tokenSupply, params.ethReserve, params.liquidityPt, params.soft, params.min, params.max, params.minLock, refModule.getAddress());
    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await networkHelpers.time.increase(3 * 3600);

    await expect(sale.connect(saler).finalizeRef(100)).to.changeEtherBalances(ethers, [refContract, sale], [80, -80]);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    await expect(refContract.connect(saler).deleteReferralCode("coolCode")).to.changeEtherBalances(ethers, [refContract, refer], [-40, 40]);
    await expect(refContract.connect(saler).deleteReferralCode("someCode")).to.changeEtherBalances(ethers, [refContract, refer], [-40, 40]);
    await expect(refContract.connect(saler).deleteReferralCode("someCode")).to.revertedWithCustomError(refContract, refError.CodeDoesntExist);
  });

  it("Can't unlock unlocked source", async function () {
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100);
    await usdt.connect(saler).approve(await refContract.getAddress(), 100);
    await refContract.connect(saler).unlockRegisteredFunds("someCode");
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100)).to.not.be.revert(ethers);
  });

  it("Remove funds", async function () {
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100);
    await refContract.connect(saler).removeRegisteredFunds("someCode", [usdt.getAddress()], [100]);
  });

  it("USDT/DAI/USDC should be defined", async function () {
    refContract = await new ReferralContract__factory(saler).deploy(
      [usdt.getAddress(), usdc.getAddress(), dai.getAddress(), ethers.ZeroAddress],
      100,
      params.treasury
    );

    expect(new ReferralContract__factory(saler).deploy(["0x0000000000000000000000000000000000000000", usdc.getAddress(), dai.getAddress()], params.fee, params.treasury));
    expect(new ReferralContract__factory(saler).deploy([usdt.getAddress(), "0x0000000000000000000000000000000000000000", dai.getAddress()], params.fee, params.treasury));
    expect(new ReferralContract__factory(saler).deploy([usdt.getAddress(), usdc.getAddress(), "0x0000000000000000000000000000000000000000"], params.fee, params.treasury));
  });

  it("Can't unlock unlocked source", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100)).to.emit(refContract, "FundsAdded").withArgs("someCode", usdt.getAddress(), 100);
    await usdt.connect(saler).approve(refAddress, ethers.parseEther("10000000000000000000000000000000000000"));
    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode")).to.changeTokenBalances(ethers, usdt, [refAddress, saler], [100, -100]);
  });

  it("remove funds example", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100)).to.emit(refContract, "FundsAdded").withArgs("someCode", usdt.getAddress(), 100);
    await expect(refContract.connect(saler).removeRegisteredFunds("someCode", [usdt.getAddress()], [100])).to.emit(refContract, "FundsRemoved");
    await usdt.connect(saler).approve(refAddress, ethers.parseEther("10000000000000000000000000000000000000"));
    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode")).to.not.be.revert(ethers);
  });

  it("Can't unlock unlocked source", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await refContract.connect(saler).addRegisteredFunds("someCode", usdt.getAddress(), 100);
    await refContract.connect(saler).addRegisteredFunds("someCode", usdc.getAddress(), 100);
    await refContract.connect(saler).addRegisteredFunds("someCode", dai.getAddress(), 100);
    await usdt.connect(saler).approve(refAddress, ethers.parseEther("10000000000000000000000000000000000000"));
    await usdc.approve(refAddress, ethers.parseEther("10000000000000000000000000000000000000"));
    await dai.approve(refAddress, ethers.parseEther("10000000000000000000000000000000000000"));
    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode"))
      .to.emit(usdt, "Transfer")
      .and.emit(usdc, "Transfer")
      .and.emit(dai, "Transfer");
  });
});
