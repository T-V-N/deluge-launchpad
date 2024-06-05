import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol";
import { UncappedSale } from "../typechain-types/contracts/UncappedSale";
import { UncappedSaleContractFactory } from "../typechain-types";
import { BSCPancakeswapV2Locker, ReferralContract, ReferralModule, ReferralModule__factory } from "../typechain-types";

import { params } from "../utils/common";
import { refError } from "./utils/refErrors";
import { customError } from "./utils/saleErrors";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { UniswapV2Deployer } from "./utils/Uniswap";
import { getBlockTime } from "./utils/getBlockTime";



describe("Uncapped Launch with Referral tests", async function () {
  let deployer: SignerWithAddress, saler: SignerWithAddress, depositor1: SignerWithAddress, depositor2: SignerWithAddress, depositor3: SignerWithAddress, refer: SignerWithAddress, signer: SignerWithAddress;
  let sale: UncappedSale, factory: UncappedSaleContractFactory, saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let refModule: ReferralModule, refContract: ReferralContract, moduleFactory: ReferralModule__factory, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;
  let uniRouterAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
  let uniFactoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
  let ts: bigint;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3, refer, signer] = await hre.ethers.getSigners();

    const uniswap = new UniswapV2Deployer();
    const {
      uniFactory,
      router,
    } = await uniswap.deploy(signer);

    if (hre.network.name == 'hardhat') {
      uniRouterAddress = await router.getAddress();
      uniFactoryAddress = await uniFactory.getAddress();
    }

    const lockerF = await hre.ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    const referralFactory = await hre.ethers.getContractFactory("ReferralContract")
    refContract = await referralFactory.deploy(await usdt.getAddress(), await usdc.getAddress(), await dai.getAddress(), 100, params.treasury);

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(true, usdt, usdt, usdc, dai, refContract)

    const launchF = await hre.ethers.getContractFactory("UncappedSaleContractFactory", deployer);
    factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury, refContract)

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });

    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();
  });

  it("Successfull native token sale happy pat with Referral", async function () {
    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    expect(await refModule.getRefContract()).to.be.equal(await refContract.getAddress());

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // check that all money are on the balance
    await expect(await hre.ethers.provider.getBalance(sale)).to.equal(12000);
    await expect(await refModule.getRefshareBalance()).to.equal(80);


    await sale.connect(saler).finalizeRef(100);

    // there were two codes with 4000 deposit, 8% sale fee and 25% of that is referral fee,
    // so the total must be 2 % from raise
    // remember that one code used was non existent

    await expect(await hre.ethers.provider.getBalance(refContract)).to.equal(80);
    await expect(await hre.ethers.provider.getBalance(sale)).to.equal(11920);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("Reward shall be withdrawable", async function () {
    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // ensure balances are transferred
    await expect(sale.connect(saler).finalizeRef(100)).to.changeEtherBalances([refContract, sale], [80, -80]);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    await expect(refContract.connect(refer).claimCode("someCode")).to.changeEtherBalances([refContract, refer], [-40, 40]);
    await expect(refContract.connect(refer).claimCode("coolCode")).to.changeEtherBalances([refContract, refer], [-40, 40]);
    await expect(refContract.connect(refer).claimCode("non existing code")).to.revertedWithCustomError(refContract, refError.CodeDoesntExist);
  });

  it("Withdraw empty code", async function () {
    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });

    await expect(refContract.connect(refer).claimCode("someCode")).to.revertedWithCustomError(refContract, refError.NothingToClaim);
  });


  it("Withdraw code which doesn't belong to ya", async function () {
    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });

    await expect(refContract.connect(depositor3).claimCode("someCode")).to.revertedWithCustomError(refContract, refError.CodeDoesntBelongToCaller);
  });

  it("Code shall require payment", async function () {
    //fails when paid less than needed
    await expect(refContract.connect(refer).createReferralCode("fwsad",)).to.revertedWithCustomError(refContract, refError.PayForCreation);
    await expect(refContract.connect(refer).createReferralCode("dasd", { value: 99n })).to.revertedWithCustomError(refContract, refError.PayForCreation);

    // works when paid enough
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.emit(refContract, "ReferralCodeCreated")
      .withArgs('vzxvsd', refer);;
  });

  it("Admin shall create codes for free", async function () {
    await expect(refContract.connect(deployer).createReferralCodeAdmin("aaaa")).to.emit(refContract, "ReferralCodeCreated")
      .withArgs('aaaa', deployer);
    await expect(refContract.connect(deployer).createReferralCodeAdmin("czxc")).to.emit(refContract, "ReferralCodeCreated")
      .withArgs('czxc', deployer);
  });

  it("Non-Admin shall not create codes for free", async function () {
    await expect(refContract.connect(saler).createReferralCodeAdmin("aaaa")).to.revertedWithCustomError(refContract, refError.OwnableUnauthorizedAccount);

  });

  it("Unable to create similar codes", async function () {
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.emit(refContract, "ReferralCodeCreated")
      .withArgs('vzxvsd', refer);
    await expect(refContract.connect(refer).createReferralCode("vzxvsd", { value: 100n })).to.revertedWithCustomError(refContract, refError.CodeAlreadyExists)
  });

  it("USDT test", async function () {
    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), usdt.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(false, usdt.getAddress(), usdt.getAddress(), usdc.getAddress(), dai.getAddress(), refContract)

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();

    await usdt.transfer(await depositor1.getAddress(), hre.ethers.parseEther("10000"));
    await usdt.transfer(await depositor2.getAddress(), hre.ethers.parseEther("10000"));
    await usdt.transfer(await depositor3.getAddress(), hre.ethers.parseEther("10000"));

    usdt.connect(depositor1).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdt.connect(depositor2).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdt.connect(depositor3).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // check that all money are on the balance
    await expect(await usdt.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeRef(100);

    // there were two codes with 4000 deposit, 8% sale fee and 25% of that is referral fee,
    // so the total must be 2 % from raise
    // remember that one code used was non existent

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

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(false, usdc.getAddress(), usdt.getAddress(), usdc.getAddress(), dai.getAddress(), refContract)

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();

    await usdc.transfer(await depositor1.getAddress(), hre.ethers.parseEther("10000"));
    await usdc.transfer(await depositor2.getAddress(), hre.ethers.parseEther("10000"));
    await usdc.transfer(await depositor3.getAddress(), hre.ethers.parseEther("10000"));

    usdc.connect(depositor1).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdc.connect(depositor2).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    usdc.connect(depositor3).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // check that all money are on the balance
    await expect(await usdc.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeRef(100);

    // there were two codes with 4000 deposit, 8% sale fee and 25% of that is referral fee,
    // so the total must be 2 % from raise
    // remember that one code used was non existent

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

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(false, dai.getAddress(), usdt.getAddress(), usdc.getAddress(), dai.getAddress(), refContract)

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();

    await dai.transfer(await depositor1.getAddress(), hre.ethers.parseEther("10000"));
    await dai.transfer(await depositor2.getAddress(), hre.ethers.parseEther("10000"));
    await dai.transfer(await depositor3.getAddress(), hre.ethers.parseEther("10000"));

    dai.connect(depositor1).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    dai.connect(depositor2).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    dai.connect(depositor3).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // check that all money are on the balance
    await expect(await dai.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeRef(100);

    // there were two codes with 4000 deposit, 8% sale fee and 25% of that is referral fee,
    // so the total must be 2 % from raise
    // remember that one code used was non existent

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

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(false, usdt.getAddress(), usdt.getAddress(), usdc.getAddress(), dai.getAddress(), refContract)

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await expect(refModule.connect(refer).init(sale)).to.revertedWithCustomError(refModule, refError.OwnableUnauthorizedAccount)
    await refModule.connect(saler).init(sale);
    await expect(refModule.connect(saler).init(sale)).to.revertedWithCustomError(refModule, refError.InitProblem)
  });

  it("Only parent sale can process depositse", async function () {
    await expect(refModule.connect(refer).processReferralCode("code", 1_000n)).to.revertedWithCustomError(refModule, refError.OnlyParentContract)
    await expect(refModule.connect(refer).finalizeReferralCodes(10)).to.revertedWithCustomError(refModule, refError.OnlyParentContract)
  });

  it("Partial finalization test", async function () {
    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    expect(await refModule.getRefContract()).to.be.equal(await refContract.getAddress());

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("1", { value: 100n });
    await refContract.connect(refer).createReferralCode("2", { value: 100n });
    await refContract.connect(refer).createReferralCode("3", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("1", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("2", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("3", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("1", { value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    await sale.connect(saler).finalizeRef(1);

    await expect(await refModule.isFinalized()).to.equal(false);

    await sale.connect(saler).finalizeRef(1);

    await expect(await refModule.isFinalized()).to.equal(false);
    await sale.connect(saler).finalizeRef(1);

    await expect(sale.connect(saler).finalizeRef(1)).to.revertedWithCustomError(sale, customError.AlreadyFinalizedRef);

    await expect(await refModule.isFinalized()).to.equal(true);
  });

  it("Random erc20 test", async function () {
    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    const randomToken = await saleTokenF.deploy("RND");

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), randomToken.getAddress(), true, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");
    refModule = await moduleFactory.connect(saler).deploy(false, randomToken.getAddress(), usdt.getAddress(), usdc.getAddress(), dai.getAddress(), refContract)

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    await refModule.connect(saler).init(sale);
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();

    await randomToken.transfer(await depositor1.getAddress(), hre.ethers.parseEther("10000"));
    await randomToken.transfer(await depositor2.getAddress(), hre.ethers.parseEther("10000"));
    await randomToken.transfer(await depositor3.getAddress(), hre.ethers.parseEther("10000"));

    randomToken.connect(depositor1).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    randomToken.connect(depositor2).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    randomToken.connect(depositor3).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))

    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithERC20(2_000n, "someCode");
    await sale.connect(depositor2).buyTokensWithERC20(4_000n, "non existent code");
    await sale.connect(depositor3).buyTokensWithERC20(2_000n, "coolCode");
    await sale.connect(depositor1).buyTokensWithERC20(4_000n, "");

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // check that all money are on the balance
    await expect(await randomToken.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeRef(100);

    // token unsupported, no ref
    await expect(await randomToken.balanceOf(refContract)).to.equal(0);
    await expect(await randomToken.balanceOf(sale)).to.equal(12000);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");

    await expect(await sale.startTime()).to.equal(startTime);
    await expect(await sale.endTime()).to.equal(endTime);
  });

  it("Owner can delete code", async function () {
    const startTime = await getBlockTime();;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      params.liquidityPt,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
      refModule.getAddress()
    );

    assert(await sale.finished() == false, "Sale active after init");

    await refContract.connect(refer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(refer).createReferralCode("coolCode", { value: 100n });

    await sale.connect(depositor1).buyTokensWithNative("someCode", { value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative("non existing code", { value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative("coolCode", { value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative("", { value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    // ensure balances are transferred
    await expect(sale.connect(saler).finalizeRef(100)).to.changeEtherBalances([refContract, sale], [80, -80]);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    await expect(refContract.connect(deployer).deleteReferralCode("coolCode")).to.changeEtherBalances([refContract, refer], [-40, 40]);
    await expect(refContract.connect(deployer).deleteReferralCode("someCode")).to.changeEtherBalances([refContract, refer], [-40, 40]);
    await expect(refContract.connect(deployer).deleteReferralCode("someCode")).to.revertedWithCustomError(refContract, refError.CodeDoesntExist);

  });


  it("Can't unlock unlocked source", async function () {
    await refContract.connect(deployer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(deployer).addRegisteredFunds("someCode", 100, 0, 0, 0);
    await refContract.connect(deployer).unlockRegisteredFunds("someCode", { value: 100 });

    expect(refContract.connect(deployer).unlockRegisteredFunds("someCode", { value: 100 })).to.revertedWithCustomError(refContract, refError.AlreadyUnlocked)

  });

  it("Remove funds", async function () {
    await refContract.connect(deployer).createReferralCode("someCode", { value: 100n });
    await refContract.connect(deployer).addRegisteredFunds("someCode", 100, 0, 0, 0);
    await refContract.connect(deployer).unlockRegisteredFunds("someCode", { value: 100 });

    expect(refContract.connect(deployer).unlockRegisteredFunds("someCode", { value: 100 })).to.revertedWithCustomError(refContract, refError.AlreadyUnlocked)

  });

  it("USDT/DAI/USDC should be defined", async function () {
    const referralFactory = await hre.ethers.getContractFactory("ReferralContract")
    refContract = await referralFactory.deploy(await usdt.getAddress(), await usdc.getAddress(), await dai.getAddress(), 100, params.treasury);

    expect(referralFactory.deploy('0x0000000000000000000000000000000000000000', usdc.getAddress(), dai.getAddress(), params.fee, params.treasury));
    expect(referralFactory.deploy(usdt.getAddress(), '0x0000000000000000000000000000000000000000', dai.getAddress(), params.fee, params.treasury));
    expect(referralFactory.deploy(usdt.getAddress(), usdc.getAddress(), '0x0000000000000000000000000000000000000000', params.fee, params.treasury));
  });

  it("Can't unlock unlocked source", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", 100, 100, 100, 100)).to.emit(refContract, "FundsAdded").withArgs("someCode", 100, 100, 100, 100);
    await usdt.connect(saler).approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));
    await usdc.approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));
    await dai.approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));

    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode", { value: 100 })).to.changeTokenBalances(usdt, [refAddress, saler], [100, -100]);
  });


  it("remove funds example", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", 100, 100, 100, 100)).to.emit(refContract, "FundsAdded").withArgs("someCode", 100, 100, 100, 100);
    await expect(refContract.connect(saler).removeRegisteredFunds("someCode", 100, 0, 100, 100)).to.emit(refContract, "FundsRemoved").withArgs("someCode", 100, 0, 100, 100);

    await usdt.connect(saler).approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));
    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode")).to.emit(usdt, "Transfer");
  });

  it("Can't unlock unlocked source", async function () {
    const refAddress = await refContract.getAddress();
    await refContract.connect(saler).createReferralCode("someCode", { value: 100n });
    await expect(refContract.connect(saler).addRegisteredFunds("someCode", 100, 100, 100, 100)).to.emit(refContract, "FundsAdded").withArgs("someCode", 100, 100, 100, 100);
    await usdt.connect(saler).approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));
    await usdc.approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));
    await dai.approve(refAddress, hre.ethers.parseEther("10000000000000000000000000000000000000"));

    await expect(refContract.connect(saler).unlockRegisteredFunds("someCode", { value: 100 })).to.emit(usdt, "Transfer").and.emit(usdc, "Transfer").and.emit(dai, "Transfer");

  });
});

