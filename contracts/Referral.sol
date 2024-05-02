// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ReferralContract is ReentrancyGuard, Ownable {
    struct ReferralSource {
        bool unlocked;
        uint256 registeredNative;
        uint256 registeredUSDT;
        uint256 registeredUSDC;
        uint256 registeredDAI;
    }

    struct ReferralCode {
        address owner;
        uint256 balanceNative;
        uint256 balanceUSDT;
        uint256 balanceUSDC;
        uint256 balanceDAI;
        mapping(address => ReferralSource) sources;
    }

    mapping(string => ReferralCode) referralCodes;
    address public treasury;
    uint256 public fee;
    IERC20 public USDT;
    IERC20 public USDC;
    IERC20 public DAI;

    event ReferralCodeCreated(string code, address owner);
    event FundsAdded(string code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI);
    event FundsRemoved(string code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI);
    event ReferralCodeDeleted(string code, address owner);

    constructor(address _usdt, address _usdc, address _dai, uint256 _fee, address _treasury) Ownable(msg.sender) {
        require(_usdt != address(0) && _usdc != address(0) && _dai != address(0));

        USDT = IERC20(_usdt);
        USDC = IERC20(_usdc);
        DAI = IERC20(_dai);
        fee = _fee;
        treasury = _treasury;
    }

    function createReferralCode(string memory code) external payable nonReentrant {
        require(referralCodes[code].owner == address(0), "Referral code already exists");
        require(msg.value >= fee, "you shall pay for creation");

        payable(treasury).transfer(msg.value);

        referralCodes[code].owner = msg.sender;

        emit ReferralCodeCreated(code, msg.sender);
    }

    function deleteReferralCode(string memory code) external nonReentrant onlyOwner {
        require(referralCodes[code].owner != address(0), "Referral code does not exist");

        uint256 balanceNative = referralCodes[code].balanceNative;
        uint256 balanceUSDT = referralCodes[code].balanceUSDT;
        uint256 balanceUSDC = referralCodes[code].balanceUSDC;
        uint256 balanceDAI = referralCodes[code].balanceDAI;

        delete referralCodes[code];

        if (balanceNative > 0) {
            payable(referralCodes[code].owner).transfer(balanceNative);
        }

        if (balanceUSDT > 0) {
            USDT.transfer(referralCodes[code].owner, balanceUSDT);
        }

        if (balanceUSDC > 0) {
            USDC.transfer(referralCodes[code].owner, balanceUSDC);
        }

        if (balanceDAI > 0) {
            DAI.transfer(referralCodes[code].owner, balanceDAI);
        }

        emit ReferralCodeDeleted(code, msg.sender);
    }

    function addRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external nonReentrant {
        require(referralCodes[code].owner != address(0), "Referral code does not exist");
        require(!referralCodes[code].sources[msg.sender].unlocked, "already unlocked");

        referralCodes[code].sources[msg.sender].registeredNative += amountDAI;
        referralCodes[code].sources[msg.sender].registeredUSDT += amountDAI;
        referralCodes[code].sources[msg.sender].registeredUSDC += amountDAI;
        referralCodes[code].sources[msg.sender].registeredDAI += amountDAI;

        emit FundsAdded(code, amountNative, amountUSDT, amountUSDC, amountDAI);
    }

    function removeRegisteredFunds(string memory code, uint256 amountNative, uint256 amountUSDT, uint256 amountUSDC, uint256 amountDAI) external {
        require(referralCodes[code].owner != address(0), "Referral code does not exist");
        require(!referralCodes[code].sources[msg.sender].unlocked, "already unlocked");

        referralCodes[code].sources[msg.sender].registeredNative -= amountDAI;
        referralCodes[code].sources[msg.sender].registeredUSDT -= amountDAI;
        referralCodes[code].sources[msg.sender].registeredUSDC -= amountDAI;
        referralCodes[code].sources[msg.sender].registeredDAI -= amountDAI;

        emit FundsRemoved(code, amountNative, amountUSDT, amountUSDC, amountDAI);
    }

    function unlockRegisteredFunds(string memory code) external payable {
        require(referralCodes[code].owner != address(0), "Referral code does not exist");
        require(!referralCodes[code].sources[msg.sender].unlocked, "already unlocked");

        referralCodes[code].sources[msg.sender].unlocked = true;
        uint256 balanceNative = referralCodes[code].sources[msg.sender].registeredNative;
        uint256 balanceUSDT = referralCodes[code].sources[msg.sender].registeredUSDT;
        uint256 balanceUSDC = referralCodes[code].sources[msg.sender].registeredUSDC;
        uint256 balanceDAI = referralCodes[code].sources[msg.sender].registeredDAI;

        if (balanceNative > 0) {
            require(msg.value == balanceNative, "cant unlock without providing native token");
            referralCodes[code].balanceNative += balanceNative;
        }

        if (balanceUSDT > 0) {
            USDT.transferFrom(msg.sender, address(this), balanceUSDT);
            referralCodes[code].balanceUSDT += balanceUSDT;
        }

        if (balanceUSDC > 0) {
            USDC.transferFrom(msg.sender, address(this), balanceUSDC);
            referralCodes[code].balanceUSDC += balanceUSDC;
        }

        if (balanceDAI > 0) {
            DAI.transferFrom(msg.sender, address(this), balanceDAI);
            referralCodes[code].balanceDAI += balanceDAI;
        }
    }

    function claimCode(string memory code) external {
        require(referralCodes[code].owner != address(0), "Referral code does not exist");
        require(referralCodes[code].owner == msg.sender, "can only unlock owned codes");

        uint256 balanceNative = referralCodes[code].balanceNative;
        uint256 balanceUSDT = referralCodes[code].balanceUSDT;
        uint256 balanceUSDC = referralCodes[code].balanceUSDC;
        uint256 balanceDAI = referralCodes[code].balanceDAI;

        referralCodes[code].balanceNative = 0;
        referralCodes[code].balanceUSDT = 0;
        referralCodes[code].balanceUSDC = 0;
        referralCodes[code].balanceDAI = 0;

        if (balanceNative > 0) {
            payable(referralCodes[code].owner).transfer(balanceNative);
        }

        if (balanceUSDT > 0) {
            USDT.transfer(referralCodes[code].owner, balanceUSDT);
        }

        if (balanceUSDC > 0) {
            USDC.transfer(referralCodes[code].owner, balanceUSDC);
        }

        if (balanceDAI > 0) {
            DAI.transfer(referralCodes[code].owner, balanceDAI);
        }
    }
}
