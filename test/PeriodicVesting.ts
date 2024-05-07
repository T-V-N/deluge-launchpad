import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol";
import { VestingContractFactory } from "../typechain-types";
import { PeriodicVesting } from "../typechain-types";
import { customError } from "./utils/errors";

async function getBlockTime() {
  const blockNum = await hre.ethers.provider.getBlockNumber();
  const block = await hre.ethers.provider.getBlock(blockNum);
  const ts = block?.timestamp || (Date.now() / 1000)

  return BigInt(ts)
}

describe("Periodic vesting", async function () {
  let treasury: ethers.Signer, locker: ethers.Signer, user1: ethers.Signer, user2: ethers.Signer, user3: ethers.Signer;
  let vestingF: VestingContractFactory, vestedToken: ERC20Token, vesting: PeriodicVesting;

  let ts: bigint;

  beforeEach(async function () {
    [, treasury, locker, user1, user2, user3] = await hre.ethers.getSigners();

    const vestedTokenF = await hre.ethers.getContractFactory("ERC20Token", locker);
    vestedToken = await vestedTokenF.deploy("VTKN");

    const vestingFactoryFactory = await hre.ethers.getContractFactory("VestingContractFactory")
    vestingF = await vestingFactoryFactory.deploy(treasury.getAddress(), 1000);
    ts = (await getBlockTime());

    await vestingF.connect(locker).createPeriodicVestingContract(
      vestedToken.getAddress(),
      ts + 600n, //start in a minute
      0,
      10n * BigInt(10 ** 18),
      360,
      15n * BigInt(10 ** 18),
      { value: 1000 });

    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1)
    const event = events[0]
    const vestingAddress = event.args[0];

    await vestedToken.connect(locker).approve(vestingAddress, 10000000000n * BigInt(10 ** 18));

    vesting = await hre.ethers.getContractAt("PeriodicVesting", vestingAddress);

    await vesting.connect(locker).setAllocations([user1.getAddress(), user2.getAddress(), user3.getAddress()], [300n * BigInt(10 ** 18), 200n * BigInt(10 ** 18), 500n * BigInt(10 ** 18)]);
  });

  it("Successfull vesting happy path", async function () {
    //initially user can't claim
    await expect(vesting.connect(user1).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    await expect(vesting.connect(user2).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    await expect(vesting.connect(user3).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    //advance time

    await hre.ethers.provider.send("evm_increaseTime", [600]); // 10 mins forward
    await hre.ethers.provider.send("evm_mine");

    // first two claim their batch as soon as it available
    await vesting.connect(user1).claim();
    await vesting.connect(user2).claim();

    // first unlock is 10%
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(30n * BigInt(10 ** 18))
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(20n * BigInt(10 ** 18))
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(0)

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [360]); // 5 min forward
    await hre.ethers.provider.send("evm_mine");

    // first and three claim their batch
    await vesting.connect(user1).claim();
    await vesting.connect(user3).claim();

    // second periodic unlock is 15%
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(75n * BigInt(10 ** 18)) // 10% + 15% from 300 is 75
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(20n * BigInt(10 ** 18)) // same
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(125n * BigInt(10 ** 18)) // 10% + 15% from 500 is 125

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [4 * 360]); // 25 min forward
    await hre.ethers.provider.send("evm_mine");

    // second and third claim their batch
    await vesting.connect(user2).claim();
    await vesting.connect(user3).claim();

    // second periodic unlock is 4* 15%
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(75n * BigInt(10 ** 18)) // same
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(170n * BigInt(10 ** 18)) // 10% + 15% + (4*15%) => 85% from 200 is 170
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(425n * BigInt(10 ** 18)) //10% + 15% + (4*15%) => 85% from 500 is 425

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [360]); // 5 min forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user2).claim();
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18)) // should be fully unlocked

    // one eternity later
    await hre.ethers.provider.send("evm_increaseTime", [4 * 36000]); // some years later
    await hre.ethers.provider.send("evm_mine");

    // second and third claim their batch
    await vesting.connect(user1).claim();
    await expect(vesting.connect(user2).claim()).to.be.revertedWithCustomError(vesting, customError.nothingToClaim);
    await vesting.connect(user3).claim();

    // second periodic unlock is 4* 15%
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(300n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(500n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(vesting.getAddress())).to.be.equal(0) // contract's empty
  });

  it("should initialize the contract with correct values", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 10n * BigInt(10 ** 18); // 10%
    const unlockPeriod = 3600n; // 1 hour
    const unlockPeriodPercent = 15n * BigInt(10 ** 18); // 15%

    await vestingF.connect(locker).createPeriodicVestingContract(
      vestedToken.getAddress(),
      startDate + 60,
      cliffPeriod,
      firstUnlockPercent,
      unlockPeriod,
      unlockPeriodPercent,
      { value: 1000 }
    );

    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1)
    const event = events[0]
    const vestingAddress = event.args[0];

    await vestedToken.connect(locker).transfer(vestingAddress, 1000n * BigInt(10 ** 18));

    vesting = await hre.ethers.getContractAt("PeriodicVesting", vestingAddress);

    assert.equal(await vesting.owner(), await locker.getAddress());
    assert.equal(await vesting.erc20Token(), await vestedToken.getAddress());
    assert.equal(await vesting.startDate(), BigInt(startDate) + 60n);
    assert.equal(await vesting.cliffPeriod(), cliffPeriod);
    assert.equal(await vesting.firstUnlockPercent(), firstUnlockPercent);
    assert.equal(await vesting.unlockPeriod(), unlockPeriod);
    assert.equal(await vesting.unlockPeriodPercent(), unlockPeriodPercent);
  });

  it("should revert if ERC20 token address is zero", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 10n * BigInt(10 ** 18); // 10%
    const unlockPeriod = 3600n; // 1 hour
    const unlockPeriodPercent = 15n * BigInt(10 ** 18); // 15%

    await expect(
      vestingF.connect(locker).createPeriodicVestingContract(
        "0x0000000000000000000000000000000000000000",
        startDate + 60,
        cliffPeriod,
        firstUnlockPercent,
        unlockPeriod,
        unlockPeriodPercent,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.erc20TokenNotZeroAddress);
  });

  it("should revert if start date is before the current block timestamp", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 10n * BigInt(10 ** 18); // 10%
    const unlockPeriod = 3600n; // 1 hour
    const unlockPeriodPercent = 15n * BigInt(10 ** 18); // 15%

    await expect(
      vestingF.connect(locker).createPeriodicVestingContract(
        vestedToken.getAddress(),
        startDate - 60, // Before current timestamp
        cliffPeriod,
        firstUnlockPercent,
        unlockPeriod,
        unlockPeriodPercent,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.startDateMustBeGreaterThanCurrentTime);
  });

  it("should revert if unlock period is zero", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 10n * BigInt(10 ** 18); // 10%
    const unlockPeriodPercent = 15n * BigInt(10 ** 18); // 15%

    await expect(
      vestingF.connect(locker).createPeriodicVestingContract(
        vestedToken.getAddress(),
        startDate + 60,
        cliffPeriod,
        firstUnlockPercent,
        0, // Zero unlock period
        unlockPeriodPercent,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.unlockPeriodNotZero);
  });

  it("should revert if unlock period percent is zero", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 10n * BigInt(10 ** 18); // 10%
    const unlockPeriod = 3600n; // 1 hour

    await expect(
      vestingF.connect(locker).createPeriodicVestingContract(
        vestedToken.getAddress(),
        startDate + 60,
        cliffPeriod,
        firstUnlockPercent,
        unlockPeriod,
        0, // Zero unlock period percent
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.unlockPeriodPercentNotZero);
  });

  it("should revert if first unlock percent is greater than the maximum allowed", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    const cliffPeriod = 3600n; // 1 hour
    const firstUnlockPercent = 200n * BigInt(10 ** 18); // 200%
    const unlockPeriod = 3600n; // 1 hour
    const unlockPeriodPercent = 15n * BigInt(10 ** 18); // 15%

    await expect(
      vestingF.connect(locker).createPeriodicVestingContract(
        vestedToken.getAddress(),
        startDate + 60,
        cliffPeriod,
        firstUnlockPercent,
        unlockPeriod,
        unlockPeriodPercent,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.firstUnlockTooBig);
  });

  it("should set allocation for a single address", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    const allocation = await vesting.allocations(user1.getAddress());
    assert.equal(allocation.amount, amount);
  });

  it("should set allocations for multiple addresses", async function () {
    const amounts = [
      500n * BigInt(10 ** 18), // 500 tokens
      800n * BigInt(10 ** 18), // 800 tokens
      1200n * BigInt(10 ** 18), // 1200 tokens
    ];
    const addresses = [user1.getAddress(), user2.getAddress(), user3.getAddress()];

    await vesting.connect(locker).setAllocations(addresses, amounts);

    for (let i = 0; i < addresses.length; i++) {
      const allocation = await vesting.allocations(addresses[i]);
      assert.equal(allocation.amount, amounts[i]);
    }
  });

  it("should revert setting allocation after the vesting start date", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await expect(
      vesting.connect(locker).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(vesting, customError.cantChangeOngoingVesting);
  });

  it("should revert setting allocation with a zero address", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await expect(
      vesting.connect(locker).setAllocation("0x0000000000000000000000000000000000000000", amount)
    ).to.be.revertedWithCustomError(vesting, customError.accountNotZeroAddress);
  });

  it("should revert setting allocation for an already claimed address", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim(); // claim tokens

    await expect(
      vesting.connect(locker).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(vesting, customError.cantChangeOngoingVesting);
  });

  it("should revert setting allocations with arrays of different lengths", async function () {
    const amounts = [
      500n * BigInt(10 ** 18), // 500 tokens
      800n * BigInt(10 ** 18), // 800 tokens
    ];
    const addresses = [user1.getAddress(), user2.getAddress(), user3.getAddress()];

    await expect(
      vesting.connect(locker).setAllocations(addresses, amounts)
    ).to.be.revertedWithCustomError(vesting, customError.arrayLengthshNotEqual);
  });

  it("should revert if there are no tokens to claim", async function () {
    await expect(
      vesting.connect(user1).claim()
    ).to.be.revertedWithCustomError(vesting, customError.nothingToClaim);
  });

  it("should allow users to claim their vested tokens", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    const initialBalance = await vestedToken.balanceOf(user1.getAddress());

    // Advance time to allow for claiming
    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim();

    const finalBalance = await vestedToken.balanceOf(user1.getAddress());

    assert.equal(finalBalance - initialBalance, amount);
  });

  it("should update claimed amount and claimed at timestamp after claiming", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    const initialClaimedAmount = (await vesting.allocations(user1.getAddress())).claimed;
    const initialClaimedAt = (await vesting.allocations(user1.getAddress())).claimedAt;

    // Advance time to allow for claiming
    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim();

    const finalClaimedAmount = (await vesting.allocations(user1.getAddress())).claimed;
    const finalClaimedAt = (await vesting.allocations(user1.getAddress())).claimedAt;

    assert(finalClaimedAmount > initialClaimedAmount);
    assert(finalClaimedAt > initialClaimedAt);
  });

  it("should revert if claiming for an address that has already claimed all tokens", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    // Advance time to allow for claiming
    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim();

    await expect(
      vesting.connect(user1).claim()
    ).to.be.revertedWithCustomError(vesting, customError.nothingToClaim);
  });

  it("should revert if claiming for an address that has not started claiming", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    await expect(
      vesting.connect(user1).claim()
    ).to.be.revertedWithCustomError(vesting, customError.nothingToClaim);
  });


  it("should allow only the owner to set allocation", async function () {
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await expect(
      vesting.connect(user1).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(vesting, customError.ownableUnauthorizedAccount);
  });

  it("should allow only the owner to set allocations", async function () {
    const amounts = [
      500n * BigInt(10 ** 18), // 500 tokens
      800n * BigInt(10 ** 18), // 800 tokens
    ];
    const addresses = [user1.getAddress(), user2.getAddress()];

    await expect(
      vesting.connect(user1).setAllocations(addresses, amounts)
    ).to.be.revertedWithCustomError(vesting, customError.ownableUnauthorizedAccount);
  });

  it("should allow only the owner to withdraw excess tokens", async function () {
    const amount = 100n * BigInt(10 ** 18); // 100 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    // Advance time to allow for claiming
    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim();

    await expect(
      vesting.connect(user1).withdrawNonUsed()
    ).to.be.revertedWithCustomError(vesting, customError.ownableUnauthorizedAccount);
  });

  it("should allow the owner to withdraw excess tokens", async function () {
    const amount = 100n * BigInt(10 ** 18); // 100 tokens
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);

    // Advance time to allow for claiming
    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    await vesting.connect(user1).claim();

    const initialContractBalance = await vestedToken.balanceOf(vesting.getAddress());

    await vesting.connect(locker).withdrawNonUsed();

    const finalContractBalance = await vestedToken.balanceOf(vesting.getAddress());

    assert(finalContractBalance < initialContractBalance);
  });

  it("should return firstUnlockAmount if timestamp is before cliffPeriod and claimed is 0", async function () {
    const blockNum = await hre.ethers.provider.getBlockNumber();
    const block = await hre.ethers.provider.getBlock(blockNum);
    const startDate = block?.timestamp || (Date.now() / 1000);

    await vestingF.connect(locker).createPeriodicVestingContract(
      vestedToken.getAddress(),
      ts + 600n,
      startDate,
      10n * BigInt(10 ** 18),
      36000,
      15n * BigInt(10 ** 18),
      { value: 1000 });


    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1)
    const event = events[0]
    const vestingAddress = event.args[0];

    await vestedToken.connect(locker).approve(vestingAddress, 1000n * BigInt(10 ** 18));

    const cliffVesting = await hre.ethers.getContractAt("PeriodicVesting", vestingAddress);
    const amount = 1000n * BigInt(10 ** 18); // 1000 tokens
    await cliffVesting.connect(locker).setAllocation(user1.getAddress(), amount);

    await hre.ethers.provider.send("evm_increaseTime", [3600]); // move 1 hour forward
    await hre.ethers.provider.send("evm_mine");

    const firstUnlockAmount = 100n * BigInt(10 ** 18); // 100 tokens
    const claimAmount = await cliffVesting.calculateClaimAmount(user1.getAddress());

    assert.equal(claimAmount, firstUnlockAmount);
  });

});

