// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReferralModule {
    function init(address _parent) external;

    function processReferralCode(string memory code, uint256 value) external;

    function finalizeReferralCodes(uint256 count) external payable;

    function isFinalized() external view returns (bool);

    function getRefshareBalance() external view returns (uint256);

    function getRefshareBalanceFor(uint256 count) external view returns (uint256);

    function getRefContract() external view returns (address);
}
