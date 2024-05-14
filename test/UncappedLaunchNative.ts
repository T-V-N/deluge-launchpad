import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol";
import { UncappedSale } from "../typechain-types/contracts/UncappedSale";
import { UncappedSaleContractFactory } from "../typechain-types";
import { BSCPancakeswapV2Locker } from "../typechain-types";

import { params } from "../utils/common";

import { customError } from "./utils/saleErrors";
import { getBlockTime } from "./utils/getBlockTime";

describe("Uncapped Sale tests", async function () {
  let deployer: ethers.Signer, saler: ethers.Signer, depositor1: ethers.Signer, depositor2: ethers.Signer, depositor3: ethers.Signer;
  let sale: UncappedSale, factory: UncappedSaleContractFactory, saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let ts: bigint;

  beforeEach(async function () {
    [deployer, saler, depositor1, depositor2, depositor3] = await hre.ethers.getSigners();

    const lockerF = await hre.ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");

    const launchF = await hre.ethers.getContractFactory("UncappedSaleContractFactory", deployer);
    factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury)

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", [], { value: params.fee });

    const launchCount = await factory.totalLaunchesCount();
    const saleAddress = await factory.launches(launchCount - 1n);

    sale = await hre.ethers.getContractAt("UncappedSale", saleAddress)
    saleToken.connect(saler).approve(await sale.getAddress(), hre.ethers.parseEther("10000000000000000000000000000000000000"))
    ts = await getBlockTime();
  });

  it("Successful token sale happy path", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      100_000_000n,
      params.soft,
      params.min,
      params.max,
      params.minLock,
    );

    assert(await sale.finished() == false, "Sale active after init");

    await sale.connect(depositor1).buyTokensWithNative({ value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative({ value: 4_000n });
    await sale.connect(depositor3).buyTokensWithNative({ value: 2_000n });
    await sale.connect(depositor1).buyTokensWithNative({ value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });
    assert(await sale.finished() == true, "Sale active after finish");
  });

  it("should allow adding multiple addresses to the whitelist", async function () {
    await expect(sale.connect(saler).addToWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]))
      .to.not.be.reverted;

    // Check if addresses are actually whitelisted
    expect(await sale.whitelist(await depositor1.getAddress())).to.be.true;
    expect(await sale.whitelist(await depositor2.getAddress())).to.be.true;
  });

  it("should allow removing addresses from the whitelist", async function () {
    // First add to the whitelist
    await sale.connect(saler).addToWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]);

    // Then remove from the whitelist
    await expect(sale.connect(saler).removeFromWhitelist([await depositor1.getAddress(), await depositor2.getAddress()]))
      .to.not.be.reverted;

    // Check if addresses are actually removed
    expect(await sale.whitelist(await depositor1.getAddress())).to.be.false;
    expect(await sale.whitelist(await depositor2.getAddress())).to.be.false;
  });

  it("should allow whitelisted addresses to buy tokens", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      hre.ethers.parseEther("1000"),
      params.soft,
      params.min,
      params.max,
      params.minLock,
    );

    // Whitelist depositor1 and depositor2
    await sale.connect(saler).addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);
    await expect(sale.connect(depositor1).buyTokensWithNative({ value: 100 }))
      .to.emit(sale, 'TokensPurchased')
      .withArgs(await depositor1.getAddress(), 100);

    await expect(sale.connect(depositor2).buyTokensWithNative({ value: 100 }))
      .to.emit(sale, 'TokensPurchased')
      .withArgs(await depositor2.getAddress(), 100);
  });

  it("should revert when non-whitelisted address tries to buy tokens", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      hre.ethers.parseEther("1000"),
      params.soft,
      params.min,
      params.max,
      params.minLock,
    );
    // Whitelist depositor1 and depositor2, not depositor3
    await sale.connect(saler).addToWhitelist([depositor1.getAddress(), depositor2.getAddress()]);
    await sale.connect(saler).setWhitelist(true);

    await expect(sale.connect(depositor3).buyTokensWithNative({ value: 100 }))
      .to.be.revertedWithCustomError(sale, customError.NotWhitelisted);
  });

  it("should handle refunds correctly when the soft cap is not reached", async function () {
    const startTime = ts;
    const endTime = startTime + 7200n;  // Longer duration for potential late transactions
    const depositAmount = 100;
    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      hre.ethers.parseEther("1000"),
      params.soft,
      params.min,
      params.max,
      params.minLock,
    );
    await sale.connect(depositor1).buyTokensWithNative({ value: depositAmount });

    // Fast forward past end time without reaching soft cap
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    await expect(sale.connect(depositor1).refund()).to.changeEtherBalance(depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

  it("should allow claiming of tokens after the sale is finalized", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;
    const tokensForSale = 1_000_000n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      tokensForSale,
      1_000_000n,
      1_000_000n,
      1_000_000n,
      params.minLock,
    );

    await sale.connect(depositor1).buyTokensWithNative({ value: 1_000_000n });

    // Finalizing the sale successfully
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");
    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    // Claiming tokens
    await expect(sale.connect(depositor1).claim()).to.changeTokenBalance(saleToken, depositor1, (await sale.getPrice()) * tokensForSale);
  });

  it("should prevent unauthorized users from initializing the sale", async function () {
    const startTime = ts - 100n;
    const endTime = startTime + 10n;

    // Attempt to initialize the sale from a non-owner account
    await expect(sale.connect(depositor1).initializeSale(startTime, endTime, 51, hre.ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock)).to.be.revertedWithCustomError;
  });

  it("should calculate the correct price per token dynamically", async function () {
    const tokensForSale = hre.ethers.parseEther("1000");
    const softCap = hre.ethers.parseEther("10"); // Soft cap reached at 10 ETH
    const startTime = ts;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      tokensForSale,
      softCap,
      softCap,
      softCap * 10n,
      params.minLock,
    );

    const priceAtSoftCap = await sale.getPrice();
    expect(priceAtSoftCap).to.equal(tokensForSale / softCap);

    // Simulate purchases to exceed soft cap
    const overSoftCap = softCap + (hre.ethers.parseEther("15"));
    await sale.connect(depositor1).buyTokensWithNative({ value: overSoftCap });

    const priceAfterExceedingSoftCap = await sale.getPrice();

    expect(priceAfterExceedingSoftCap).to.equal(tokensForSale / (overSoftCap));
  });

  it("should reject purchases below the minimum amount", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;

    const minPurchase = hre.ethers.parseEther("0.01")

    await sale.connect(saler).initializeSale(startTime, endTime, 51, hre.ethers.parseEther("1000"), params.soft, minPurchase, minPurchase * 10n, params.minLock);

    await expect(sale.connect(depositor1).buyTokensWithNative({
      value: hre.ethers.parseEther("0.001"),
    })).to.be.revertedWithCustomError(sale, customError.paymentOutsideMinMaxAmounts);
  });

  it("should not allow purchases after sale has ended", async function () {
    const startTime = ts;
    const endTime = startTime + 360n; // Sale duration is 1 hour

    await sale.connect(saler).initializeSale(startTime, endTime, 51, hre.ethers.parseEther("1000"), params.soft, params.min, params.max, params.minLock);
    await hre.ethers.provider.send("evm_increaseTime", [3600 * 2]); // Move time forward by 2 hours
    await hre.ethers.provider.send("evm_mine"); // Mine the next block to ensure the time has been set

    await expect(sale.connect(depositor1).buyTokensWithNative({
      value: params.min,
    })).to.be.revertedWithCustomError(sale, customError.outsideSaleTime);
  });

  it("should send ETH fee to the treasury on native token sale", async function () {
    const startTime = ts;
    const endTime = startTime + 3600n;

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      hre.ethers.parseEther("1000"),
      1_000,
      1_000n,
      hre.ethers.parseEther("1000"),
      params.minLock,
    );

    await sale.connect(depositor1).buyTokensWithNative({ value: 2_000n });
    await sale.connect(depositor2).buyTokensWithNative({ value: 4_000n });

    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    const treasuryInitialEthBalance = await hre.ethers.provider.getBalance(params.treasury);

    await sale.connect(saler).finalizeSale({ value: params.lockerFee });

    const newTreasuryEthBalance = await hre.ethers.provider.getBalance(params.treasury);
    const raised = (await sale.totalRaised()) * (params.raiseFee) / (100n);
    expect(newTreasuryEthBalance - (treasuryInitialEthBalance)).to.equal(raised, "Treasury should receive the ETH fee");
  });

  it("should correctly handle refunds when the soft cap is not reached", async function () {
    const startTime = ts;
    const endTime = startTime + 7200n; // 2 hours sale duration
    const depositAmount = hre.ethers.parseEther("1");

    await sale.connect(saler).initializeSale(
      startTime,
      endTime,
      51,
      hre.ethers.parseEther("1000"),
      hre.ethers.parseEther("10"), // Soft cap is 10 ETH
      hre.ethers.parseEther("1"),
      hre.ethers.parseEther("1"),
      params.minLock,
    );
    await sale.connect(depositor1).buyTokensWithNative({ value: depositAmount });

    // Move past end time without reaching soft cap
    await hre.ethers.provider.send("evm_increaseTime", [3 * 3600]); // 3 hours forward
    await hre.ethers.provider.send("evm_mine");

    await expect(sale.connect(depositor1).refund()).to.changeEtherBalance(depositor1, depositAmount);
    await expect(await sale.contributions(depositor1.getAddress())).to.equal(0);
  });

});
