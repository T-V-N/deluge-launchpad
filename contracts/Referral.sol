// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ReferralContract is ReentrancyGuard, Ownable {
    modifier codeExists(string memory code) {
        if (referralCodes[code].owner == address(0)) {
            revert CodeDoesntExist();
        }
        _;
    }

    struct ReferralSource {
        bool unlocked;
        mapping(address => uint256) registeredBalances;
    }

    struct ReferralCode {
        address owner;
        mapping(address => uint256) balances;
        mapping(address => uint256) totalClaimed;
        mapping(address => ReferralSource) sources;
    }

    mapping(string => ReferralCode) public referralCodes;
    mapping(address => bool) isSource;
    mapping(string => mapping(address => bool)) isSourceForCode;
    mapping(string => address[]) sources;

    uint256 public tokenCount;
    mapping(uint256 => address) public supportedTokens;
    mapping(address => bool) tokenSupported;

    uint256 public sourceCount;
    address public treasury;
    uint256 public fee;

    event ReferralCodeCreated(string code, address owner);
    event FundsAdded(string code, address token, uint256 amount);
    event FundsRemoved(string code, address[] tokens, uint256[] amounts);
    event ReferralCodeDeleted(string code, address owner);
    event FundsClaimed(string code, address token, uint256 amount);

    constructor(address[] memory _supportedTokens, uint256 _fee, address _treasury) Ownable(msg.sender) {
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            if (tokenSupported[_supportedTokens[i]]) {
                revert TokenAlreadySupported();
            }
            supportedTokens[tokenCount] = _supportedTokens[i];
            tokenSupported[_supportedTokens[i]] = true;
            tokenCount++;
        }
        fee = _fee;

        treasury = _treasury;
    }

    function addSupportedToken(address token) external onlyOwner {
        if (tokenSupported[token]) {
            revert TokenAlreadySupported();
        }

        supportedTokens[tokenCount] = token;
        tokenSupported[token] = true;
        tokenCount++;
    }

    error CodeAlreadyExists();
    error CodeDoesntExist();
    error NothingToClaim();
    error PayForCreation();
    error CodeDoesntBelongToCaller();
    error AlreadyUnlocked();
    error ShouldProvideValueForUnlock();
    error WrongERC20Address();
    error TokenAlreadySupported();
    error RemoveError();

    function _createCode(string memory code, address owner) private {
        if (referralCodes[code].owner != address(0)) {
            revert CodeAlreadyExists();
        }

        referralCodes[code].owner = owner;

        emit ReferralCodeCreated(code, owner);
    }

    function createReferralCodeAdmin(string memory code, address owner) external nonReentrant onlyOwner {
        _createCode(code, owner);
    }

    function createReferralCode(string memory code) external payable nonReentrant {
        if (msg.value < fee) {
            revert PayForCreation();
        }
        payable(treasury).transfer(msg.value);

        _createCode(code, msg.sender);
    }

    // function renameCode(string memory code, string memory newName) external nonReentrant codeExists(code) {
    //     if (referralCodes[code].owner != msg.sender) {
    //         revert CodeDoesntBelongToCaller();
    //     }

    //     _renameCode(code, newName);
    // }

    function renameCodeAdmin(string memory code, string memory newName, address codeOwner) external nonReentrant onlyOwner {
        if (referralCodes[code].owner != codeOwner) {
            revert CodeDoesntBelongToCaller();
        }

        _renameCode(code, newName);
    }

    receive() external payable {}

    function _transferCode(string memory code) private {
        address owner = referralCodes[code].owner;
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = supportedTokens[i];
            uint256 balance = referralCodes[code].balances[token];

            if (balance == 0) {
                continue;
            }

            if (token == address(0)) {
                payable(owner).transfer(balance);
            } else {
                IERC20(token).transfer(owner, balance);
            }

            referralCodes[code].balances[token] = 0;
            referralCodes[code].totalClaimed[token] += balance;
            emit FundsClaimed(code, token, balance);
        }
    }

    // ALERT: This function assumes that the amount of sources and tokens not too high
    // Otherwise, it MAY run out of gas
    function _renameCode(string memory code, string memory newName) private {
        if (referralCodes[newName].owner != address(0)) {
            revert CodeAlreadyExists();
        }

        //set basic fields
        referralCodes[newName].owner = referralCodes[code].owner;
        for (uint256 i = 0; i < sources[code].length; i++) {
            address source = sources[code][i];

            sources[newName].push(source);
            isSourceForCode[newName][source] = true;

            bool unlocked = referralCodes[code].sources[source].unlocked;
            referralCodes[newName].sources[source].unlocked = unlocked;

            for (uint256 j = 0; j < tokenCount; j++) {
                address token = supportedTokens[j];
                uint256 balance = referralCodes[code].sources[source].registeredBalances[token];
                referralCodes[newName].sources[source].registeredBalances[token] = balance;
            }
        }

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = supportedTokens[i];
            referralCodes[newName].balances[token] = referralCodes[code].balances[token];
            referralCodes[newName].totalClaimed[token] = referralCodes[code].totalClaimed[token];
        }

        //delete old code
        delete referralCodes[code];
    }

    function deleteReferralCode(string memory code) external nonReentrant codeExists(code) onlyOwner {
        _transferCode(code);
        delete referralCodes[code];

        emit ReferralCodeDeleted(code, msg.sender);
    }

    function addRegisteredFunds(string memory code, address token, uint256 amount) external nonReentrant codeExists(code) {
        if (!isSource[msg.sender]) {
            isSource[msg.sender] = true;
            sourceCount++;
        }

        if (!isSourceForCode[code][msg.sender]) {
            isSourceForCode[code][msg.sender] = true;
            sources[code].push(msg.sender);
        }

        if (!tokenSupported[token]) {
            revert WrongERC20Address();
        }

        referralCodes[code].sources[msg.sender].registeredBalances[token] += amount;

        emit FundsAdded(code, token, amount);
    }

    function removeRegisteredFunds(string memory code, address[] calldata tokens, uint256[] calldata amounts) external codeExists(code) {
        if (referralCodes[code].sources[msg.sender].unlocked) {
            revert AlreadyUnlocked();
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if (referralCodes[code].sources[msg.sender].registeredBalances[tokens[i]] < amounts[i]) {
                revert RemoveError();
            }

            referralCodes[code].sources[msg.sender].registeredBalances[tokens[i]] -= amounts[i];
        }

        emit FundsRemoved(code, tokens, amounts);
    }

    function unlockRegisteredFunds(string memory code) external payable codeExists(code) {
        referralCodes[code].sources[msg.sender].unlocked = true;

        uint256 ethRequired = 0;
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = supportedTokens[i];
            uint256 balance = referralCodes[code].sources[msg.sender].registeredBalances[token];

            if (balance > 0) {
                if (token == address(0)) {
                    ethRequired += balance;
                } else {
                    IERC20(token).transferFrom(msg.sender, address(this), balance);
                }
                referralCodes[code].sources[msg.sender].registeredBalances[token] = 0;
                referralCodes[code].balances[token] += balance;
            }
        }

        if (ethRequired > 0) {
            require(msg.value == ethRequired, "Wrong ETH amount");
        }
    }

    function claimCode(string memory code) external codeExists(code) {
        if (referralCodes[code].owner != msg.sender) {
            revert CodeDoesntBelongToCaller();
        }

        _transferCode(code);
    }

    function codeExist(string memory code) external view returns (bool) {
        if (referralCodes[code].owner != address(0)) {
            return true;
        }

        return false;
    }

    function getBalance(string memory _code, address _token) public view returns (uint256) {
        return referralCodes[_code].balances[_token];
    }

    function isSourceUnlocked(string memory code, address source) external view returns (bool unlocked) {
        return referralCodes[code].sources[source].unlocked;
    }

    function getReferralRegisteredBalance(string memory code, address source, address token) external view returns (uint256) {
        return referralCodes[code].sources[source].registeredBalances[token];
    }

    function getReferralCodeOwner(string memory code) external view returns (address) {
        return referralCodes[code].owner;
    }

    function getReferralCodeBalance(string memory code, address token) external view returns (uint256) {
        return referralCodes[code].balances[token];
    }

    function getReferralCodeTotalClaimed(string memory code, address token) external view returns (uint256) {
        return referralCodes[code].totalClaimed[token];
    }

    function getSourcesForCode(string memory code) external view returns (address[] memory) {
        return sources[code];
    }

    function isTokenSupported(address token) external view returns (bool) {
        return tokenSupported[token];
    }

    function isSourceAddress(address source) external view returns (bool) {
        return isSource[source];
    }
}
