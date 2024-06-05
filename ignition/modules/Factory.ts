import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { params } from "../../utils/common";

const Factory = buildModule("Factory", (m) => {
  const deployer = m.getAccount(0);

  const locker = m.contract("BSCPancakeswapV2Locker", [], { from: deployer, id: "locker" })
  const usdt = m.contract("ERC20Token", ["usdt"], { from: deployer, id: "usdt" })
  const referral = m.contract("ReferralContract", [usdt, usdt, usdt, params.raiseFee, params.treasury], { from: deployer, id: "referral" })

  const factory = m.contract("SaleContractFactory", [locker, params.fee, params.raiseFee, params.treasury, referral], { from: deployer });

  return { factory };
});

export default Factory;
