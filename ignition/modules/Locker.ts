import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LockerModule = buildModule("Locker", (m) => {
  const locker = m.contract("BSCPancakeswapV2Locker", []);
  return { locker };
});

export default LockerModule;
