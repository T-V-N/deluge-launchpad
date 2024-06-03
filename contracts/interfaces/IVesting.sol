// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVestingContract {
    function initialize(address _erc20Token, uint32 _startDate, uint32 _cliffPeriod, uint256 _firstUnlockPercent, uint32 _unlockPeriod, uint256 _unlockPeriodPercent) external;
}
