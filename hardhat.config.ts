import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatAbiExporter from "@solidstate/hardhat-abi-exporter";
import hardhatContractSizer from "@solidstate/hardhat-contract-sizer";
import dotenv from "dotenv";

dotenv.config();

const { DEPLOYER_PRIVATE_KEY = "", BSC_SCAN_API_KEY = "" } = process.env;

export default defineConfig({
  plugins: [
    hardhatToolboxMochaEthers,
    hardhatAbiExporter,
    hardhatContractSizer,
  ],
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: { enabled: true, runs: 1000 },
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 1000 },
        },
      },
      {
        version: "0.8.17",
        settings: {
          optimizer: { enabled: true, runs: 1000 },
        },
      },
    ],
  },
  networks: {
    bscmainnet: {
      type: "http",
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    hardhat: {
      type: "edr-simulated",
    },
  },

  typechain: {
    outDir: "typechain-types",
    alwaysGenerateOverloads: false,
    dontOverrideCompile: false,
  },

  verify: {
    etherscan: {
      apiKey: BSC_SCAN_API_KEY,
    },
  },

  abiExporter: [
    {
      runOnCompile: true,
      path: "./abi/pretty",
      pretty: true,
    },
    {
      runOnCompile: true,
      path: "./abi/ugly",
      pretty: false,
    },
  ],
});
