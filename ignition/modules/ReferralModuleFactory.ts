import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { params } from "../../utils/common";

const Factory = buildModule("Factory", (m) => {
  const deployer = m.getAccount(0);
  const factory = m.contract("ReferralModuleFactory", [], { from: deployer });

  return { factory };
});

export default Factory;
