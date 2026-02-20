import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import LockerModule from "./Locker.js";
import ReferralModule from "./Referral.js";

const UncappedFactoryModule = buildModule("UncappedFactory", (m) => {
  const { locker } = m.useModule(LockerModule);
  const { referral } = m.useModule(ReferralModule);

  const treasury = m.getParameter("treasury");
  const saleFee = m.getParameter("saleFee", 100n);
  const raiseFee = m.getParameter("raiseFee", 8n);

  const factory = m.contract("UncappedSaleContractFactory", [
    locker,
    saleFee,
    raiseFee,
    treasury,
    referral,
  ]);

  return { factory };
});

export default UncappedFactoryModule;
