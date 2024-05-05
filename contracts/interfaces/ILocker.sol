// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

interface ILocker {
  function lockTokens(
    address token,
    uint256 amount,
    uint256 locktime,
    address _owner
  ) external payable returns (uint256 _lockNumber);
}
