//SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// import "hardhat/console.sol";

contract PeriodicVesting is Ownable, ReentrancyGuard {
    //Variables, structs, errors, modifiers, events------------------------
    error ERC20TokenNotZeroAddress();
    error UnlockPeriodNotZero();
    error FirstUnlockTooBig();
    error UnlockPeriodPercentNotZero();
    error StartDateMustBeGreaterThanCurrentTime();
    error UserStartedToClaim(address account);
    error ArrayLengthshNotEqual();
    error AccountNotZeroAddress();
    error ContractMustHaveSufficientFunds();
    error NothingToClaim();
    error CantChangeOngoingVesting();

    IERC20 public erc20Token;
    uint32 public startDate;
    uint32 public cliffPeriod;
    uint256 public firstUnlockPercent;
    uint32 public unlockPeriod;
    uint256 public unlockPeriodPercent;

    mapping(address => Allocation) public allocations;

    uint256 public constant PERCENT_DIVIDER = 1e18 * 100;

    constructor(address _newOwner, address _erc20Token, uint32 _startDate, uint32 _cliffPeriod, uint256 _firstUnlockPercent, uint32 _unlockPeriod, uint256 _unlockPeriodPercent) Ownable(_newOwner) {
        if (_erc20Token == address(0)) {
            revert ERC20TokenNotZeroAddress();
        }

        if (_startDate < uint32(block.timestamp)) {
            revert StartDateMustBeGreaterThanCurrentTime();
        }

        if (_unlockPeriod == 0) {
            revert UnlockPeriodNotZero();
        }

        if (_unlockPeriodPercent == 0) {
            revert UnlockPeriodPercentNotZero();
        }

        if (_firstUnlockPercent > PERCENT_DIVIDER) {
            revert FirstUnlockTooBig();
        }

        erc20Token = IERC20(_erc20Token);
        startDate = _startDate;
        cliffPeriod = _cliffPeriod;
        firstUnlockPercent = _firstUnlockPercent;
        unlockPeriod = _unlockPeriod;
        unlockPeriodPercent = _unlockPeriodPercent;
    }

    uint256 private _allocationCounter;
    uint256 private totalReserved;
    uint256 private totalAllocated;

    struct Allocation {
        uint256 amount;
        uint256 claimed;
        uint32 claimedAt;
        bool exist;
    }

    event Claim(address indexed account, uint256 amount);
    event SetAllocation(address indexed account, uint256 amount);
    event WithdrawExcessAmount(address indexed to, uint256 amount);

    //Read methods-------------------------------------------

    function getBalance() public view returns (uint256) {
        return erc20Token.balanceOf(address(this));
    }

    function canClaim(address account) public view returns (bool) {
        return (calculateClaimAmount(account) > 0);
    }

    function calculatePassedPeriod() public view returns (uint32) {
        return ((uint32)(block.timestamp) - startDate - cliffPeriod) / unlockPeriod;
    }

    function calculateClaimAmount(address account) public view returns (uint256) {
        if (block.timestamp < startDate) {
            return 0;
        }

        Allocation storage allocation = allocations[account];

        uint256 firstUnlockAmount = (allocation.amount * firstUnlockPercent) / PERCENT_DIVIDER;
        uint256 claimed = allocation.claimed;
        uint256 amount = allocation.amount;

        if (block.timestamp < startDate + cliffPeriod) {
            if (claimed == 0) {
                return firstUnlockAmount;
            }
        } else {
            uint256 claimAmount = (calculatePassedPeriod() * (amount * unlockPeriodPercent)) / PERCENT_DIVIDER + firstUnlockAmount - claimed;

            if (claimAmount > amount - claimed) {
                return amount - claimed;
            }
            return claimAmount;
        }

        return 0;
    }

    function getAllocationCount() public view returns (uint256) {
        return _allocationCounter;
    }

    function isAllocationFinished(address account) public view returns (bool) {
        return (allocations[account].claimed == allocations[account].amount);
    }

    function calculateNextClaimAt(address account) public view returns (uint256) {
        if (canClaim(account) || isAllocationFinished(account)) {
            return 0;
        }

        if (allocations[account].claimed == 0) {
            return startDate;
        } else {
            if (block.timestamp - startDate < cliffPeriod) {
                return startDate + cliffPeriod + unlockPeriod;
            }

            uint256 passedPeriod = calculatePassedPeriod();
            return startDate + cliffPeriod + unlockPeriod * (passedPeriod + 1);
        }
    }

    function calculateRemainAmount(address wallet) public view returns (uint256) {
        return allocations[wallet].amount - allocations[wallet].claimed;
    }

    function fetchClaimInfo(
        address account
    ) external view returns (uint256 _amount, uint256 _claimed, uint32 claimedAt, bool _exist, uint256 _remain, uint256 _available, bool _canClaim, uint256 _nextClaimAt) {
        Allocation storage allocation = allocations[account];
        uint256 remain_ = calculateRemainAmount(account);
        uint256 available_ = calculateClaimAmount(account);
        bool canClaim_ = canClaim(account);
        uint256 nextClaimAt_ = calculateNextClaimAt(account);

        return (allocation.amount, allocation.claimed, allocation.claimedAt, allocation.exist, remain_, available_, canClaim_, nextClaimAt_);
    }

    function getTotalAllocated() public view returns (uint256) {
        return totalAllocated;
    }

    function calculatedRequiredAmount() public view returns (uint256) {
        uint256 contractBalance = getBalance();
        if (totalReserved > contractBalance) {
            return totalReserved - contractBalance;
        }
        return 0;
    }

    function calculateExcessAmount() public view returns (uint256) {
        uint256 contractBalance = getBalance();
        if (contractBalance > totalReserved) {
            return contractBalance - totalReserved;
        }
        return 0;
    }

    //Write methods-------------------------------------------
    function _setAllocation(address account, uint256 amount) private nonReentrant {
        if (account == address(0)) {
            revert AccountNotZeroAddress();
        }

        Allocation storage allocation = allocations[account];

        if (allocation.claimed > 0) {
            revert UserStartedToClaim(account);
        }

        if (!allocation.exist) {
            _allocationCounter++;
        }

        totalAllocated -= allocation.amount;
        totalReserved -= allocation.amount;

        allocation.amount = amount;
        allocation.exist = true;

        totalAllocated += amount;
        totalReserved += amount;

        emit SetAllocation(account, amount);
    }

    function setAllocation(address account, uint256 amount) public onlyOwner {
        if (block.timestamp > startDate) {
            revert CantChangeOngoingVesting();
        }

        _setAllocation(account, amount);
    }

    function setAllocations(address[] calldata recepients, uint256[] calldata amounts) external onlyOwner {
        if (recepients.length != amounts.length) {
            revert ArrayLengthshNotEqual();
        }

        for (uint32 i = 0; i < recepients.length; i++) {
            setAllocation(recepients[i], amounts[i]);
        }
    }

    function claim() external nonReentrant {
        address sender = _msgSender();
        uint256 claimAmount = calculateClaimAmount(sender);

        if (claimAmount == 0) {
            revert NothingToClaim();
        }

        if (getBalance() < claimAmount) {
            revert ContractMustHaveSufficientFunds();
        }

        allocations[sender].claimed += claimAmount;
        allocations[sender].claimedAt = (uint32)(block.timestamp);

        totalReserved -= claimAmount;

        erc20Token.transfer(sender, claimAmount);

        emit Claim(sender, claimAmount);
    }

    function withdrawNonUsed() external nonReentrant onlyOwner {
        uint256 amount = calculateExcessAmount();
        address to = owner();
        erc20Token.transfer(to, amount);
        emit WithdrawExcessAmount(to, amount);
    }
}
