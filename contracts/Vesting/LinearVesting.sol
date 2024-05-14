//SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LinearVesting is Ownable, ReentrancyGuard {
    IERC20 public erc20Token;
    uint32 public startDate;
    uint32 public unlockPeriod;

    mapping(address => Allocation) public allocations;

    uint256 public constant PERCENT_DIVIDER = 1e18 * 100;

    constructor(address _newOwner, address _erc20Token, uint32 _startDate, uint32 _unlockPeriod) Ownable(_newOwner) {
        if (_erc20Token == address(0)) {
            revert ERC20TokenNotZeroAddress();
        }

        if (_startDate < uint32(block.timestamp)) {
            revert StartDateMustBeGreaterThanCurrentTime();
        }

        if (_unlockPeriod == 0) {
            revert UnlockPeriodNotZero();
        }

        erc20Token = IERC20(_erc20Token);
        startDate = _startDate;
        unlockPeriod = _unlockPeriod;
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

    error ERC20TokenNotZeroAddress();
    error UnlockPeriodNotZero();
    error StartDateMustBeGreaterThanCurrentTime();
    error UserStartedToClaim(address account);
    error ArrayLengthsNotEqual();
    error AccountNotZeroAddress();
    error ContractMustHaveSufficientFunds();
    error NothingToClaim();
    error CantChangeOngoingVesting();

    //Read methods-------------------------------------------

    function getBalance() public view returns (uint256) {
        return erc20Token.balanceOf(address(this));
    }

    function canClaim(address account) public view returns (bool) {
        return (calculateClaimAmount(account) > 0);
    }

    function calculateClaimAmount(address account) public view returns (uint256) {
        if (block.timestamp < startDate) {
            return 0;
        }

        Allocation storage allocation = allocations[account];

        uint256 claimed = allocation.claimed;
        uint256 amount = allocation.amount;

        if (block.timestamp >= startDate + unlockPeriod) {
            return amount - claimed;
        }

        uint256 claimAmount = ((block.timestamp - startDate) * amount) / unlockPeriod;
        if (claimAmount > amount) {
            claimAmount = amount;
        }

        return claimAmount - claimed;
    }

    function getAllocationCount() public view returns (uint256) {
        return _allocationCounter;
    }

    function isAllocationFinished(address account) public view returns (bool) {
        return (allocations[account].claimed == allocations[account].amount);
    }

    function calculateRemainAmount(address wallet) public view returns (uint256) {
        return allocations[wallet].amount - allocations[wallet].claimed;
    }

    function fetchClaimInfo(address account) external view returns (uint256 _amount, uint256 _claimed, uint32 claimedAt, bool _exist, uint256 _remain, uint256 _available, bool _canClaim) {
        Allocation storage allocation = allocations[account];
        uint256 remain_ = calculateRemainAmount(account);
        uint256 available_ = calculateClaimAmount(account);
        bool canClaim_ = canClaim(account);

        return (allocation.amount, allocation.claimed, allocation.claimedAt, allocation.exist, remain_, available_, canClaim_);
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

        erc20Token.transferFrom(owner(), address(this), amount);

        _setAllocation(account, amount);
    }

    function setAllocations(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        if (recipients.length != amounts.length) {
            revert ArrayLengthsNotEqual();
        }

        uint256 totalAmount = 0;

        for (uint32 i = 0; i < recipients.length; i++) {
            totalAmount += amounts[i];
        }

        erc20Token.transferFrom(owner(), address(this), totalAmount);

        for (uint32 i = 0; i < recipients.length; i++) {
            _setAllocation(recipients[i], amounts[i]);
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
