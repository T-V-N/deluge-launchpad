import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ReferralModule = buildModule("Referral", (m) => {
  const treasury = m.getParameter("treasury");
  const paymentTokenAddress = m.getParameter("paymentTokenAddress");
  const referralFee = m.getParameter("referralFee", 8n);

  const referral = m.contract("ReferralContract", [
    [paymentTokenAddress],
    referralFee,
    treasury,
  ]);

  return { referral };
});

export default ReferralModule;
