// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Token is ERC20 {
    uint8 public _decimals;

    constructor(string memory name) ERC20(name, name) {
        _mint(msg.sender, 1_000_000_000_000_000_000 ether);
        _decimals = 18;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
