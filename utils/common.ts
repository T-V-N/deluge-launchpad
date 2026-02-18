export const params = {
  lockerFee: 150n,
  fee: 100n,
  raiseFee: 8n,
  treasury: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  soft: 1_000n,
  hard: 20_000n,
  min: 100n,
  max: 10_000n,
  tokenSupply: 1_000_000_000_000_000_000_000_000n, // 1e24 = 1M tokens (18 dec)
  ethReserve: 10_000_000_000_000_000_000n,          // 10e18 = 10 ETH
  liquidityPt: 20n,                                  // 20% to LP, 80% to sale
  minLock: 3601n,
}
