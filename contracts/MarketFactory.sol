// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {AutoMarket} from "./AutoMarket.sol";
import {EventMarket} from "./EventMarket.sol";
import {FeeVault} from "./FeeVault.sol";
import {OrderBook} from "./OrderBook.sol";
import {IResolutionModule} from "./interfaces/IResolutionModule.sol";

contract MarketFactory is ReentrancyGuard {
    uint256 public constant LISTING_FEE = 0.0006 ether;
    IERC20Metadata public immutable token;
    address public immutable treasury;
    IResolutionModule public immutable autoResolver;
    address public immutable resolverMultisig;
    uint256 public immutable eventProposalBond;
    uint64 public immutable eventDisputePeriod;
    address public immutable autoMarketImplementation;
    address public immutable eventMarketImplementation;
    FeeVault public immutable feeVault;
    OrderBook public immutable orderBook;
    address[] public markets;
    mapping(address => bool) public isMarket;

    error InvalidConfiguration();
    error IncorrectListingFee();
    error TreasuryTransferFailed();

    event MarketCreated(address indexed market, address indexed creator, uint256 indexed index,
        IResolutionModule.MarketType marketType, bytes32 metadataHash);

    constructor(
        IERC20Metadata token_,
        address treasury_,
        IResolutionModule autoResolver_,
        address resolverMultisig_,
        uint256 eventProposalBond_,
        uint64 eventDisputePeriod_,
        address autoMarketImplementation_,
        address eventMarketImplementation_
    ) {
        if (address(token_).code.length == 0 || address(autoResolver_).code.length == 0 ||
            treasury_ == address(0) || resolverMultisig_ == address(0) || treasury_ == resolverMultisig_ ||
            treasury_ == address(token_) || treasury_ == address(autoResolver_) ||
            resolverMultisig_ == address(token_) || resolverMultisig_ == address(autoResolver_) ||
            autoMarketImplementation_.code.length == 0 || eventMarketImplementation_.code.length == 0 ||
            autoMarketImplementation_ == eventMarketImplementation_ ||
            token_.decimals() != 6 || eventProposalBond_ == 0 || eventProposalBond_ > 1_000_000 * 1e6 ||
            eventDisputePeriod_ < 1 hours || eventDisputePeriod_ > 30 days) revert InvalidConfiguration();
        token = token_;
        treasury = treasury_;
        autoResolver = autoResolver_;
        resolverMultisig = resolverMultisig_;
        eventProposalBond = eventProposalBond_;
        eventDisputePeriod = eventDisputePeriod_;
        autoMarketImplementation = autoMarketImplementation_;
        eventMarketImplementation = eventMarketImplementation_;
        feeVault = new FeeVault(token_, treasury_);
        orderBook = new OrderBook(token_, feeVault);
        if (treasury_ == address(feeVault) || treasury_ == address(orderBook) ||
            resolverMultisig_ == address(feeVault) || resolverMultisig_ == address(orderBook) ||
            AutoMarket(autoMarketImplementation_).token() != token_ ||
            AutoMarket(autoMarketImplementation_).settlement() != address(orderBook) ||
            AutoMarket(autoMarketImplementation_).autoResolver() != autoResolver_ ||
            EventMarket(eventMarketImplementation_).token() != token_ ||
            EventMarket(eventMarketImplementation_).settlement() != address(orderBook) ||
            EventMarket(eventMarketImplementation_).resolverMultisig() != resolverMultisig_ ||
            EventMarket(eventMarketImplementation_).proposalBond() != eventProposalBond_ ||
            EventMarket(eventMarketImplementation_).disputePeriod() != eventDisputePeriod_)
            revert InvalidConfiguration();
    }

    function createAutoMarket(IResolutionModule.AutoTerms calldata terms)
        external payable nonReentrant returns (address market)
    {
        _checkListingFee();
        market = Clones.clone(autoMarketImplementation);
        AutoMarket(market).initialize(msg.sender, terms);
        _registerAndPay(market, IResolutionModule.MarketType.AUTO_MARKET);
    }

    function createEventMarket(
        uint64 closesAt,
        uint64 resolvesAt,
        IResolutionModule.Metadata calldata metadata
    ) external payable nonReentrant returns (address market) {
        _checkListingFee();
        market = Clones.clone(eventMarketImplementation);
        EventMarket(market).initialize(msg.sender, closesAt, resolvesAt, metadata);
        _registerAndPay(market, IResolutionModule.MarketType.EVENT_MARKET);
    }

    function marketCount() external view returns (uint256) { return markets.length; }

    function _checkListingFee() private view {
        if (msg.value != LISTING_FEE) revert IncorrectListingFee();
    }

    function _registerAndPay(address market, IResolutionModule.MarketType marketType_) private {
        isMarket[market] = true;
        markets.push(market);
        (bool sent,) = treasury.call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();
        emit MarketCreated(market, msg.sender, markets.length - 1, marketType_, PredictionMarket(market).metadataHash());
    }
}
