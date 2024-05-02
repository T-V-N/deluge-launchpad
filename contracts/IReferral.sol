// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReferralContract {
    function addRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external;

    function removeRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external;

    function unlockRegisteredFunds(string memory code) external payable;
}
