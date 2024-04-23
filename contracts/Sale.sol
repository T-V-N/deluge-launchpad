// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ILocker.sol";
import "./IUniswap.sol";

contract Sale is Ownable, ReentrancyGuard {
    modifier isWhitelisted() {
        if (isWhitelist) {
            require(whitelist[msg.sender], "Sale: Caller is not whitelisted");
        }
        _;
    }

    // Deps
    IERC20 public saleToken;
    IERC20 public paymentToken;
    ILocker public locker;
    IUniswapV2Router02 public router = IUniswapV2Router02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
    IUniFactory public factory = IUniFactory(0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73);
    uint256 public raiseFee;
    address public treasury;

    // Sale
    bool public acceptsNativeToken;
    uint256 public startTime;
    uint256 public endTime;
    bool public finished;
    uint256 public softCap;
    uint256 public hardCap;
    uint256 public minPurchase;
    uint256 public maxPurchase;
    uint256 public totalRaised;
    uint256 public liquidityPt;
    uint256 public liquidityPrice;
    uint256 public salePrice;
    bool public isWhitelist;
    mapping(address => uint256) public contributions;
    mapping(address => bool) public claimed;

    mapping(address => bool) public whitelist;

    // Lock
    uint256 public lockPeriod;
    uint256 public lockAmount;
    uint256 public lockDelimiter = 1000;

    event TokensPurchased(address indexed buyer, uint256 amountSpent);
    event TokensClaimed(address indexed claimer, uint256 tokensClaimed);
    event SaleFinalized(bool success);
    event SaleCreate(address sale);

    constructor(address _saleTokenAddress, address _paymentTokenAddress, address _locker, address _treasury, uint256 _raiseFee, address[] memory _whitelist) Ownable(msg.sender) {
        locker = ILocker(_locker);
        saleToken = IERC20(_saleTokenAddress);
        raiseFee = _raiseFee;
        treasury = _treasury;

        if (_paymentTokenAddress == address(0)) {
            acceptsNativeToken = true;
        } else {
            paymentToken = IERC20(_paymentTokenAddress);
        }

        if (_whitelist.length != 0) {
            isWhitelist = true;

            for (uint i = 0; i < _whitelist.length; i++) {
                whitelist[_whitelist[i]] = true;
            }
        }

        transferOwnership(tx.origin);
        emit SaleCreate(address(this));
    }

    function initializeSale(
        uint256 _startTime,
        uint256 _endTime,
        uint256 _liquidityPt,
        uint256 _salePrice,
        uint256 _liquidityPrice,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _minPurchase,
        uint256 _maxPurchase,
        uint256 _lockPeriod
    ) external onlyOwner {
        require(_endTime >= block.timestamp, "Start time is before current time");
        require(_endTime > _startTime, "End time must be after start time");
        require(_liquidityPt >= 50 && _liquidityPt <= 100, "Liquidity pt must be between 50 and 100");
        require(_softCap <= _hardCap, "Soft cap shall equal or lower than hardcap");
        require(_minPurchase <= _maxPurchase, "Min purchase shall be less than max");
        require(_lockPeriod >= 3600, "Too short lock");

        startTime = _startTime;
        endTime = _endTime;
        liquidityPt = _liquidityPt;
        softCap = _softCap;
        hardCap = _hardCap;
        minPurchase = _minPurchase;
        maxPurchase = _maxPurchase;
        lockPeriod = _lockPeriod;

        liquidityPrice = _liquidityPrice;
        salePrice = _salePrice;

        saleToken.transferFrom(owner(), address(this), (hardCap * salePrice) + ((((liquidityPrice * hardCap * liquidityPt) * (100 - raiseFee)) / 100) / 100));
    }

    // Function to buy tokens with BNB
    function buyTokensWithNative() external payable nonReentrant isWhitelisted {
        require(acceptsNativeToken, "native payments not accepted");
        processPurchase(msg.sender, msg.value);
    }

    // Function to buy tokens with the specified ERC20 token
    function buyTokensWithERC20(uint256 _amount) external nonReentrant isWhitelisted {
        require(!acceptsNativeToken, "Sale only accepts native token");
        require(paymentToken.transferFrom(msg.sender, address(this), _amount), "Payment token transfer failed");
        processPurchase(msg.sender, _amount);
    }

    function processPurchase(address _buyer, uint256 _amount) private {
        require(_amount >= minPurchase && _amount <= maxPurchase, "Deposit limit reached");
        require(block.timestamp >= startTime && block.timestamp <= endTime, "Sale is not active");
        require(totalRaised + _amount <= hardCap, "Hardcap reached");

        totalRaised += _amount;
        contributions[_buyer] += _amount;

        emit TokensPurchased(_buyer, _amount);
    }

    function finalizeSale() external payable onlyOwner nonReentrant {
        require(block.timestamp > endTime, "Sale not ended yet");

        if (totalRaised >= softCap) {
            if (acceptsNativeToken) {
                uint256 ethAmount = (totalRaised * (100 - raiseFee)) / 100;
                uint256 tokenAmount = (liquidityPrice * ethAmount * liquidityPt) / 100;

                saleToken.approve(address(router), tokenAmount);

                router.addLiquidityETH{value: (ethAmount * liquidityPt) / 100}(address(saleToken), tokenAmount, 0, 0, address(this), block.timestamp);

                IERC20 lpToken = IERC20(factory.getPair(router.WETH(), address(saleToken)));
                uint256 lpTokensAmount = lpToken.balanceOf(address(this));

                lpToken.approve(address(locker), lpTokensAmount);

                locker.lockTokens{value: msg.value}(address(lpToken), lpTokensAmount, lockPeriod, owner());

                payable(treasury).transfer((totalRaised * raiseFee) / 100);

                payable(owner()).transfer(address(this).balance);

                uint256 remainedTokens = (hardCap - totalRaised) * salePrice;
                if (remainedTokens != 0) {
                    saleToken.transfer(owner(), remainedTokens);
                }
            } else {
                uint256 tokenAmountPayment = (totalRaised * (100 - raiseFee)) / 100;
                uint256 tokenAmountSale = (liquidityPrice * tokenAmountPayment * liquidityPt) / 100;

                paymentToken.approve(address(router), tokenAmountPayment);
                saleToken.approve(address(router), tokenAmountSale);

                router.addLiquidity(address(paymentToken), address(saleToken), (tokenAmountPayment * liquidityPt) / 100, tokenAmountSale, 0, 0, address(this), block.timestamp);

                IERC20 lpToken = IERC20(factory.getPair(address(paymentToken), address(saleToken)));
                uint256 lpTokensAmount = lpToken.balanceOf(address(this));

                lpToken.approve(address(locker), lpTokensAmount);
                locker.lockTokens{value: msg.value}(address(lpToken), lpTokensAmount, lockPeriod, owner());

                paymentToken.transfer(treasury, ((totalRaised * raiseFee) / 100));

                paymentToken.transfer(owner(), paymentToken.balanceOf(address(this)));
                uint256 remainedTokens = (hardCap - totalRaised) * salePrice;
                if (remainedTokens != 0) {
                    saleToken.transfer(owner(), remainedTokens);
                }
            }

            finished = true;

            emit SaleFinalized(true);
        } else {
            saleToken.transfer(owner(), saleToken.balanceOf(address(this)));
            finished = true;

            emit SaleFinalized(false);
        }
    }

    function refund() external nonReentrant {
        require(block.timestamp > endTime && totalRaised < softCap, "cant refund");
        require(contributions[msg.sender] > 0, "nothing to refund");

        if (acceptsNativeToken) {
            payable(msg.sender).transfer(contributions[msg.sender]);
        } else {
            paymentToken.transfer(msg.sender, contributions[msg.sender]);
        }

        totalRaised -= contributions[msg.sender];
        contributions[msg.sender] = 0;
    }

    function claim() external nonReentrant {
        require(finished, "sale not finished");
        require(contributions[msg.sender] > 0, "no deposit");
        require(!claimed[msg.sender], "already claimed");
        claimed[msg.sender] = true;

        uint256 tokens = contributions[msg.sender] * salePrice;
        saleToken.transfer(msg.sender, tokens);
        emit TokensClaimed(msg.sender, tokens);
    }

    function addToWhitelist(address[] calldata _addresses) external onlyOwner {
        for (uint i = 0; i < _addresses.length; i++) {
            whitelist[_addresses[i]] = true;
        }
    }

    function removeFromWhitelist(address[] calldata _addresses) external onlyOwner {
        for (uint i = 0; i < _addresses.length; i++) {
            whitelist[_addresses[i]] = false;
        }
    }

    function setWhitelist(bool _enabled) external onlyOwner {
        isWhitelist = _enabled;
    }
}
