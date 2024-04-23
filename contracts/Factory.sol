// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Import OpenZeppelin's SafeMath library for secure mathematical operations
import "@openzeppelin/contracts/utils/math/Math.sol";

// Import interfaces for ERC20 tokens (USDT, USDC, DAI)
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Sale.sol";

// Basic interface for Sale contracts
interface ISaleContract {
    function initialize(
        address _tokenAddress,
        uint256 _start,
        uint256 _end,
        uint256 _lockupPeriod,
        uint256 _preSaleTokenAmount,
        uint256 _liquidityPt,
        uint256 _minPurchase,
        uint256 _maxPurchase,
        uint256 _softCap,
        uint256 _hardCap,
        address[] calldata _whitelist
    ) external;
}

// SaleContractFactory
contract SaleContractFactory is Ownable {
    using Math for uint256;

    mapping(address => address[]) public launchesDeployed;
    mapping(address => uint256) public launchCount;

    address[] public launches;
    uint256 public totalLaunchesCount;

    address public locker;
    address public treasury;

    event SaleContractCreated(address saleContractAddress, address indexed creator);

    uint256 public saleFee;
    uint256 public raiseFee;

    bool public initialized = false;

    constructor(address _locker, uint256 _saleFee, uint256 _raiseFee, address _treasury) Ownable(msg.sender) {
        // require(_saleFee > 10 ^ 15 && _raiseFee > 10 ^ 15, "fee to low");
        // require(_locker != address(0) && _treasury != address(0), "define locker and treasury");

        locker = _locker;
        raiseFee = _raiseFee;
        saleFee = _saleFee;
        treasury = _treasury;
    }

    function setSaleFee(uint256 _saleFee) external onlyOwner {
        saleFee = _saleFee;
    }

    function setRaiseFee(uint256 _raiseFee) external onlyOwner {
        raiseFee = _raiseFee;
    }

    function setLocker(address _locker) external onlyOwner {
        locker = _locker;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function createSaleContract(address _saleTokenAddress, address _paymentTokenAddress, address[] memory _whitelist) public payable returns (address sale) {
        require(_saleTokenAddress != address(0), "define token to sale");
        require(msg.value >= saleFee, "sale creation should be paid");

        Sale saleContract = new Sale(_saleTokenAddress, _paymentTokenAddress, locker, treasury, raiseFee, _whitelist);

        launchesDeployed[msg.sender].push(address(saleContract));
        launches.push(address(saleContract));
        launchCount[msg.sender]++;
        totalLaunchesCount++;

        payable(owner()).transfer(msg.value);

        emit SaleContractCreated(address(saleContract), msg.sender);

        return address(saleContract);
    }
}
