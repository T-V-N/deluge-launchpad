// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ReferralModule.sol";

// ReferralModuleFactory
contract ReferralModuleFactory {
    constructor() {}

    event ReferralModuleContractCreated(address ModuleAddress, address Creator);

    function createReferralModule(bool _acceptsNativeToken, address _paymentToken, address _USDT, address _USDC, address _DAI, address _referralContract) public payable returns (address sale) {
        ReferralModule module = new ReferralModule(_acceptsNativeToken, _paymentToken, _USDT, _USDC, _DAI, _referralContract);

        emit ReferralModuleContractCreated(address(module), msg.sender);

        return address(module);
    }
}
