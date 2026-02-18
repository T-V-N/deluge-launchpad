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
    error TokenSupplyOutOfRange();
    error EthReserveOutOfRange();
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

    uint256 public constant MIN_TOKEN_SUPPLY = 1e24;  // 1M tokens (18 dec)
    uint256 public constant MAX_TOKEN_SUPPLY = 1e27;  // 1B tokens (18 dec)
    uint256 public constant MIN_ETH_RESERVE = 10 ether;
    uint256 public constant MAX_ETH_RESERVE = 100 ether;

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
    uint256 public tokenSupply;
    uint256 public ethReserve;
    uint256 public liquidityPt;
    uint256 public minPurchase;
    uint256 public maxPurchase;
    uint256 public totalRaised;
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
        uint256 _tokenSupply,
        uint256 _ethReserve,
        uint256 _liquidityPt,
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

        if (_tokenSupply < MIN_TOKEN_SUPPLY || _tokenSupply > MAX_TOKEN_SUPPLY) {
            revert TokenSupplyOutOfRange();
        }

        if (_ethReserve < MIN_ETH_RESERVE || _ethReserve > MAX_ETH_RESERVE) {
            revert EthReserveOutOfRange();
        }

        if (_liquidityPt == 0 || _liquidityPt > 50) {
            revert WrongLiquidityPt();
        }

        if (_minPurchase > _maxPurchase) {
            revert MinPurchaseShouldBeLessThanMaxPurchase();
        }

        if (_lockPeriod < 3600) {
            revert TooSmallLockPeriod();
        }

        if (_endTime - _startTime > 7 days) {
            revert SaleDurationMustBeLessThanWeek();
        }

        if (_startTime > block.timestamp && _startTime - block.timestamp > 7 days) {
            revert SaleMustStartInOneWeek();
        }

        initialized = true;
        startTime = _startTime;
        endTime = _endTime;
        tokenSupply = _tokenSupply;
        ethReserve = _ethReserve;
        liquidityPt = _liquidityPt;
        softCap = _softCap;
        minPurchase = _minPurchase;
        maxPurchase = _maxPurchase;
        lockPeriod = _lockPeriod;

        if (referralEnabled) {
            referralModule = IReferralModuleRefundable(_referralContract);
        }

        saleToken.transferFrom(owner(), address(this), _tokenSupply);
    }

    function getTokensForSale() public view returns (uint256) {
        return tokenSupply * (100 - liquidityPt) / 100;
    }

    function getTokensForLiquidity() public view returns (uint256) {
        return tokenSupply - getTokensForSale();
    }

    function buyTokensWithNative(string memory refCode) external payable nonReentrant isWhitelisted {
        if (!acceptsNativeToken) {
            revert CantAcceptNative();
        }

        processPurchase(msg.sender, msg.value, refCode);
    }

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

        uint256 _tokensForSale = getTokensForSale();

        if (totalRaised < softCap) {
            return _tokensForSale / softCap;
        } else {
            return _tokensForSale / totalRaised;
        }
    }

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
            uint256 _tokensForLiquidity = getTokensForLiquidity();

            uint256 refShareBalance;
            if (referralEnabled) {
                refShareBalance = referralModule.getRefshareBalance();
            }

            if (acceptsNativeToken) {
                uint256 ethAfterFee = (totalRaised * (100 - raiseFee)) / 100;
                uint256 availableForLP = ethAfterFee - refShareBalance;
                uint256 ethForLiquidity = ethReserve < availableForLP ? ethReserve : availableForLP;

                saleToken.approve(address(router), _tokensForLiquidity);

                router.addLiquidityETH{value: ethForLiquidity}(address(saleToken), _tokensForLiquidity, 0, 0, address(this), block.timestamp);

                IERC20 lpToken = IERC20(factory.getPair(router.WETH(), address(saleToken)));
                uint256 lpTokensAmount = lpToken.balanceOf(address(this));

                lpToken.approve(address(locker), lpTokensAmount);

                locker.lockTokens{value: msg.value}(address(lpToken), lpTokensAmount, lockPeriod, owner());

                payable(treasury).transfer((totalRaised * raiseFee) / 100 - refShareBalance);

                payable(owner()).transfer(address(this).balance);
            } else {
                uint256 paymentAfterFee = (totalRaised * (100 - raiseFee)) / 100;
                uint256 availableForLP = paymentAfterFee - refShareBalance;
                uint256 paymentForLiquidity = ethReserve < availableForLP ? ethReserve : availableForLP;

                paymentToken.approve(address(router), paymentForLiquidity);
                saleToken.approve(address(router), _tokensForLiquidity);

                router.addLiquidity(address(paymentToken), address(saleToken), paymentForLiquidity, _tokensForLiquidity, 0, 0, address(this), block.timestamp);

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
