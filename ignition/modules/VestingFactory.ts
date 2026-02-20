import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const VestingFactoryModule = buildModule("VestingFactory", (m) => {
  const treasury = m.getParameter("treasury");
  const vestingFee = m.getParameter("vestingFee", 100n);

  const factory = m.contract("VestingContractFactory", [treasury, vestingFee]);

  return { factory };
});

export default VestingFactoryModule;
