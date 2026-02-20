import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import SaleFactoryModule from "./Factory.js";
import UncappedFactoryModule from "./UncappedFactory.js";
import ReferralModuleFactoryModule from "./ReferralModuleFactory.js";
import VestingFactoryModule from "./VestingFactory.js";

const DeployModule = buildModule("Deploy", (m) => {
  const { factory: saleFactory } = m.useModule(SaleFactoryModule);
  const { factory: uncappedFactory } = m.useModule(UncappedFactoryModule);
  const { factory: referralModuleFactory } = m.useModule(ReferralModuleFactoryModule);
  const { factory: vestingFactory } = m.useModule(VestingFactoryModule);

  return { saleFactory, uncappedFactory, referralModuleFactory, vestingFactory };
});

export default DeployModule;
