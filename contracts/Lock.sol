// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract BSCPancakeswapV2Locker {
    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    struct newLock {
        address lockowner;
        address lpaddress;
        uint256 unlockdate;
        uint256 lockamount;
        uint256 lockid;
        bool withdrawn;
    }

    address owner;
    address payable feeaddress;
    uint256 fee = 150;

    newLock[] public locks;
    mapping(address => uint256[]) public ownerLocks;
    mapping(address => uint256[]) public tokenLocks;

    event lpLocked(address indexed tokenaddress, uint256 amount, uint256 unlocktime, address indexed owner, uint256 indexed locknumber);
    event lpWithdrawn(address indexed tokenaddress, uint256 amount, address indexed owner, uint256 indexed locknumber);

    function changeFee(uint256 newFee) external onlyOwner {
        require(50000 >= newFee);
        fee = newFee;
    }

    function changefeeaddress(address payable newaddress) external onlyOwner {
        feeaddress = newaddress;
    }

    function lockTokens(address token, uint256 amount, uint256 locktime, address _owner) external payable returns (uint256 _lockNumber) {
        require(amount > 0, "cant lock 0 tokens");
        require(locktime > 3600, "too few time lock");
        require(msg.value >= fee, "you shall pay fee");
        feeaddress.transfer(msg.value);

        require(IERC20(token).allowance(msg.sender, address(this)) >= amount, "approve spending");

        uint256 oldBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        uint256 newBalance = IERC20(token).balanceOf(address(this));
        require(oldBalance == newBalance - amount, "exclude from fees");

        uint256 lockNumber = locks.length;
        ownerLocks[_owner].push(lockNumber);
        tokenLocks[token].push(lockNumber);
        uint256 unlocktime = block.timestamp + locktime;

        newLock memory newlock;
        newlock.lockowner = _owner;
        newlock.lpaddress = token;
        newlock.unlockdate = unlocktime;
        newlock.lockamount = amount;
        newlock.lockid = lockNumber;

        locks.push(newlock);

        emit lpLocked(token, amount, unlocktime, _owner, lockNumber);
        return lockNumber;
    }

    function withdrawLP(uint256 lockNumber) external {
        require(msg.sender == locks[lockNumber].lockowner);
        require(block.timestamp >= locks[lockNumber].unlockdate);
        require(locks[lockNumber].lockamount > 0);
        require(!locks[lockNumber].withdrawn);
        locks[lockNumber].withdrawn = true;
        IERC20(locks[lockNumber].lpaddress).transfer(msg.sender, locks[lockNumber].lockamount);
        emit lpWithdrawn(locks[lockNumber].lpaddress, locks[lockNumber].lockamount, locks[lockNumber].lockowner, locks[lockNumber].lockid);
    }
}
