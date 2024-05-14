import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol";
import { VestingContractFactory } from "../typechain-types";
import { LinearVesting } from "../typechain-types";
import { customError } from "./utils/vestingErrors";

async function getBlockTime() {
  const blockNum = await hre.ethers.provider.getBlockNumber();
  const block = await hre.ethers.provider.getBlock(blockNum);
  const ts = block?.timestamp || (Date.now() / 1000)

  return BigInt(ts)
}

describe("Linear vesting", async function () {
  let deployer: ethers.Signer, treasury: ethers.Signer, locker: ethers.Signer, user1: ethers.Signer, user2: ethers.Signer, user3: ethers.Signer;
  let vestingF: VestingContractFactory, vestedToken: ERC20Token, vesting: LinearVesting;

  let ts: bigint;

  beforeEach(async function () {
    [deployer, treasury, locker, user1, user2, user3] = await hre.ethers.getSigners();

    const vestedTokenF = await hre.ethers.getContractFactory("ERC20Token", locker);
    vestedToken = await vestedTokenF.deploy("VTKN");

    const vestingFactoryFactory = await hre.ethers.getContractFactory("VestingContractFactory")
    vestingF = await vestingFactoryFactory.deploy(treasury.getAddress(), 1000);
    ts = (await getBlockTime());

    await vestingF.connect(locker).createLinearVestingContract(
      vestedToken.getAddress(),
      ts + 600n, //start in 10 min
      3600n, //1hour
      { value: 1000 });

    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1)
    const event = events[0]
    const vestingAddress = event.args[0];

    await vestedToken.connect(locker).approve(vestingAddress, 1000000000000n * BigInt(10 ** 18));

    vesting = await hre.ethers.getContractAt("LinearVesting", vestingAddress);

    await vesting.connect(locker).setAllocations([user1.getAddress(), user2.getAddress(), user3.getAddress()], [300n * BigInt(10 ** 18), 200n * BigInt(10 ** 18), 500n * BigInt(10 ** 18)]);
  });

  it("Successfull linear vesting happy path", async function () {
    //initially user can't claim
    await expect(vesting.connect(user1).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    await expect(vesting.connect(user2).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    await expect(vesting.connect(user3).claim()).revertedWithCustomError(vesting, customError.nothingToClaim);
    //advance time

    await hre.ethers.provider.send("evm_increaseTime", [1193]); // 20 mins forward, also include two blocks 6 sec each
    await hre.ethers.provider.send("evm_mine");

    // first two claim their batch as soon as it available
    await vesting.connect(user1).claim();
    await vesting.connect(user2).claim();

    // first unlock is 1/6
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(300n * BigInt(10 ** 18) * 600n / 3600n)
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18) * 601n / 3600n) // 1/6 unlock plus unlock for 1 sec since 10 min passed out of 1hr
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(0)

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [600]); // 10 min forward minus second
    await hre.ethers.provider.send("evm_mine");

    // first and three claim their batch
    await vesting.connect(user1).claim(); //1 second
    await vesting.connect(user3).claim(); //1 second

    // second unlock 2/6
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(300n * BigInt(10 ** 18) * 1202n / 3600n)// 1/6 unlock plus unlock for 2 sec since 10 min passed out of 1hr
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18) * 601n / 3600n) // nothing happened
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(500n * BigInt(10 ** 18) * 1203n / 3600n) //  1/6 unlock plus unlock for 3 sec since 10 min passed out of 1hr

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [2 * 600]); // 20 min forward
    await hre.ethers.provider.send("evm_mine");

    // second and third claim their batch
    await vesting.connect(user2).claim();
    await vesting.connect(user3).claim();

    // second unlock half
    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(300n * BigInt(10 ** 18) * 1202n / 3600n)// 1/6 unlock plus unlock for 2 sec since 10 min passed out of 1hr
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18) * 2404n / 3600n) // nothing happened
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(500n * BigInt(10 ** 18) * 2405n / 3600n) //  1/6 unlock plus unlock for 3 sec since 10 min passed out of 1hr

    // pass some time
    await hre.ethers.provider.send("evm_increaseTime", [1200]); // 20 min forward
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

    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(300n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(200n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(500n * BigInt(10 ** 18)) // fully claimed
    expect(await vestedToken.balanceOf(vesting.getAddress())).to.be.equal(0) // contract's empty
  });

  it("should initialize the contract with correct values", async function () {
    const startDate = await getBlockTime() + 3n;
    const vestingDuration = 3600n; // 1 hour

    // Deploy the vesting contract
    await vestingF.connect(deployer).createLinearVestingContract(
      vestedToken.getAddress(),
      startDate,
      vestingDuration,
      { value: 1000n }
    );

    // Get the deployed vesting contract address
    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1);
    const event = events[0];
    const vestingAddress = event.args[0];

    // Get the deployed vesting contract instance
    const vesting = await hre.ethers.getContractAt("LinearVesting", vestingAddress);

    // Assert that the contract initialized with correct values
    assert.equal(await vesting.owner(), await deployer.getAddress());
    assert.equal(await vesting.erc20Token(), await vestedToken.getAddress());
    assert.equal(await vesting.startDate(), BigInt(startDate));
    assert.equal(await vesting.unlockPeriod(), vestingDuration);
  });

  it("should revert if ERC20 token address is zero", async function () {
    const startDate = await getBlockTime() + 3n;
    const unlockPeriod = 3600n; // 1 hour

    await expect(
      vestingF.connect(locker).createLinearVestingContract(
        "0x0000000000000000000000000000000000000000",
        startDate,
        unlockPeriod,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.erc20TokenNotZeroAddress);
  });

  it("should revert if start date is before the current block timestamp", async function () {
    const startDate = await getBlockTime();
    const unlockPeriod = 3600n; // 1 hour

    await expect(
      vestingF.connect(locker).createLinearVestingContract(
        vestedToken.getAddress(),
        startDate - 60n, // Before current timestamp
        unlockPeriod,
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.startDateMustBeGreaterThanCurrentTime);
  });

  it("should revert if unlock period is zero", async function () {
    const startDate = await getBlockTime() + 3n;

    await expect(
      vestingF.connect(locker).createLinearVestingContract(
        vestedToken.getAddress(),
        startDate,
        0, // Zero unlock period
        { value: 1000 }
      )
    ).to.be.revertedWithCustomError(vesting, customError.unlockPeriodNotZero);
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
    ).to.be.revertedWithCustomError(vesting, customError.ArrayLengthsNotEqual);
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
    await hre.ethers.provider.send("evm_increaseTime", [4200]); // move 1 hour forward
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
    await hre.ethers.provider.send("evm_increaseTime", [4200]); // move 1 hour forward
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
});

