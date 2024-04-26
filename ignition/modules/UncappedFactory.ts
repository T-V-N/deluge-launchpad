import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { params } from "../../utils/common";

const Factory = buildModule("Factory", (m) => {
  const deployer = m.getAccount(0);

  const locker = m.contract("BSCPancakeswapV2Locker", [], { from: deployer, id: "locker" })
  const factory = m.contract("UncappedSaleContractFactory", [locker, params.fee, params.raiseFee, params.treasury], { from: deployer });

  return { factory };
});

export default Factory;
