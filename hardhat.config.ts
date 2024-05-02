import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import 'hardhat-abi-exporter';
import "@nomicfoundation/hardhat-ignition-ethers";
import 'solidity-coverage'

import '@typechain/hardhat'
import '@nomicfoundation/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import "hardhat-contract-sizer";

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || './.env';
dotenvConfig({
  path: resolve(__dirname, dotenvConfigPath),
});
const { DEPLOYER_PRIVATE_KEY, FORK_KEY, QUICKNODE_API } =
  process.env;

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  settings: {
    optimizer: {
      enabled: true,
      runs: 1000,
    },
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 21
  },
  networks: {
    bscmainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },

  hardhat: {
    forking: {
      url: `https://tiniest-wider-mound.bsc.quiknode.pro/${QUICKNODE_API}/`,
      accounts: [FORK_KEY],
    }
  },
  abiExporter: {
    path: './data/abi',
    flat: true,
  },

  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
    alwaysGenerateOverloads: false,
    externalArtifacts: ['externalArtifacts/*.json'],
    dontOverrideCompile: false
  },
};

export default config;
