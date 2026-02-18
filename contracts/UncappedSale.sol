// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ILocker.sol";
import "./interfaces/IUniswap.sol";
import "../lib/deluge-referral/contracts/interfaces/IReferralModuleRefundable.sol";

contract UncappedSale is Ownable, ReentrancyGuard {
    modifier isWhitelisted() {
        if (isWhitelist) {
            if (!whitelist[msg.sender]) {
                revert NotWhitelisted();
            }
        }
        _;
    }

    //errors
    error NotWhitelisted();
    error InitProblem();
    error WrongSaleDate();
    error WrongLiquidityPt();
    error SoftCapShouldBeLessThanHardCap();
    error MinPurchaseShouldBeLessThanMaxPurchase();
    error TooSmallLockPeriod();
    error CantAcceptNative();
    error CantAcceptERC20();
    error TransferFailed();
    error SaleNotEnded();
    error FinishReferral();
    error SaleGoalReached();
    error PaymentOutsideMinMaxAmounts();
    error OutsideSaleTime();
    error CantRefund();
    error NothingToRefund();
    error NotFinished();
    error AlreadyFinished();
    error NoDeposit();
    error AlreadyClaimed();
    error SaleDurationMustBeLessThanWeek();
    error AlreadyFinalizedRef();
    error SaleMustStartInOneWeek();

    // Deps
    IERC20 public saleToken;
    IERC20 public paymentToken;
    ILocker public locker;
    IUniswapV2Router02 public router;
    IUniFactory public factory;
    uint256 public raiseFee;
    address public treasury;

    // Sale
    bool public acceptsNativeToken;
    uint256 public startTime;
    uint256 public endTime;
    bool public finished;
    uint256 public softCap;
    uint256 public tokensForSale;
    uint256 public tokensForLiquidity;
    uint256 public minPurchase;
    uint256 public maxPurchase;
    uint256 public totalRaised;
    uint256 public liquidityPt;
    bool public isWhitelist;
    mapping(address => uint256) public contributions;
    mapping(address => bool) public claimed;
    mapping(address => bool) public whitelist;
    bool public initialized;

    // Lock
    uint256 public lockPeriod;
    uint256 public lockAmount;
    uint256 public lockDelimiter = 1000;

    // ref
    IReferralModuleRefundable public referralModule;
    bool public referralEnabled;
    bool refshareSent;
    uint256 refSharePt = 25;

    event TokensPurchased(address indexed buyer, uint256 amountSpent);
    event TokensClaimed(address indexed claimer, uint256 tokensClaimed);
    event SaleFinalized(bool success);
    event SaleCreate(address sale);

    constructor(
        address _saleTokenAddress,
        address _paymentTokenAddress,
        address _locker,
        address _treasury,
        uint256 _raiseFee,
        address[] memory _whitelist,
        bool _referralEnabled,
        address _uniFactory,
        address _uniRouter
    ) Ownable(msg.sender) {
        locker = ILocker(_locker);
        saleToken = IERC20(_saleTokenAddress);
        raiseFee = _raiseFee;
        treasury = _treasury;
        factory = IUniFactory(_uniFactory);
        router = IUniswapV2Router02(_uniRouter);

        if (_paymentTokenAddress == address(0)) {
            acceptsNativeToken = true;
        } else {
            paymentToken = IERC20(_paymentTokenAddress);
        }

        referralEnabled = _referralEnabled;

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
        uint256 _tokensForSale,
        uint256 _softCap,
        uint256 _minPurchase,
        uint256 _maxPurchase,
        uint256 _lockPeriod,
        address _referralContract
    ) external onlyOwner {
        if (initialized) {
            revert InitProblem();
        }

        if (_endTime < block.timestamp || _endTime <= _startTime) {
            revert WrongSaleDate();
        }

        if (_liquidityPt < 50 || _liquidityPt > 100) {
            revert WrongLiquidityPt();
        }

        if (_minPurchase > _maxPurchase) {
            revert MinPurchaseShouldBeLessThanMaxPurchase();
        }

        if (_lockPeriod < 3600) {
            revert TooSmallLockPeriod();
        }

        if (endTime - startTime > 7 days) {
            revert SaleDurationMustBeLessThanWeek();
        }

        if (_startTime - block.timestamp > 7 days) {
            revert SaleMustStartInOneWeek();
        }

        initialized = true;
        startTime = _startTime;
        endTime = _endTime;
        liquidityPt = _liquidityPt;
        softCap = _softCap;
        minPurchase = _minPurchase;
        maxPurchase = _maxPurchase;
        lockPeriod = _lockPeriod;
        tokensForSale = _tokensForSale;
        tokensForLiquidity = (tokensForSale * liquidityPt * (100 - raiseFee)) / 100 / 100;

        if (referralEnabled) {
            referralModule = IReferralModuleRefundable(_referralContract);
        }

        saleToken.transferFrom(owner(), address(this), tokensForSale + tokensForLiquidity);
    }

    // Function to buy tokens with BNB
    function buyTokensWithNative(string memory refCode) external payable nonReentrant isWhitelisted {
        if (!acceptsNativeToken) {
            revert CantAcceptNative();
        }

        processPurchase(msg.sender, msg.value, refCode);
    }

    // Function to buy tokens with the specified ERC20 token
    function buyTokensWithERC20(uint256 _amount, string memory refCode) external nonReentrant isWhitelisted {
        if (acceptsNativeToken) {
            revert CantAcceptERC20();
        }

        if (!paymentToken.transferFrom(msg.sender, address(this), _amount)) {
            revert TransferFailed();
        }

        processPurchase(msg.sender, _amount, refCode);
    }

    function processPurchase(address _buyer, uint256 _amount, string memory refCode) private {
        if (_amount < minPurchase || _amount > maxPurchase) {
            revert PaymentOutsideMinMaxAmounts();
        }

        if (block.timestamp < startTime || block.timestamp > endTime) {
            revert OutsideSaleTime();
        }

        if (referralEnabled && bytes(refCode).length != 0) {
            address refToken = acceptsNativeToken ? address(0) : address(paymentToken);
            referralModule.processReferralCode(refCode, (((_amount * raiseFee) / 100) * refSharePt) / 100, refToken);
        }

        totalRaised += _amount;
        contributions[_buyer] += _amount;

        emit TokensPurchased(_buyer, _amount);
    }

    function getPrice() public view returns (uint256) {
        if (!initialized) {
            revert InitProblem();
        }

        if (acceptsNativeToken) {
            if (totalRaised < softCap) {
                return tokensForSale / softCap;
            } else {
                return tokensForSale / totalRaised;
            }
        } else {
            if (totalRaised < softCap) {
                return tokensForSale / softCap;
            } else {
                return tokensForSale / totalRaised;
            }
        }
    }

    // extends lock period by _lockPeriod if sale is not finished
    function extendLock(uint256 _lockPeriod) external onlyOwner {
        if (finished) {
            revert AlreadyFinished();
        }

        lockPeriod += _lockPeriod;
    }

    function finalizeRef(uint256 count) external onlyOwner {
        if (referralModule.isFinalized()) {
            revert AlreadyFinalizedRef();
        }

        if (acceptsNativeToken) {
            referralModule.finalizeReferralCodes{value: referralModule.getRefshareBalanceFor(count, address(0))}(count);
        } else {
            paymentToken.approve(address(referralModule), referralModule.getRefshareBalanceFor(count, address(paymentToken)));
            referralModule.finalizeReferralCodes(count);
        }
    }

    function finalizeSale() external payable onlyOwner nonReentrant {
        if (block.timestamp <= endTime) {
            revert SaleNotEnded();
        }

        if (referralEnabled && !referralModule.isFinalized()) {
            revert FinishReferral();
        }

        if (totalRaised >= softCap) {
            if (acceptsNativeToken) {
                uint256 ethAmount = (totalRaised * (100 - raiseFee)) / 100;
                saleToken.approve(address(router), tokensForLiquidity);

                router.addLiquidityETH{value: (ethAmount * liquidityPt) / 100}(address(saleToken), tokensForLiquidity, 0, 0, address(this), block.timestamp);

                IERC20 lpToken = IERC20(factory.getPair(router.WETH(), address(saleToken)));
                uint256 lpTokensAmount = lpToken.balanceOf(address(this));

                lpToken.approve(address(locker), lpTokensAmount);

                locker.lockTokens{value: msg.value}(address(lpToken), lpTokensAmount, lockPeriod, owner());

                uint256 refShareBalance;
                if (referralEnabled) {
                    refShareBalance = referralModule.getRefshareBalance();
                }
                payable(treasury).transfer((totalRaised * raiseFee) / 100 - refShareBalance);

                payable(owner()).transfer(address(this).balance);
            } else {
                uint256 tokenAmountPayment = (totalRaised * (100 - raiseFee)) / 100;
                uint256 tokenAmountSale = tokensForLiquidity;

                paymentToken.approve(address(router), tokenAmountPayment);
                saleToken.approve(address(router), tokenAmountSale);

                router.addLiquidity(address(paymentToken), address(saleToken), (tokenAmountPayment * liquidityPt) / 100, tokenAmountSale, 0, 0, address(this), block.timestamp);

                IERC20 lpToken = IERC20(factory.getPair(address(paymentToken), address(saleToken)));
                uint256 lpTokensAmount = lpToken.balanceOf(address(this));

                lpToken.approve(address(locker), lpTokensAmount);
                locker.lockTokens{value: msg.value}(address(lpToken), lpTokensAmount, lockPeriod, owner());

                paymentToken.transfer(treasury, ((totalRaised * raiseFee) / 100));

                paymentToken.transfer(owner(), paymentToken.balanceOf(address(this)));
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
        if (block.timestamp <= endTime || totalRaised >= softCap) {
            revert CantRefund();
        }

        if (contributions[msg.sender] == 0) {
            revert NothingToRefund();
        }

        if (acceptsNativeToken) {
            payable(msg.sender).transfer(contributions[msg.sender]);
        } else {
            paymentToken.transfer(msg.sender, contributions[msg.sender]);
        }

        totalRaised -= contributions[msg.sender];
        contributions[msg.sender] = 0;
    }

    function claim() external nonReentrant {
        if (!finished) {
            revert NotFinished();
        }

        if (contributions[msg.sender] == 0) {
            revert NoDeposit();
        }

        if (claimed[msg.sender]) {
            revert AlreadyClaimed();
        }

        claimed[msg.sender] = true;

        uint256 tokens = contributions[msg.sender] * getPrice();
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

    receive() external payable {}
}
