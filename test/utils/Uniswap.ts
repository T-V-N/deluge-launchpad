import { BaseContract, ContractFactory } from "ethers";
import { abi as abiWeth, bytecode as bytecodeWeth } from "@uniswap/v2-periphery/build/WETH9.json";
import { abi as abiFactory, bytecode as bytecodeFactory } from "@uniswap/v2-core/build/UniswapV2Factory.json";
import {
  abi as abiRouter,
  bytecode as bytecodeRouter,
} from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

import IUniswapV2ERC20 from "@uniswap/v2-core/build/IUniswapV2ERC20.json";
import IUniswapV2Factory from "@uniswap/v2-core/build/IUniswapV2Factory.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import IUniswapV2Router02 from "@uniswap/v2-periphery/build/IUniswapV2Router02.json";

export interface InterfaceType {
  [name: string]: { abi: any; bytecode: any };
}

const Interface: InterfaceType = {
  IUniswapV2Pair,
  IUniswapV2ERC20,
  IUniswapV2Factory,
  IUniswapV2Router02,
};

async function deployWETH9(signer: SignerWithAddress) {
  const WETH9 = new ContractFactory(abiWeth, bytecodeWeth, signer);
  const weth9 = await WETH9.deploy();
  await weth9.deploymentTransaction()?.wait();
  return { weth9, WETH9 };
}

async function deployFactory(
  signer: SignerWithAddress,
  feeToSetter: SignerWithAddress
) {
  const Factory = new ContractFactory(abiFactory, bytecodeFactory, signer);
  const factory = await Factory.deploy(feeToSetter.address);
  await factory.deploymentTransaction()?.wait();
  return { factory, Factory };
}

async function deployRouter(
  signer: SignerWithAddress,
  factory: BaseContract,
  weth9: BaseContract
) {
  const Router = new ContractFactory(abiRouter, bytecodeRouter, signer);
  const router = await Router.deploy(await factory.getAddress(), await weth9.getAddress());
  await router.deploymentTransaction()?.wait();
  return { router, Router };
}

export class UniswapV2Deployer {
  public Interface = Interface;
  public async deploy(signer: SignerWithAddress) {
    const { factory, Factory } = await deployFactory(signer, signer);
    const uniFactory = factory;
    const UniFactory = Factory;
    const { weth9, WETH9 } = await deployWETH9(signer);
    const { router, Router } = await deployRouter(signer, factory, weth9);
    return {
      weth9,
      WETH9,
      uniFactory,
      UniFactory,
      router,
      Router,
    };
  }
}
