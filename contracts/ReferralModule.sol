// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.24;

// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import "@openzeppelin/contracts/access/Ownable.sol";

// import "./interfaces/IReferral.sol";

// contract ReferralModule is Ownable, ReentrancyGuard {
//     modifier onlyParent() {
//         if (msg.sender != parent) {
//             revert OnlyParentContract();
//         }
//         _;
//     }

//     //error
//     error OnlyParentContract();
//     error InitProblem();
//     error ShouldProvideValueForUnlock();

//     // ref
//     IReferralContract referralContract;
//     address public USDT;
//     address public USDC;
//     address public DAI;
//     uint256 public refshareBalance;
//     mapping(bytes => uint256) codeBalances;
//     bytes[] codesRegistered;
//     uint256 finalizedIndex;
//     bool public referralFinalized;
//     bool public initialized;

//     bool acceptsNativeToken;
//     address public paymentToken;
//     address parent;

//     constructor(bool _acceptsNativeToken, address _paymentToken, address _USDT, address _USDC, address _DAI, address _referralContract) Ownable(msg.sender) {
//         USDT = _USDT;
//         USDC = _USDC;
//         DAI = _DAI;
//         acceptsNativeToken = _acceptsNativeToken;
//         paymentToken = _paymentToken;
//         referralContract = IReferralContract(_referralContract);
//     }

//     function init(address _parent) external onlyOwner {
//         if (initialized) {
//             revert InitProblem();
//         }

//         initialized = true;
//         parent = _parent;
//     }

//     function processReferralCode(string memory code, uint256 value) external onlyParent {
//         if (!referralContract.codeExist(code)) {
//             return;
//         }

//         if (acceptsNativeToken) {
//             referralContract.addRegisteredFunds(code, value, 0, 0, 0);
//         } else if (address(paymentToken) == USDT) {
//             referralContract.addRegisteredFunds(code, 0, value, 0, 0);
//         } else if (address(paymentToken) == USDC) {
//             referralContract.addRegisteredFunds(code, 0, 0, value, 0);
//         } else if (address(paymentToken) == DAI) {
//             referralContract.addRegisteredFunds(code, 0, 0, 0, value);
//         } else {
//             return;
//         }

//         if (codeBalances[bytes(code)] == 0) {
//             codesRegistered.push(bytes(code));
//             codeBalances[bytes(code)] += value;
//         }

//         refshareBalance += value;
//     }

//     function removeFromCode(string memory code, uint256 value) external onlyParent {
//         if (!referralContract.codeExist(code)) {
//             return;
//         }

//         if (acceptsNativeToken) {
//             referralContract.removeRegisteredFunds(code, value, 0, 0, 0);
//         } else if (address(paymentToken) == USDT) {
//             referralContract.removeRegisteredFunds(code, 0, value, 0, 0);
//         } else if (address(paymentToken) == USDC) {
//             referralContract.removeRegisteredFunds(code, 0, 0, value, 0);
//         } else if (address(paymentToken) == DAI) {
//             referralContract.removeRegisteredFunds(code, 0, 0, 0, value);
//         } else {
//             return;
//         }

//         codeBalances[bytes(code)] -= value;
//         refshareBalance -= value;
//     }

//     function finalizeReferralCode(string memory code) private {
//         uint256 codeBalance = codeBalances[bytes(code)];

//         if (acceptsNativeToken) {
//             referralContract.unlockRegisteredFunds{value: codeBalance}(code);
//         } else if (address(paymentToken) == USDT || (address(paymentToken) == USDC) || (address(paymentToken) == DAI)) {
//             IERC20(paymentToken).transferFrom(parent, address(this), codeBalance);
//             IERC20(paymentToken).approve(address(referralContract), codeBalance);
//             referralContract.unlockRegisteredFunds(code);
//         }
//     }

//     function finalizeReferralCodes(uint256 count) external payable onlyParent nonReentrant {
//         if (msg.value != getRefshareBalanceFor(count) && acceptsNativeToken) {
//             revert ShouldProvideValueForUnlock();
//         }

//         if (count > codesRegistered.length - finalizedIndex) {
//             count = codesRegistered.length - finalizedIndex;
//         }

//         uint endIndex = finalizedIndex + count;
//         for (uint i = finalizedIndex; i < endIndex; i++) {
//             string memory code = string(codesRegistered[i]);
//             finalizeReferralCode(code);
//         }

//         finalizedIndex = endIndex;
//         if (finalizedIndex >= codesRegistered.length) {
//             referralFinalized = true;
//         }
//     }

//     function isFinalized() public view returns (bool) {
//         return referralFinalized;
//     }

//     function getRefshareBalance() public view returns (uint256) {
//         return refshareBalance;
//     }

//     function getRefshareBalanceFor(uint256 count) public view returns (uint256) {
//         if (count > codesRegistered.length - finalizedIndex) {
//             count = codesRegistered.length - finalizedIndex;
//         }

//         uint endIndex = finalizedIndex + count;
//         uint256 balance;
//         for (uint i = finalizedIndex; i < endIndex; i++) {
//             string memory code = string(codesRegistered[i]);
//             balance += codeBalances[bytes(code)];
//         }
//         return balance;
//     }

//     function getRefContract() public view returns (address) {
//         return address(referralContract);
//     }
// }
