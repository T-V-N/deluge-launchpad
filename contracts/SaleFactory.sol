// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Sale.sol";

// SaleContractFactory
contract SaleContractFactory is Ownable {
    //errors
    error FeeTooLow();
    error ProvideLockerAndTreasury();
    error ProvideToken();
    error PayForCreation();

    address public locker;
    address public treasury;
    address public referralContract;

    event SaleContractCreated(address saleContractAddress, address indexed creator);

    uint256 public saleFee;
    uint256 public raiseFee;

    bool public initialized = false;

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

    function createSaleContract(address _saleTokenAddress, address _paymentTokenAddress, bool _referralEnabled, address[] calldata _whitelist) public payable returns (address sale) {
        if (_saleTokenAddress == address(0)) {
            revert ProvideToken();
        }

        if (msg.value < saleFee) {
            revert PayForCreation();
        }

        Sale saleContract = new Sale(_saleTokenAddress, _paymentTokenAddress, locker, treasury, raiseFee, _whitelist, _referralEnabled);

        (bool success, ) = owner().call{value: msg.value}("");
        require(success);

        emit SaleContractCreated(address(saleContract), msg.sender);

        return address(saleContract);
    }
}
