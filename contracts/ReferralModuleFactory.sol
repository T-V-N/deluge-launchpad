// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../lib/deluge-referral/contracts/ReferralModuleRefundable.sol";

// ReferralModuleFactory
contract ReferralModuleFactory {
    constructor() {}

    event ReferralModuleContractCreated(address ModuleAddress, address Creator);

    function createReferralModule(address _referralContract) public payable returns (address sale) {
        ReferralModuleRefundable module = new ReferralModuleRefundable(_referralContract);

        emit ReferralModuleContractCreated(address(module), msg.sender);

        return address(module);
    }
}
