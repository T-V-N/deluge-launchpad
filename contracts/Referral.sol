// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.24;

// import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/access/Ownable.sol";

// contract ReferralContract is ReentrancyGuard, Ownable {
//     modifier codeExists(string memory code) {
//         if (referralCodes[code].owner == address(0)) {
//             revert CodeDoesntExist();
//         }
//         _;
//     }

//     struct ReferralSource {
//         bool unlocked;
//         uint256 registeredNative;
//         uint256 registeredUSDT;
//         uint256 registeredUSDC;
//         uint256 registeredDAI;
//     }

//     struct ReferralCode {
//         address owner;
//         uint256 balanceNative;
//         uint256 balanceUSDT;
//         uint256 balanceUSDC;
//         uint256 balanceDAI;
//         mapping(address => ReferralSource) sources;
//     }

//     mapping(string => ReferralCode) public referralCodes;
//     mapping(address => bool) isSource;
//     mapping(string => address[]) sources;
//     uint256 public sourceCount;
//     address public treasury;
//     uint256 public fee;
//     IERC20 public USDT;
//     IERC20 public USDC;
//     IERC20 public DAI;

//     event ReferralCodeCreated(string code, address owner);
//     event FundsAdded(string code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI);
//     event FundsRemoved(string code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI);
//     event ReferralCodeDeleted(string code, address owner);

//     constructor(address _usdt, address _usdc, address _dai, uint256 _fee, address _treasury) Ownable(msg.sender) {
//         if (_usdt == address(0) || _usdc == address(0) || _dai == address(0)) {
//             revert WrongERC20Address();
//         }

//         USDT = IERC20(_usdt);
//         USDC = IERC20(_usdc);
//         DAI = IERC20(_dai);
//         fee = _fee;
//         treasury = _treasury;
//     }

//     error CodeAlreadyExists();
//     error CodeDoesntExist();
//     error NothingToClaim();
//     error PayForCreation();
//     error CodeDoesntBelongToCaller();
//     error AlreadyUnlocked();
//     error ShouldProvideValueForUnlock();
//     error WrongERC20Address();

//     function _createCode(string memory code) private {
//         if (referralCodes[code].owner != address(0)) {
//             revert CodeAlreadyExists();
//         }

//         referralCodes[code].owner = msg.sender;

//         emit ReferralCodeCreated(code, msg.sender);
//     }

//     function createReferralCodeAdmin(string memory code) external nonReentrant onlyOwner {
//         _createCode(code);
//     }

//     // function createReferralCode(string memory code) external payable nonReentrant {
//     //     if (msg.value < fee) {
//     //         revert PayForCreation();
//     //     }
//     //     payable(treasury).transfer(msg.value);

//     //     _createCode(code);
//     // }

//     function _transferCode(string memory code) private {
//         uint256 balanceNative = referralCodes[code].balanceNative;
//         uint256 balanceUSDT = referralCodes[code].balanceUSDT;
//         uint256 balanceUSDC = referralCodes[code].balanceUSDC;
//         uint256 balanceDAI = referralCodes[code].balanceDAI;

//         if (balanceNative == 0 && balanceUSDT == 0 && balanceUSDC == 0 && balanceDAI == 0) {
//             revert NothingToClaim();
//         }

//         address owner = referralCodes[code].owner;

//         if (balanceNative > 0) {
//             payable(owner).transfer(balanceNative);
//         }

//         if (balanceUSDT > 0) {
//             USDT.transfer(owner, balanceUSDT);
//         }

//         if (balanceUSDC > 0) {
//             USDC.transfer(owner, balanceUSDC);
//         }

//         if (balanceDAI > 0) {
//             DAI.transfer(owner, balanceDAI);
//         }
//     }

//     function deleteReferralCode(string memory code) external nonReentrant codeExists(code) onlyOwner {
//         _transferCode(code);
//         delete referralCodes[code];

//         emit ReferralCodeDeleted(code, msg.sender);
//     }

//     function addRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external nonReentrant codeExists(code) {
//         if (referralCodes[code].sources[msg.sender].unlocked) {
//             revert AlreadyUnlocked();
//         }

//         if (!isSource[msg.sender]) {
//             isSource[msg.sender] = true;
//             sourceCount++;
//             sources[code].push(msg.sender);
//         }

//         referralCodes[code].sources[msg.sender].registeredNative += amountNative;
//         referralCodes[code].sources[msg.sender].registeredUSDT += amountUSDT;
//         referralCodes[code].sources[msg.sender].registeredUSDC += amountUSDC;
//         referralCodes[code].sources[msg.sender].registeredDAI += amountDAI;

//         emit FundsAdded(code, amountNative, amountUSDT, amountUSDC, amountDAI);
//     }

//     function removeRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external codeExists(code) {
//         if (referralCodes[code].sources[msg.sender].unlocked) {
//             revert AlreadyUnlocked();
//         }

//         referralCodes[code].sources[msg.sender].registeredNative -= amountNative;
//         referralCodes[code].sources[msg.sender].registeredUSDT -= amountUSDT;
//         referralCodes[code].sources[msg.sender].registeredUSDC -= amountUSDC;
//         referralCodes[code].sources[msg.sender].registeredDAI -= amountDAI;

//         emit FundsRemoved(code, amountNative, amountUSDT, amountUSDC, amountDAI);
//     }

//     function unlockRegisteredFunds(string memory code) external payable codeExists(code) {
//         if (referralCodes[code].sources[msg.sender].unlocked) {
//             revert AlreadyUnlocked();
//         }

//         referralCodes[code].sources[msg.sender].unlocked = true;
//         uint256 balanceNative = referralCodes[code].sources[msg.sender].registeredNative;
//         uint256 balanceUSDT = referralCodes[code].sources[msg.sender].registeredUSDT;
//         uint256 balanceUSDC = referralCodes[code].sources[msg.sender].registeredUSDC;
//         uint256 balanceDAI = referralCodes[code].sources[msg.sender].registeredDAI;

//         if (balanceNative > 0) {
//             referralCodes[code].balanceNative += balanceNative;
//         }

//         if (balanceUSDT > 0) {
//             USDT.transferFrom(msg.sender, address(this), balanceUSDT);

//             referralCodes[code].balanceUSDT += balanceUSDT;
//         }

//         if (balanceUSDC > 0) {
//             USDC.transferFrom(msg.sender, address(this), balanceUSDC);
//             referralCodes[code].balanceUSDC += balanceUSDC;
//         }

//         if (balanceDAI > 0) {
//             DAI.transferFrom(msg.sender, address(this), balanceDAI);
//             referralCodes[code].balanceDAI += balanceDAI;
//         }
//     }

//     function claimCode(string memory code) external codeExists(code) {
//         if (referralCodes[code].owner != msg.sender) {
//             revert CodeDoesntBelongToCaller();
//         }

//         _transferCode(code);

//         referralCodes[code].balanceNative = 0;
//         referralCodes[code].balanceUSDT = 0;
//         referralCodes[code].balanceUSDC = 0;
//         referralCodes[code].balanceDAI = 0;
//     }

//     function codeExist(string memory code) external view returns (bool) {
//         if (referralCodes[code].owner != address(0)) {
//             return true;
//         }

//         return false;
//     }
// }
