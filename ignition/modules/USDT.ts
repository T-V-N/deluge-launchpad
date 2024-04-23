import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const USDT = buildModule("usdt", (m) => {
  const deployer = m.getAccount(0);
  const usdt = m.contract("ERC20Token", ["usdt"], { from: deployer, id: "usdt" })

  return { usdt };
});

export default USDT;
