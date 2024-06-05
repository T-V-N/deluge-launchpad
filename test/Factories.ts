import { assert, expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { ERC20Token } from "../typechain-types/contracts/ERC20.sol";
import { Sale } from "../typechain-types/contracts/Sale";
import { SaleContractFactory } from "../typechain-types";
import { BSCPancakeswapV2Locker } from "../typechain-types";
import { ReferralContract } from "../typechain-types";
import { ReferralModule__factory } from "../typechain-types";
import { UniswapV2Deployer } from "./utils/Uniswap";

import { params } from "../utils/common";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { refError } from "./utils/refErrors";
import { factoryErrors } from "./utils/factoryErrors";
import { getBlockTime } from "./utils/getBlockTime";


describe("Sale factory tests", async function () {
  let deployer: SignerWithAddress, saler: SignerWithAddress, depositor1: SignerWithAddress, depositor2: SignerWithAddress, depositor3: SignerWithAddress, signer: SignerWithAddress;
  let saleToken: ERC20Token, locker: BSCPancakeswapV2Locker;
  let refContract: ReferralContract, moduleFactory: ReferralModule__factory, usdt: ERC20Token, usdc: ERC20Token, dai: ERC20Token;

  let ts: number;

  it("Sale Setters", async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] = await ethers.getSigners();

    const lockerF = await hre.ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const {
      uniFactory,
      router,
    } = await uniswap.deploy(signer);

    let uniRouterAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
    let uniFactoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

    if (hre.network.name == 'hardhat') {
      uniRouterAddress = await router.getAddress();
      uniFactoryAddress = await uniFactory.getAddress();
    }

    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    const referralFactory = await hre.ethers.getContractFactory("ReferralContract")
    refContract = await referralFactory.deploy(usdt.getAddress(), usdc.getAddress(), dai.getAddress(), 100, params.treasury);

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");

    const launchF = await hre.ethers.getContractFactory("SaleContractFactory", deployer);
    const factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury, refContract);

    await factory.connect(saler).createSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    const sale = await hre.ethers.getContractAt("Sale", saleAddress)

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", refContract)
    await refModule.init(sale);

    await factory.setSaleFee(1_500_000n);
    await factory.setRaiseFee(1_000_000n);
    await factory.setLocker(await signer.getAddress());
    await factory.setTreasury(await depositor2.getAddress())


    assert(await factory.saleFee() == 1_500_000n, "Sale fee not set")
    assert(await factory.raiseFee() == 1_000_000n, "Sale fee not set")
    assert(await factory.locker() == await signer.getAddress(), "New locker not set")
    assert(await factory.treasury() == await depositor2.getAddress(), "New treasury not set")
    await expect(factory.connect(depositor1).setSaleFee(1_500_000n)).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setRaiseFee(1_000_000n)).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setLocker(await signer.getAddress())).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setTreasury(await depositor2.getAddress())).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, "0x0000000000000000000000000000000000000000", refContract)).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);
    await expect(launchF.deploy("0x0000000000000000000000000000000000000000", params.fee, params.raiseFee, params.treasury, refContract)).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);

    await expect(factory.connect(saler).createSaleContract("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee })).revertedWithCustomError(factory, factoryErrors.ProvideToken);
    await expect(factory.connect(saler).createSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee - 1n })).revertedWithCustomError(factory, factoryErrors.PayForCreation);



  });

  it("Uncapped Sale Setters and emptiness checks", async function () {
    [deployer, saler, depositor1, depositor2, depositor3, signer] = await ethers.getSigners();

    const lockerF = await hre.ethers.getContractFactory("BSCPancakeswapV2Locker");
    locker = await lockerF.deploy();

    const uniswap = new UniswapV2Deployer();
    const {
      uniFactory,
      router,
    } = await uniswap.deploy(signer);

    let uniRouterAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
    let uniFactoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

    if (hre.network.name == 'hardhat') {
      uniRouterAddress = await router.getAddress();
      uniFactoryAddress = await uniFactory.getAddress();
    }

    const saleTokenF = await hre.ethers.getContractFactory("ERC20Token", saler);
    saleToken = await saleTokenF.deploy("SALETOKEN");
    usdt = await saleTokenF.deploy("USDT");
    usdc = await saleTokenF.deploy("USDC");
    dai = await saleTokenF.deploy("DAI");

    const referralFactory = await hre.ethers.getContractFactory("ReferralContract")
    refContract = await referralFactory.deploy(usdt.getAddress(), usdc.getAddress(), dai.getAddress(), 100, params.treasury);

    moduleFactory = await hre.ethers.getContractFactory("ReferralModule");

    const launchF = await hre.ethers.getContractFactory("UncappedSaleContractFactory", deployer);
    const factory = await launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, params.treasury, refContract);

    await factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee });
    const filter = factory.filters.SaleContractCreated;
    const events = await factory.queryFilter(filter, -1)
    const event = events[0]
    const saleAddress = event.args[0];

    const sale = await hre.ethers.getContractAt("Sale", saleAddress)

    const refModule = await moduleFactory.deploy(true, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", refContract)
    await refModule.init(sale);

    await factory.setSaleFee(1_500_000n);
    await factory.setRaiseFee(1_000_000n);
    await factory.setLocker(await signer.getAddress());
    await factory.setTreasury(await depositor2.getAddress())


    assert(await factory.saleFee() == 1_500_000n, "Sale fee not set")
    assert(await factory.raiseFee() == 1_000_000n, "Sale fee not set")
    assert(await factory.locker() == await signer.getAddress(), "New locker not set")
    assert(await factory.treasury() == await depositor2.getAddress(), "New treasury not set")
    await expect(factory.connect(depositor1).setSaleFee(1_500_000n)).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setRaiseFee(1_000_000n)).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setLocker(await signer.getAddress())).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(factory.connect(depositor1).setTreasury(await depositor2.getAddress())).revertedWithCustomError(factory, refError.OwnableUnauthorizedAccount);
    await expect(launchF.deploy(locker.getAddress(), params.fee, params.raiseFee, "0x0000000000000000000000000000000000000000", refContract)).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);
    await expect(launchF.deploy("0x0000000000000000000000000000000000000000", params.fee, params.raiseFee, params.treasury, refContract)).revertedWithCustomError(factory, factoryErrors.ProvideLockerAndTreasury);

    await expect(factory.connect(saler).createUncappedSaleContract("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee })).revertedWithCustomError(factory, factoryErrors.ProvideToken);
    await expect(factory.connect(saler).createUncappedSaleContract(await saleToken.getAddress(), "0x0000000000000000000000000000000000000000", false, [], uniFactoryAddress, uniRouterAddress, { value: params.fee - 1n })).revertedWithCustomError(factory, factoryErrors.PayForCreation);
  });

});

