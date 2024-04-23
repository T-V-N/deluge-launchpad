import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const SaleToken = buildModule("Token", (m) => {
  const deployer = m.getAccount(1);
  const saleToken = m.contract("ERC20Token", ["SoldToken"], { from: deployer, id: "token" })

  return { saleToken };
});

export default SaleToken;
