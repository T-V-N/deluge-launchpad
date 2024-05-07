import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { params } from "../../utils/common";

const VestingFactory = buildModule("VestingFactory", (m) => {
  const deployer = m.getAccount(0);

  const factory = m.contract("VestingContractFactory", [params.treasury, params.fee], { from: deployer });

  return { factory };
});

export default VestingFactory;
