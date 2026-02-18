import { assert, expect } from "chai";
import hre from "hardhat";

import {
  BSCPancakeswapV2Locker,
  ERC20Token,
  Sale,
} from "../typechain-types/index.js";

import {
  ReferralModuleRefundable,
  ReferralContract,
  ReferralContract__factory,
  ReferralModuleRefundable__factory,
} from "../lib/deluge-referral/typechain-types/index.js";

import { UniswapV2Deployer } from "./utils/Uniswap.js";

import { params } from "../utils/common.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { refError } from "./utils/refErrors.js";
import { factoryErrors } from "./utils/factoryErrors.js";

const { ethers } = await hre.network.connect();

describe("Sale factory tests", async function () {
  let deployer: HardhatEthersSigner,
    saler: HardhatEthersSigner,
    depositor1: HardhatEthersSigner,
    depositor2: HardhatEthersSigner,
    depositor3: HardhatEthersSigner,
    signer: HardhatEthersSigner;
  let saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract,
    moduleFactory: ReferralModuleRefundable,
    usdt: ERC20Token,
    usdc: ERC20Token,
    dai: ERC20Token;

  let ts: number;

  it("Sale Setters", async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { weth9, uniFactory, router } = await uniswap.deploy(signer);

    let uniRouterAddress = await router.getAddress();
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

    moduleFactory = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    const launchF = await ethers.getContractFactory(
      "SaleContractFactory",
      deployer
    );
    const factory = await launchF.deploy(
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

    const sale = await ethers.getContractAt("Sale", saleAddress);

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    await refModule.init(sale);

    await factory.setSaleFee(1_500_000n);
    await factory.setRaiseFee(1_000_000n);
    await factory.setLocker(await signer.getAddress());
    await factory.setTreasury(await depositor2.getAddress());

    assert((await factory.saleFee()) == 1_500_000n, "Sale fee not set");
    assert((await factory.raiseFee()) == 1_000_000n, "Sale fee not set");
    assert(
      (await factory.locker()) == (await signer.getAddress()),
      "New locker not set"
    );
    assert(
      (await factory.treasury()) == (await depositor2.getAddress()),
      "New treasury not set"
    );
    await expect(
      factory.connect(depositor1).setSaleFee(1_500_000n)
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setRaiseFee(1_000_000n)
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setLocker(await signer.getAddress())
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setTreasury(await depositor2.getAddress())
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      launchF.deploy(
        locker.getAddress(),
        params.fee,
        params.raiseFee,
        "0x0000000000000000000000000000000000000000",
        refContract
      )
    ).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);
    await expect(
      launchF.deploy(
        "0x0000000000000000000000000000000000000000",
        params.fee,
        params.raiseFee,
        params.treasury,
        refContract
      )
    ).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);

    await expect(
      factory
        .connect(saler)
        .createSaleContract(
          "0x0000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000000",
          false,
          [],
          uniFactoryAddress,
          uniRouterAddress,
          { value: params.fee }
        )
    ).revertedWithCustomError(factory, factoryErrors.ProvideToken);
    await expect(
      factory
        .connect(saler)
        .createSaleContract(
          await saleToken.getAddress(),
          "0x0000000000000000000000000000000000000000",
          false,
          [],
          uniFactoryAddress,
          uniRouterAddress,
          { value: params.fee - 1n }
        )
    ).revertedWithCustomError(factory, factoryErrors.PayForCreation);
  });

  it("Uncapped Sale Setters and emptiness checks", async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] =
      await ethers.getSigners();

    const lockerF = await ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const { weth9, uniFactory, router } = await uniswap.deploy(signer);

    let uniRouterAddress = await router.getAddress();
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

    moduleFactory = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );

    const launchF = await ethers.getContractFactory(
      "UncappedSaleContractFactory",
      deployer
    );
    const factory = await launchF.deploy(
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

    const sale = await ethers.getContractAt("Sale", saleAddress);

    const refModule = await new ReferralModuleRefundable__factory(saler).deploy(
      refContract
    );
    await refModule.init(sale);

    await factory.setSaleFee(1_500_000n);
    await factory.setRaiseFee(1_000_000n);
    await factory.setLocker(await signer.getAddress());
    await factory.setTreasury(await depositor2.getAddress());

    assert((await factory.saleFee()) == 1_500_000n, "Sale fee not set");
    assert((await factory.raiseFee()) == 1_000_000n, "Sale fee not set");
    assert(
      (await factory.locker()) == (await signer.getAddress()),
      "New locker not set"
    );
    assert(
      (await factory.treasury()) == (await depositor2.getAddress()),
      "New treasury not set"
    );
    await expect(
      factory.connect(depositor1).setSaleFee(1_500_000n)
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setRaiseFee(1_000_000n)
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setLocker(await signer.getAddress())
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      factory.connect(depositor1).setTreasury(await depositor2.getAddress())
    ).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(
      launchF.deploy(
        locker.getAddress(),
        params.fee,
        params.raiseFee,
        "0x0000000000000000000000000000000000000000",
        refContract
      )
    ).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);
    await expect(
      launchF.deploy(
        "0x0000000000000000000000000000000000000000",
        params.fee,
        params.raiseFee,
        params.treasury,
        refContract
      )
    ).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);

    await expect(
      factory
        .connect(saler)
        .createUncappedSaleContract(
          "0x0000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000000",
          false,
          [],
          uniFactoryAddress,
          uniRouterAddress,
          { value: params.fee }
        )
    ).revertedWithCustomError(factory, factoryErrors.ProvideToken);
    await expect(
      factory
        .connect(saler)
        .createUncappedSaleContract(
          await saleToken.getAddress(),
          "0x0000000000000000000000000000000000000000",
          false,
          [],
          uniFactoryAddress,
          uniRouterAddress,
          { value: params.fee - 1n }
        )
    ).revertedWithCustomError(factory, factoryErrors.PayForCreation);
  });
});
