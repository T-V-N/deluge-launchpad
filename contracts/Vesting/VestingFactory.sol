// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Import OpenZeppelin's SafeMath library for secure mathematical operations
import "@openzeppelin/contracts/utils/math/Math.sol";

// Import interfaces for ERC20 tokens
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./PeriodicVesting.sol";
import "./LinearVesting.sol";

// Errors
error NotZeroAddress();
error StartDateShallBeInFuture();
error PayForCreation();
error NotZero();

// VestingContractFactory
contract VestingContractFactory is Ownable {
    mapping(address => address[]) public vestingDeployed;
    mapping(address => uint256) public vestingCount;

    address[] public vestings;
    uint256 public totalVestingsCount;
    uint256 public vestingFee;
    address public treasury;

    event VestingContractCreated(address vestingContractAddress, address indexed creator);

    constructor(address _treasury, uint256 _vestingFee) Ownable(msg.sender) {
        if (_treasury == address(0)) {
            revert NotZeroAddress();
        }

        if (_vestingFee == 0) {
            revert NotZero();
        }

        treasury = _treasury;
        vestingFee = _vestingFee;
    }

    function createPeriodicVestingContract(
        address _erc20Token,
        uint32 _startDate,
        uint32 _cliffPeriod,
        uint256 _firstUnlockPercent,
        uint32 _unlockPeriod,
        uint256 _unlockPeriodPercent
    ) public payable returns (address vesting) {
        if (msg.value < vestingFee) {
            revert PayForCreation();
        }

        PeriodicVesting vestingContract = new PeriodicVesting(msg.sender, _erc20Token, _startDate, _cliffPeriod, _firstUnlockPercent, _unlockPeriod, _unlockPeriodPercent);

        vestingDeployed[msg.sender].push(address(vestingContract));
        vestings.push(address(vestingContract));
        vestingCount[msg.sender]++;
        totalVestingsCount++;

        payable(treasury).transfer(msg.value);

        emit VestingContractCreated(address(vestingContract), msg.sender);

        return address(vestingContract);
    }

    function createLinearVestingContract(address _erc20Token, uint32 _startDate, uint32 _unlockPeriod) public payable returns (address vesting) {
        if (msg.value < vestingFee) {
            revert PayForCreation();
        }

        LinearVesting vestingContract = new LinearVesting(msg.sender, _erc20Token, _startDate, _unlockPeriod);

        vestingDeployed[msg.sender].push(address(vestingContract));
        vestings.push(address(vestingContract));
        vestingCount[msg.sender]++;
        totalVestingsCount++;

        payable(treasury).transfer(msg.value);

        emit VestingContractCreated(address(vestingContract), msg.sender);

        return address(vestingContract);
    }

    function setVestingFee(uint256 _vestingFee) external onlyOwner {
        vestingFee = _vestingFee;
    }

    function getVestingCount(address account) external view returns (uint256) {
        return vestingCount[account];
    }

    function getVestingContracts(address account) external view returns (address[] memory) {
        return vestingDeployed[account];
    }

    function getTotalVestingsCount() external view returns (uint256) {
        return totalVestingsCount;
    }
}
