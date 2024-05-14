// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./UncappedSale.sol";

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

// UncappedSaleContractFactory
contract UncappedSaleContractFactory is Ownable {
    //errors
    error FeeTooLow();
    error ProvideLockerAndTreasury();
    error ProvideToken();
    error PayForCreation();

    mapping(address => address[]) public launchesDeployed;
    mapping(address => uint256) public launchCount;

    address[] public launches;
    uint256 public totalLaunchesCount;

    address public locker;
    address public treasury;

    event SaleContractCreated(address saleContractAddress, address indexed creator);

    uint256 public saleFee;
    uint256 public raiseFee;

    constructor(address _locker, uint256 _saleFee, uint256 _raiseFee, address _treasury) Ownable(msg.sender) {
        // if (_saleFee < 10 ** 15 || _raiseFee < 10 ** 15) {
        //     revert FeeTooLow();
        // }

        if (_locker == address(0) || _treasury == address(0)) {
            revert ProvideLockerAndTreasury();
        }

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

    function createUncappedSaleContract(address _saleTokenAddress, address _paymentTokenAddress, address[] memory _whitelist) public payable returns (address sale) {
        if (_saleTokenAddress == address(0)) {
            revert ProvideToken();
        }

        if (msg.value < saleFee) {
            revert PayForCreation();
        }

        UncappedSale saleContract = new UncappedSale(_saleTokenAddress, _paymentTokenAddress, locker, treasury, raiseFee, _whitelist);

        launchesDeployed[msg.sender].push(address(saleContract));
        launches.push(address(saleContract));
        launchCount[msg.sender]++;
        totalLaunchesCount++;

        (bool success, ) = owner().call{value: msg.value}("");
        require(success);

        emit SaleContractCreated(address(saleContract), msg.sender);

        return address(saleContract);
    }
}
