import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ReferralModuleFactoryModule = buildModule("ReferralModuleFactory", (m) => {
  const factory = m.contract("ReferralModuleFactory", []);
  return { factory };
});

export default ReferralModuleFactoryModule;
