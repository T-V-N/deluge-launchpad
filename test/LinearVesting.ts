import { assert, expect } from "chai";
import hre from "hardhat";

import {
  VestingContractFactory,
  ERC20Token,
  LinearVesting,
} from "../typechain-types/index.js";

import { customError } from "./utils/vestingErrors.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

const { ethers, provider, networkHelpers } = await hre.network.connect();

describe("Linear vesting", async function () {
  const CLIFF = 600;
  const DURATION = 3600;

  let deployer: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    locker: HardhatEthersSigner,
    user1: HardhatEthersSigner,
    user2: HardhatEthersSigner,
    user3: HardhatEthersSigner;
  let vestingF: VestingContractFactory,
    vestedToken: ERC20Token,
    vesting: LinearVesting;

  let ts: number;

  beforeEach(async function () {
    [deployer, treasury, locker, user1, user2, user3] =
      await ethers.getSigners();

    const vestedTokenF = await ethers.getContractFactory("ERC20Token", locker);
    vestedToken = await vestedTokenF.deploy("VTKN");

    const vestingFactoryFactory = await ethers.getContractFactory(
      "VestingContractFactory"
    );
    vestingF = await vestingFactoryFactory.deploy(treasury.getAddress(), 1000);
    ts = await networkHelpers.time.latest();

    await vestingF
      .connect(locker)
      .createLinearVestingContract(
        vestedToken.getAddress(),
        ts + CLIFF,
        DURATION,
        {
          value: 1000,
        }
      );

    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1);
    const event = events[0];
    const vestingAddress = event.args[0];

    await vestedToken
      .connect(locker)
      .approve(vestingAddress, 1000000000000n * BigInt(10 ** 18));

    vesting = await ethers.getContractAt("LinearVesting", vestingAddress);

    await vesting
      .connect(locker)
      .setAllocations(
        [user1.getAddress(), user2.getAddress(), user3.getAddress()],
        [
          300n * BigInt(10 ** 18),
          200n * BigInt(10 ** 18),
          500n * BigInt(10 ** 18),
        ]
      );
  });

  it("Successfull linear vesting happy path", async function () {
    const vestingStart = ts + CLIFF;
    const vestingEnd = vestingStart + DURATION;
    const DURATION_N = BigInt(DURATION);

    await expect(vesting.connect(user1).claim()).revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
    await expect(vesting.connect(user2).claim()).revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
    await expect(vesting.connect(user3).claim()).revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );

    // 1/6 of vesting duration
    await networkHelpers.time.increaseTo(vestingStart + DURATION / 6);

    await vesting.connect(user1).claim();
    await vesting.connect(user2).claim();

    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(
      (300n * BigInt(10 ** 18) * 601n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(
      (200n * BigInt(10 ** 18) * 602n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(0);

    // 1/3 of vesting duration
    await networkHelpers.time.increaseTo(vestingStart + DURATION / 3);

    await vesting.connect(user1).claim();
    await vesting.connect(user3).claim();

    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(
      (300n * BigInt(10 ** 18) * 1201n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(
      (200n * BigInt(10 ** 18) * 602n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(
      (500n * BigInt(10 ** 18) * 1202n) / DURATION_N
    );

    // 2/3 of vesting duration
    await networkHelpers.time.increaseTo(vestingStart + (2 * DURATION) / 3);

    await vesting.connect(user2).claim();
    await vesting.connect(user3).claim();

    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(
      (300n * BigInt(10 ** 18) * 1201n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(
      (200n * BigInt(10 ** 18) * 2401n) / DURATION_N
    );
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(
      (500n * BigInt(10 ** 18) * 2402n) / DURATION_N
    );

    // Full vesting duration
    await networkHelpers.time.increaseTo(vestingEnd);

    await vesting.connect(user2).claim();
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(
      200n * BigInt(10 ** 18)
    );

    // Well past vesting end
    await networkHelpers.time.increaseTo(vestingEnd + 14400);

    await vesting.connect(user1).claim();
    await expect(vesting.connect(user2).claim()).to.be.revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
    await vesting.connect(user3).claim();

    expect(await vestedToken.balanceOf(user1.getAddress())).to.be.equal(
      300n * BigInt(10 ** 18)
    );
    expect(await vestedToken.balanceOf(user2.getAddress())).to.be.equal(
      200n * BigInt(10 ** 18)
    );
    expect(await vestedToken.balanceOf(user3.getAddress())).to.be.equal(
      500n * BigInt(10 ** 18)
    );
    expect(await vestedToken.balanceOf(vesting.getAddress())).to.be.equal(0);
  });

  it("should initialize the contract with correct values", async function () {
    await networkHelpers.mine();
    const startDate = (await networkHelpers.time.latest()) + 3;
    const vestingDuration = 3600n;

    await vestingF
      .connect(deployer)
      .createLinearVestingContract(
        vestedToken.getAddress(),
        startDate,
        vestingDuration,
        { value: 1000n }
      );

    const filter = vestingF.filters.VestingContractCreated;
    const events = await vestingF.queryFilter(filter, -1);
    const event = events[0];
    const vestingAddress = event.args[0];

    const vesting = await ethers.getContractAt("LinearVesting", vestingAddress);

    assert.equal(await vesting.owner(), await deployer.getAddress());
    assert.equal(await vesting.erc20Token(), await vestedToken.getAddress());
    assert.equal(await vesting.startDate(), BigInt(startDate));
    assert.equal(await vesting.unlockPeriod(), vestingDuration);
  });

  it("should revert if ERC20 token address is zero", async function () {
    const startDate = (await networkHelpers.time.latest()) + 3;
    await expect(
      vestingF
        .connect(locker)
        .createLinearVestingContract(
          "0x0000000000000000000000000000000000000000",
          startDate,
          3600n,
          { value: 1000 }
        )
    ).to.be.revertedWithCustomError(
      vesting,
      customError.erc20TokenNotZeroAddress
    );
  });

  it("should revert if start date is before the current block timestamp", async function () {
    const startDate = (await networkHelpers.time.latest()) + 3;
    await expect(
      vestingF
        .connect(locker)
        .createLinearVestingContract(
          vestedToken.getAddress(),
          startDate - 60,
          3600n,
          { value: 1000 }
        )
    ).to.be.revertedWithCustomError(
      vesting,
      customError.startDateMustBeGreaterThanCurrentTime
    );
  });

  it("should revert if unlock period is zero", async function () {
    const startDate = (await networkHelpers.time.latest()) + 3;
    await expect(
      vestingF
        .connect(locker)
        .createLinearVestingContract(vestedToken.getAddress(), startDate, 0, {
          value: 1000,
        })
    ).to.be.revertedWithCustomError(vesting, customError.unlockPeriodNotZero);
  });

  it("should set allocation for a single address", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    const allocation = await vesting.allocations(user1.getAddress());
    assert.equal(allocation.amount, amount);
  });

  it("should set allocations for multiple addresses", async function () {
    const amounts = [
      500n * BigInt(10 ** 18),
      800n * BigInt(10 ** 18),
      1200n * BigInt(10 ** 18),
    ];
    const addresses = [
      user1.getAddress(),
      user2.getAddress(),
      user3.getAddress(),
    ];
    await vesting.connect(locker).setAllocations(addresses, amounts);
    for (let i = 0; i < addresses.length; i++) {
      const allocation = await vesting.allocations(addresses[i]);
      assert.equal(allocation.amount, amounts[i]);
    }
  });

  it("should revert setting allocation after the vesting start date", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await provider.send("evm_increaseTime", [3600]);
    await provider.send("evm_mine");
    await expect(
      vesting.connect(locker).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(
      vesting,
      customError.cantChangeOngoingVesting
    );
  });

  it("should revert setting allocation with a zero address", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await expect(
      vesting
        .connect(locker)
        .setAllocation("0x0000000000000000000000000000000000000000", amount)
    ).to.be.revertedWithCustomError(vesting, customError.accountNotZeroAddress);
  });

  it("should revert setting allocation for an already claimed address", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    await provider.send("evm_increaseTime", [3600]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    await expect(
      vesting.connect(locker).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(
      vesting,
      customError.cantChangeOngoingVesting
    );
  });

  it("should revert setting allocations with arrays of different lengths", async function () {
    const amounts = [500n * BigInt(10 ** 18), 800n * BigInt(10 ** 18)];
    const addresses = [
      user1.getAddress(),
      user2.getAddress(),
      user3.getAddress(),
    ];
    await expect(
      vesting.connect(locker).setAllocations(addresses, amounts)
    ).to.be.revertedWithCustomError(vesting, customError.ArrayLengthsNotEqual);
  });

  it("should revert if there are no tokens to claim", async function () {
    await expect(vesting.connect(user1).claim()).to.be.revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
  });

  it("should allow users to claim their vested tokens", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    const initialBalance = await vestedToken.balanceOf(user1.getAddress());
    await provider.send("evm_increaseTime", [4200]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    const finalBalance = await vestedToken.balanceOf(user1.getAddress());
    assert.equal(BigInt(finalBalance - initialBalance), amount);
  });

  it("should update claimed amount and claimed at timestamp after claiming", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    const initialClaimedAmount = (await vesting.allocations(user1.getAddress()))
      .claimed;
    const initialClaimedAt = (await vesting.allocations(user1.getAddress()))
      .claimedAt;
    await provider.send("evm_increaseTime", [3600]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    const finalClaimedAmount = (await vesting.allocations(user1.getAddress()))
      .claimed;
    const finalClaimedAt = (await vesting.allocations(user1.getAddress()))
      .claimedAt;
    assert(finalClaimedAmount > initialClaimedAmount);
    assert(finalClaimedAt > initialClaimedAt);
  });

  it("should revert if claiming for an address that has already claimed all tokens", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    await provider.send("evm_increaseTime", [4200]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    await expect(vesting.connect(user1).claim()).to.be.revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
  });

  it("should revert if claiming for an address that has not started claiming", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    await expect(vesting.connect(user1).claim()).to.be.revertedWithCustomError(
      vesting,
      customError.nothingToClaim
    );
  });

  it("should allow only the owner to set allocation", async function () {
    const amount = 1000n * BigInt(10 ** 18);
    await expect(
      vesting.connect(user1).setAllocation(user1.getAddress(), amount)
    ).to.be.revertedWithCustomError(
      vesting,
      customError.ownableUnauthorizedAccount
    );
  });

  it("should allow only the owner to set allocations", async function () {
    const amounts = [500n * BigInt(10 ** 18), 800n * BigInt(10 ** 18)];
    const addresses = [user1.getAddress(), user2.getAddress()];
    await expect(
      vesting.connect(user1).setAllocations(addresses, amounts)
    ).to.be.revertedWithCustomError(
      vesting,
      customError.ownableUnauthorizedAccount
    );
  });

  it("should allow only the owner to withdraw excess tokens", async function () {
    const amount = 100n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    await provider.send("evm_increaseTime", [3600]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    await expect(
      vesting.connect(user1).withdrawNonUsed()
    ).to.be.revertedWithCustomError(
      vesting,
      customError.ownableUnauthorizedAccount
    );
  });

  it("should allow the owner to withdraw excess tokens", async function () {
    const amount = 100n * BigInt(10 ** 18);
    await vesting.connect(locker).setAllocation(user1.getAddress(), amount);
    await provider.send("evm_increaseTime", [3600]);
    await provider.send("evm_mine");
    await vesting.connect(user1).claim();
    const initialContractBalance = await vestedToken.balanceOf(
      vesting.getAddress()
    );
    await vesting.connect(locker).withdrawNonUsed();
    const finalContractBalance = await vestedToken.balanceOf(
      vesting.getAddress()
    );
    assert(finalContractBalance < initialContractBalance);
  });
});
