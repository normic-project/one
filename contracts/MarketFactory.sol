// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {EventMarket} from "./EventMarket.sol";
import {FeeVault} from "./FeeVault.sol";
import {OrderBook} from "./OrderBook.sol";
import {IMarketTypes} from "./interfaces/IMarketTypes.sol";

contract MarketFactory is ReentrancyGuard {
    uint256 public constant LISTING_FEE = 0.0006 ether;
    IERC20Metadata public immutable token;
    address public immutable treasury;
    address public immutable resolverMultisig;
    address public immutable eventMarketImplementation;
    FeeVault public immutable feeVault;
    OrderBook public immutable orderBook;
    address[] public markets;
    mapping(address => bool) public isMarket;

    error InvalidConfiguration();
    error IncorrectListingFee();
    error TreasuryTransferFailed();

    event MarketCreated(address indexed market, address indexed creator, uint256 indexed index, bytes32 metadataHash);

    constructor(
        IERC20Metadata token_,
        address treasury_,
        address resolverMultisig_,
        address eventMarketImplementation_
    ) {
        if (address(token_).code.length == 0 || treasury_ == address(0) || resolverMultisig_ == address(0) ||
            treasury_ == resolverMultisig_ || treasury_ == address(token_) || resolverMultisig_ == address(token_) ||
            eventMarketImplementation_.code.length == 0 || token_.decimals() != 6)
            revert InvalidConfiguration();
        token = token_;
        treasury = treasury_;
        resolverMultisig = resolverMultisig_;
        eventMarketImplementation = eventMarketImplementation_;
        feeVault = new FeeVault(token_, treasury_);
        orderBook = new OrderBook(token_, feeVault);
        if (treasury_ == address(feeVault) || treasury_ == address(orderBook) ||
            resolverMultisig_ == address(feeVault) || resolverMultisig_ == address(orderBook) ||
            EventMarket(eventMarketImplementation_).token() != token_ ||
            EventMarket(eventMarketImplementation_).settlement() != address(orderBook) ||
            EventMarket(eventMarketImplementation_).resolverMultisig() != resolverMultisig_)
            revert InvalidConfiguration();
    }

    function createEventMarket(
        uint64 closesAt,
        uint64 resolvesAt,
        IMarketTypes.Metadata calldata metadata
    ) external payable nonReentrant returns (address market) {
        if (msg.value != LISTING_FEE) revert IncorrectListingFee();
        market = Clones.clone(eventMarketImplementation);
        EventMarket(market).initialize(msg.sender, closesAt, resolvesAt, metadata);
        isMarket[market] = true;
        markets.push(market);
        (bool sent,) = treasury.call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();
        emit MarketCreated(market, msg.sender, markets.length - 1, PredictionMarket(market).metadataHash());
    }

    function marketCount() external view returns (uint256) { return markets.length; }
}
